import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import {
  db,
  getLocalUser,
  createRepertoire,
  searchOpenings,
  syncRepertoireTotals,
  slugify,
  loadOpenings,
} from "./db.js";
import {
  epdOf,
  fenFromEpd,
  findLegalMove,
  isEpdLike,
  legalSans,
  lineSans,
  normalizeSan,
  pgnFromSans,
  sanKey,
  validateLine,
  deriveLineMoves,
} from "./positions.js";
import {
  isDue,
  localDay,
  nowIso,
  parseOffset,
  toIso,
} from "./dates.js";
import { lapse, schedule, updateTrainingRating } from "./srs.js";
import {
  REVIEW_STYLES,
  buildQueue,
  buildTask,
  cardForMove,
  dailySummary,
  lineAggregate,
  lineOut,
  lineQueue,
  modeOf,
  notesForPosition,
  persistStreak,
  positionDetail,
  rebuildRepertoireMoves,
  statsFor,
  streakFor,
  taskLineView,
  weakEpdQuery,
  disableBranch,
  enableBranch,
  linesThroughBranch,
  recomputeDisabled,
  removeBranches,
} from "./repertoire.js";
import { checkDatabase } from "./integrity.js";
import {
  STYLES,
  annotationForMove,
  annotationsForPosition,
  candidateList,
  fullNameForEpd,
  pathForEpd,
  positionHeading,
  reportForEpd,
  scoreCandidate,
} from "./opening-data.js";
import { chooseGap, computeGaps } from "./gaps.js";
import {
  dailyGame,
  gameDetail,
  gameRow,
  gameRows,
  gameSummary,
  history as modelHistory,
  markReviewed,
  nextGame,
  progressFor,
  randomGame,
} from "./model-games.js";
import { addBranchAt, addLineFromSans, lineEpds } from "./branches.js";
import { commonMoveQueue } from "./common.js";
import { refuteMove } from "./refutation.js";
import {
  COVERAGE_OPTIONS,
  bandMatch,
  readSettings,
  settingsMeta,
  updateSettings,
} from "./settings.js";
import { exportJson, exportPgn, parsePgnGames } from "./pgn.js";
import { importCapturedData } from "./seed-data.js";

export const api = Router();

const now = () => nowIso();

const userOut = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  trainingRating: Number(u.training_rating ?? 1200),
  training: {
    rating: Number(u.training_rating ?? 1200),
    deviation: Number(u.training_rating_deviation ?? 350),
    volatility: Number(u.training_rating_volatility ?? 0.06),
  },
  currentStreak: Number(u.current_streak ?? 0),
  highestStreak: Number(u.highest_streak ?? 0),
  lastStreakDate: u.last_streak_date ?? null,
  // Rating/coverage profile (D135/D196). `settings` is canonical; these are
  // the mirrored columns the profile row carries.
  ratingSystem: u.rating_system ?? "Chess.com",
  singleElo: Number(u.single_elo ?? 1800),
  eloRange: u.elo_range ?? "1800-2000",
  coverageGoal: Number(u.coverage_goal ?? 50),
});

function getRepertoire(userId, key) {
  if (/^\d+$/.test(String(key))) {
    return db
      .prepare("SELECT * FROM repertoires WHERE id = ? AND user_id = ?")
      .get(Number(key), userId);
  }
  return db
    .prepare(
      "SELECT * FROM repertoires WHERE color = ? AND user_id = ? ORDER BY id LIMIT 1"
    )
    .get(String(key), userId);
}

function getLineForUser(userId, lineId) {
  return db
    .prepare(
      `SELECT l.* FROM lines l
       JOIN repertoires r ON r.id = l.repertoire_id
       WHERE l.id = ? AND r.user_id = ?`
    )
    .get(lineId, userId);
}

const repStats = (repertoire) => statsFor(db, repertoire);

function lineView(line, repertoire = null) {
  const rep =
    repertoire ||
    db.prepare("SELECT * FROM repertoires WHERE id = ?").get(line.repertoire_id);
  return lineOut(line, lineAggregate(db, rep, line));
}

function moveAt(repertoireId, epd, san) {
  return db
    .prepare(
      `SELECT * FROM line_moves
       WHERE repertoire_id = ? AND epd = ? AND san_key = ? LIMIT 1`
    )
    .get(repertoireId, epd, sanKey(san));
}

function moveById(id) {
  return db.prepare("SELECT * FROM line_moves WHERE id = ?").get(Number(id));
}

/**
 * There is no authentication in local-first mode. Every request is scoped to
 * the one profile stored in this installation's SQLite database.
 */
export function requireAuth(req, res, next) {
  const user = getLocalUser();
  if (!user) {
    return res
      .status(500)
      .json({ error: "Local profile is missing. Run npm run db:reset." });
  }
  req.user = userOut(user);
  next();
}

/* ------------------------------------------------------------------ profile --- */

api.get("/me", (req, res) => {
  const user = getLocalUser();
  if (!user) {
    return res
      .status(500)
      .json({ error: "Local profile is missing. Run npm run db:reset." });
  }
  const settings = readSettings(db, user.id);
  res.json({
    user: {
      ...userOut(user),
      profile: {
        ratingSystem: settings.ratingSystem,
        timeControl: settings.timeControl,
        singleElo: settings.singleElo,
        eloRange: settings.eloRange,
        coverageGoal: settings.coverageGoal,
        pieceSet: settings.pieceSet,
      },
      preferences: settings,
      ratingBand: bandMatch(db, settings),
      streak: streakFor(db, user.id, req.query.tzOffset),
      daily: dailySummary(db, user.id, req.query.tzOffset),
    },
  });
});

api.patch("/user", requireAuth, (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const hasProfilePatch = ["ratingSystem", "singleElo", "eloRange", "coverageGoal", "timeControl"].some(
    (key) => body[key] != null
  );
  if (!name && !hasProfilePatch) {
    return res.status(400).json({ error: "Provide a name or profile field" });
  }
  if (name) {
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, req.user.id);
  }
  // Rating/coverage are canonical in `settings`; PATCH /user writes through
  // the same normaliser so both endpoints cannot diverge (D197).
  const settings = updateSettings(db, req.user.id, body);
  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({
    user: {
      ...userOut(fresh),
      profile: {
        ratingSystem: settings.ratingSystem,
        timeControl: settings.timeControl,
        singleElo: settings.singleElo,
        eloRange: settings.eloRange,
        coverageGoal: settings.coverageGoal,
        pieceSet: settings.pieceSet,
      },
    },
  });
});

/* ---------------------------------------------------------------- dashboard --- */

api.get("/dashboard", requireAuth, (req, res) => {
  const repertoires = db
    .prepare("SELECT * FROM repertoires WHERE user_id = ? ORDER BY id")
    .all(req.user.id)
    .map(repStats);

  const streak = persistStreak(db, req.user.id, req.query.tzOffset);
  const daily = dailySummary(db, req.user.id, req.query.tzOffset);

  const tasks = {
    due: repertoires.reduce((n, r) => n + r.due, 0),
    saved: repertoires.reduce((n, r) => n + r.saved, 0),
    mastered: repertoires.reduce((n, r) => n + r.mastered, 0),
    streak: streak.current,
  };

  const dailyModel = dailyGame(db, req.user.id, {});
  const modelGame = dailyModel.game
    ? {
        id: dailyModel.game.id,
        white: dailyModel.game.white,
        black: dailyModel.game.black,
        whiteFullName: dailyModel.game.whiteFullName,
        blackFullName: dailyModel.game.blackFullName,
        event: dailyModel.game.event,
        year: dailyModel.game.year,
        result: dailyModel.game.result,
        resultLabel: dailyModel.game.resultLabel,
        players: dailyModel.game.players,
        progressState: dailyModel.game.progressState,
        daily: dailyModel.daily,
        source: dailyModel.game.source,
        moveCount: dailyModel.game.moveCount,
      }
    : null;
  res.json({
    user: userOut(getLocalUser()),
    repertoires,
    tasks,
    streak: daily.streak,
    daily,
    modelGame,
    connected: false,
  });
});

api.get("/stats/streak", requireAuth, (req, res) => {
  res.json({
    streak: streakFor(db, req.user.id, req.query.tzOffset),
    daily: dailySummary(db, req.user.id, req.query.tzOffset),
  });
});

/* ------------------------------------------------------- repertoire extras --- */

api.post("/repertoires/:key/clone", requireAuth, (req, res) => {
  const source = getRepertoire(req.user.id, req.params.key);
  if (!source) return res.status(404).json({ error: "Repertoire not found" });
  const name = String(req.body?.name || `${source.name} copy`).trim();
  if (!name) return res.status(400).json({ error: "Name is required" });
  const targetId = createRepertoire(
    req.user.id,
    source.color,
    name,
    String(req.body?.description ?? source.description ?? "")
  );
  const stamp = now();

  db.exec("BEGIN IMMEDIATE");
  try {
    // Chapters first, so cloned lines keep their section.
    const chapterMap = new Map();
    const chapters = db
      .prepare("SELECT * FROM repertoire_chapters WHERE repertoire_id = ? ORDER BY sort_order, id")
      .all(source.id);
    const insertChapter = db.prepare(
      `INSERT INTO repertoire_chapters
         (repertoire_id, name, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const chapter of chapters) {
      const id = Number(
        insertChapter.run(
          targetId,
          chapter.name,
          chapter.description,
          chapter.sort_order,
          stamp,
          stamp
        ).lastInsertRowid
      );
      chapterMap.set(chapter.id, id);
    }

    const lines = db
      .prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id")
      .all(source.id);
    const insertLine = db.prepare(
      `INSERT INTO lines
         (repertoire_id, opening_id, name, moves, pgn, fen, epd, side, expected_san,
          learned, mastered, saved, due_at, origin, autofill_style, chapter_id,
          source_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, NULL, 'clone', ?, ?, ?, ?)`
    );
    for (const line of lines) {
      insertLine.run(
        targetId,
        line.opening_id ?? null,
        line.name,
        line.moves,
        line.pgn,
        line.fen,
        line.epd ?? null,
        line.side,
        line.expected_san,
        line.autofill_style ?? null,
        line.chapter_id ? chapterMap.get(line.chapter_id) ?? null : null,
        `clone:${source.id}`,
        stamp
      );
    }

    const notes = db
      .prepare("SELECT * FROM notes WHERE repertoire_id = ?")
      .all(source.id);
    const insertNote = db.prepare(
      `INSERT INTO notes (user_id, repertoire_id, epd, san, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const note of notes) {
      insertNote.run(
        req.user.id,
        targetId,
        note.epd,
        note.san,
        note.note,
        stamp,
        stamp
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  rebuildRepertoireMoves(db, targetId);
  syncRepertoireTotals(targetId);
  const repertoire = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(targetId);
  res.status(201).json({
    repertoire: repStats(repertoire),
    sourceId: source.id,
    cloned: {
      lines: db.prepare("SELECT COUNT(*) AS n FROM lines WHERE repertoire_id = ?").get(targetId).n,
      notes: db.prepare("SELECT COUNT(*) AS n FROM notes WHERE repertoire_id = ?").get(targetId).n,
    },
  });
});

api.get("/repertoires/:key/chapters", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const chapters = db
    .prepare("SELECT * FROM repertoire_chapters WHERE repertoire_id = ? ORDER BY sort_order, id")
    .all(repertoire.id)
    .map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      description: chapter.description,
      sortOrder: chapter.sort_order,
      lineCount: db
        .prepare("SELECT COUNT(*) AS n FROM lines WHERE repertoire_id = ? AND chapter_id = ?")
        .get(repertoire.id, chapter.id).n,
      createdAt: chapter.created_at,
      updatedAt: chapter.updated_at,
    }));
  res.json({ chapters, count: chapters.length, available: true });
});

api.post("/repertoires/:key/chapters", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Chapter name is required" });
  const stamp = now();
  const max = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM repertoire_chapters WHERE repertoire_id = ?")
    .get(repertoire.id).n;
  const id = Number(
    db
      .prepare(
        `INSERT INTO repertoire_chapters
           (repertoire_id, name, description, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        repertoire.id,
        name,
        String(req.body?.description || ""),
        req.body?.sortOrder == null ? Number(max) + 1 : Number(req.body.sortOrder),
        stamp,
        stamp
      ).lastInsertRowid
  );
  res.status(201).json({
    chapter: db.prepare("SELECT * FROM repertoire_chapters WHERE id = ?").get(id),
  });
});

api.patch("/chapters/:id", requireAuth, (req, res) => {
  const chapter = db
    .prepare(
      `SELECT c.* FROM repertoire_chapters c
       JOIN repertoires r ON r.id = c.repertoire_id
       WHERE c.id = ? AND r.user_id = ?`
    )
    .get(Number(req.params.id), req.user.id);
  if (!chapter) return res.status(404).json({ error: "Chapter not found" });
  const name = req.body?.name != null ? String(req.body.name).trim() : chapter.name;
  const description =
    req.body?.description != null ? String(req.body.description) : chapter.description;
  const sortOrder =
    req.body?.sortOrder != null ? Number(req.body.sortOrder) : chapter.sort_order;
  db.prepare(
    "UPDATE repertoire_chapters SET name = ?, description = ?, sort_order = ?, updated_at = ? WHERE id = ?"
  ).run(name || chapter.name, description, sortOrder, now(), chapter.id);
  res.json({
    chapter: db.prepare("SELECT * FROM repertoire_chapters WHERE id = ?").get(chapter.id),
  });
});

api.delete("/chapters/:id", requireAuth, (req, res) => {
  const chapter = db
    .prepare(
      `SELECT c.* FROM repertoire_chapters c
       JOIN repertoires r ON r.id = c.repertoire_id
       WHERE c.id = ? AND r.user_id = ?`
    )
    .get(Number(req.params.id), req.user.id);
  if (!chapter) return res.status(404).json({ error: "Chapter not found" });
  db.prepare("UPDATE lines SET chapter_id = NULL WHERE chapter_id = ?").run(chapter.id);
  db.prepare("DELETE FROM repertoire_chapters WHERE id = ?").run(chapter.id);
  res.json({ ok: true, deleted: chapter.id });
});

api.get("/repertoires/:key/transpositions", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const lines = db
    .prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id")
    .all(repertoire.id);
  const byEpd = new Map();
  for (const line of lines) {
    const sans = lineSans(line);
    let epds;
    try {
      epds = lineEpds(sans);
    } catch {
      continue;
    }
    epds.forEach((epd, index) => {
      if (!byEpd.has(epd)) byEpd.set(epd, []);
      byEpd.get(epd).push({
        lineId: line.id,
        name: line.name,
        moves: sans,
        ply: index,
        final: index === sans.length,
      });
    });
  }
  const groups = [...byEpd.entries()]
    .filter(([, entries]) => new Set(entries.map((entry) => entry.lineId)).size > 1)
    .map(([epd, entries]) => ({
      epd,
      final: entries.some((entry) => entry.final),
      lines: entries,
    }))
    .sort((a, b) => Number(b.final) - Number(a.final) || a.epd.localeCompare(b.epd));
  res.json({
    repertoire: repStats(repertoire),
    groups,
    count: groups.length,
    available: true,
  });
});

api.post("/repertoires/:key/transpositions/merge", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const epd = cleanEpd(req.body?.epd);
  const keepId = req.body?.keepLineId != null ? Number(req.body.keepLineId) : null;
  const rows = epd
    ? db.prepare("SELECT * FROM lines WHERE repertoire_id = ? AND epd = ? ORDER BY id").all(repertoire.id, epd)
    : db
        .prepare(
          `SELECT l.* FROM lines l
           WHERE l.repertoire_id = ?
             AND l.epd IN (
               SELECT epd FROM lines WHERE repertoire_id = ?
               GROUP BY epd HAVING COUNT(*) > 1
             )
           ORDER BY l.epd, l.id`
        )
        .all(repertoire.id, repertoire.id);
  const grouped = new Map();
  for (const row of rows) {
    if (!row.epd) continue;
    if (!grouped.has(row.epd)) grouped.set(row.epd, []);
    grouped.get(row.epd).push(row);
  }
  const removed = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [finalKey, group] of grouped) {
      if (group.length < 2) continue;
      const keep =
        group.find((row) => row.id === keepId) || group[0];
      for (const row of group) {
        if (row.id === keep.id) continue;
        db.prepare("DELETE FROM lines WHERE id = ?").run(row.id);
        removed.push({ lineId: row.id, epd: finalKey, keptLineId: keep.id });
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  if (removed.length) {
    rebuildRepertoireMoves(db, repertoire.id);
    syncRepertoireTotals(repertoire.id);
  }
  const fresh = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(repertoire.id);
  res.json({ ok: true, removed, merged: removed.length, repertoire: repStats(fresh) });
});

api.post("/repertoires/:key/trim", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const mode = String(req.body?.mode || "autofilled");
  const dryRun = Boolean(req.body?.dryRun);
  const profile = readSettings(db, req.user.id);
  const threshold =
    req.body?.threshold != null
      ? Math.max(0, Number(req.body.threshold))
      : 1 / Math.max(1, profile.coverageGoal);
  const lines = db
    .prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id")
    .all(repertoire.id);
  const remove = new Map();

  if (mode === "autofilled") {
    for (const line of lines) {
      if (line.origin === "autofill") remove.set(line.id, "autofilled");
    }
  } else if (mode === "rare" || mode === "sidelines") {
    const seenFinal = new Set();
    for (const line of lines) {
      if (!line.epd) continue;
      if (seenFinal.has(line.epd)) {
        remove.set(line.id, "transposition");
        continue;
      }
      seenFinal.add(line.epd);
      if (mode !== "rare") continue;
      const sans = lineSans(line);
      const last = sans[sans.length - 1];
      const parentPath = lineSans(line).slice(0, -1);
      const parentEpd = epdFromMoves(parentPath);
      const report = reportForEpd(db, parentEpd, { repertoireColor: repertoire.color });
      const candidate = report?.candidates.find((row) => row.san_key === sanKey(last));
      const probability = candidate?.probability == null ? null : Number(candidate.probability);
      if (probability != null && probability < threshold) {
        remove.set(line.id, "below-threshold");
      }
    }
  } else if (mode === "pastGoal") {
    const fallbackGoal = 1 - 1 / Math.max(1, profile.coverageGoal);
    const goal = Math.max(
      0.01,
      Math.min(1, Number(req.body?.coverageGoal ?? fallbackGoal))
    );
    // Remove the least-likely branches while coverage stays above the goal.
    const coverageRows = [];
    for (const line of lines) {
      const sans = lineSans(line);
      const last = sans[sans.length - 1];
      const parentEpd = epdFromMoves(sans.slice(0, -1));
      const report = reportForEpd(db, parentEpd, { repertoireColor: repertoire.color });
      const candidate = report?.candidates.find((row) => row.san_key === sanKey(last));
      coverageRows.push({
        line,
        probability: Number(candidate?.probability ?? 0),
        report: Boolean(report),
      });
    }
    const total = coverageRows.reduce((sum, row) => sum + row.probability, 0);
    let covered = total;
    for (const row of [...coverageRows].sort((a, b) => a.probability - b.probability)) {
      if (!row.report || total <= 0) continue;
      if (covered / total <= goal) break;
      remove.set(row.line.id, "past-coverage-goal");
      covered -= row.probability;
    }
  } else {
    return res.status(400).json({
      error: "mode must be autofilled, rare, sidelines or pastGoal",
    });
  }

  const removed = [...remove.entries()].map(([lineId, reason]) => ({ lineId, reason }));
  if (!dryRun && removed.length) {
    const removeLine = db.prepare("DELETE FROM lines WHERE id = ?");
    for (const entry of removed) removeLine.run(entry.lineId);
    rebuildRepertoireMoves(db, repertoire.id);
    syncRepertoireTotals(repertoire.id);
  }
  const fresh = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(repertoire.id);
  res.json({
    ok: true,
    mode,
    dryRun,
    removed,
    removedCount: removed.length,
    remaining: lines.length - removed.length,
    repertoire: repStats(fresh),
  });
});

api.post("/repertoires/:key/import", requireAuth, async (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const body = req.body;
  const text =
    typeof body === "string"
      ? body
      : String(body?.pgn ?? body?.text ?? body?.pgnText ?? "");
  if (!text.trim()) {
    return res.status(400).json({ error: "Provide PGN text (pgn, text or a raw text/plain body)" });
  }
  const defaultName = String(body?.name || "").trim();
  const maxPly = body?.maxPly != null ? Math.max(1, Number(body.maxPly)) : null;
  const parsed = parsePgnGames(text);
  const results = [];
  let created = 0;
  let transpositions = 0;

  for (const game of parsed) {
    if (!game.ok) {
      results.push({ ok: false, error: game.error });
      continue;
    }
    let sans = maxPly ? game.sans.slice(0, maxPly) : [...game.sans];
    // A repertoire branch must end on the repertoire's move. Trim a single
    // trailing opponent move rather than silently storing an unanswerable line.
    let trimmed = false;
    if ((sans.length % 2 === 1 ? "white" : "black") !== repertoire.color && sans.length > 1) {
      sans = sans.slice(0, -1);
      trimmed = true;
    }
    if (!sans.length) {
      results.push({ ok: false, error: "The PGN has no move for this repertoire" });
      continue;
    }
    const name =
      defaultName ||
      (game.white && game.black
        ? `${game.white} – ${game.black}`
        : game.event || `Imported line ${results.length + 1}`);
    const added = addLineFromSans(db, repertoire, {
      sans,
      name,
      origin: "import",
      sourceRef: game.event || "pgn",
    });
    if (added.error) {
      results.push({ ok: false, error: added.error });
      continue;
    }
    if (added.created) created += 1;
    if (added.transposition) transpositions += 1;
    results.push({
      ok: true,
      lineId: added.line.id,
      created: added.created,
      transposition: added.transposition,
      transpositionOf: added.transpositionOf,
      trimmed,
      moves: sans.length,
      name: added.line.name,
    });
  }

  const fresh = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(repertoire.id);
  res.status(created ? 201 : 200).json({
    ok: true,
    imported: created,
    transpositions,
    total: parsed.length,
    trimmed: results.filter((result) => result.trimmed).length,
    results,
    repertoire: repStats(fresh),
  });
});

api.get("/repertoires/:key/export", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const format = String(req.query.format || "pgn").toLowerCase();
  if (format === "json") {
    const payload = exportJson(db, repertoire, { stats: repStats(repertoire) });
    if (req.query.download === "1") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${slugify(repertoire.name) || "repertoire"}.json"`
      );
    }
    return res.json(payload);
  }
  if (format !== "pgn") {
    return res.status(400).json({ error: "format must be pgn or json" });
  }
  const text = exportPgn(db, repertoire);
  res.setHeader("Content-Type", "application/x-chess-pgn; charset=utf-8");
  if (req.query.download === "1") {
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${slugify(repertoire.name) || "repertoire"}.pgn"`
    );
  }
  res.send(text);
});

/* ------------------------------------------------------- import/opening --- */

api.get("/openings/supplementary", requireAuth, (req, res) => {
  const epd = cleanEpd(req.query.epd, req.query.fen);
  if (epd) {
    const row = db.prepare("SELECT * FROM opening_names WHERE epd = ?").get(epd);
    return res.json({
      positions: row
        ? [
            {
              epd: row.epd,
              fullName: row.full_name,
              friendlyName: row.friendly_name ?? null,
              source: row.source,
            },
          ]
        : [],
      count: row ? 1 : 0,
      available: Boolean(row),
    });
  }
  const q = String(req.query.q || "").trim();
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = q
    ? db
        .prepare(
          `SELECT * FROM opening_names WHERE full_name LIKE ? OR friendly_name LIKE ?
           ORDER BY full_name LIMIT ? OFFSET ?`
        )
        .all(`%${q}%`, `%${q}%`, limit, offset)
    : db
        .prepare("SELECT * FROM opening_names ORDER BY full_name LIMIT ? OFFSET ?")
        .all(limit, offset);
  const total = q
    ? db
        .prepare("SELECT COUNT(*) AS n FROM opening_names WHERE full_name LIKE ? OR friendly_name LIKE ?")
        .get(`%${q}%`, `%${q}%`).n
    : db.prepare("SELECT COUNT(*) AS n FROM opening_names").get().n;
  res.json({
    positions: rows.map((row) => ({
      epd: row.epd,
      fullName: row.full_name,
      friendlyName: row.friendly_name ?? null,
      source: row.source,
    })),
    count: rows.length,
    total,
    offset,
    hasMore: offset + rows.length < total,
    source: "recon/live4/network.json#5 (/api/v1/openings/supplementary)",
  });
});

api.get("/openings/position", requireAuth, (req, res) => {
  const epd =
    cleanEpd(req.query.epd, req.query.fen) ||
    (req.query.moves ? epdFromMoves(req.query.moves) : null);
  if (!epd) return res.status(400).json({ error: "Provide epd, fen or moves" });
  const report = reportForEpd(db, epd);
  const detail = candidateList(db, { epd, repertoire: null, prefixMoves: [] });
  const name = fullNameForEpd(db, epd);
  const alias = db.prepare("SELECT * FROM opening_aliases WHERE epd = ? LIMIT 1").get(epd);
  res.json({
    position: {
      epd,
      fen: detail.fen,
      side: detail.side,
      name: name.name,
      fullName: name.fullName,
      friendlyName: name.friendlyName,
      aliases: alias
        ? [{ fullName: alias.full_name, friendlyName: alias.friendly_name, targetEpd: alias.target_epd, kind: alias.kind }]
        : [],
      annotations: annotationsForPosition(db, epd),
      plans: report ? safeJson(report.plans, []) : [],
      plansAvailable: Boolean(report && safeJson(report.plans, []).length),
      stockfish: detail.stockfish,
      masterResults: report
        ? {
            white: report.master_white,
            draw: report.master_draw,
            black: report.master_black,
          }
        : null,
      peerResults: report
        ? {
            white: report.peer_white,
            draw: report.peer_draw,
            black: report.peer_black,
          }
        : null,
      reportAvailable: Boolean(report),
      reportSource: report?.source ?? null,
      complete: report ? Boolean(report.complete) : null,
      ratingBand: detail.ratingBand,
      incidenceByBand: detail.incidenceByBand,
      bandsAvailable: detail.bandsAvailable,
    },
    candidates: detail.candidates,
    available: detail.available,
    source: detail.source,
  });
});

api.get("/openings/imports", requireAuth, (_req, res) => {
  const imports = db
    .prepare("SELECT * FROM opening_imports ORDER BY imported_at DESC")
    .all()
    .map((row) => ({
      source: row.source,
      version: row.version,
      rows: row.rows,
      importedAt: row.imported_at,
    }));
  const current = db
    .prepare("SELECT version, COUNT(*) AS rows FROM openings GROUP BY version")
    .all();
  res.json({ imports, current });
});

api.post("/openings/reimport", requireAuth, (req, res) => {
  loadOpenings({ force: Boolean(req.body?.force) });
  const imports = db
    .prepare("SELECT * FROM opening_imports ORDER BY imported_at DESC")
    .all()
    .map((row) => ({
      source: row.source,
      version: row.version,
      rows: row.rows,
      importedAt: row.imported_at,
    }));
  res.json({
    ok: true,
    imports,
    current:
      db.prepare("SELECT version, COUNT(*) AS rows FROM openings GROUP BY version").all(),
    skipped: process.env.CHESSBOOK_SKIP_OPENINGS === "1",
  });
});

api.get("/openings/report", requireAuth, (req, res) => {
  const timeRange = String(req.query.timeRange || "90d");
  const captured = db.prepare("SELECT * FROM data_sources WHERE dataset = 'positions'").get();
  const days = /^(\d+)d$/.exec(timeRange);
  const rangeClause = days
    ? "AND julianday(rv.created_at) >= julianday('now', ?)"
    : "";
  const rangeValue = days ? `-${Number(days[1])} days` : null;
  const rows = db
    .prepare(
      `SELECT l.name AS name, l.id AS lineId, r.color AS color,
              COUNT(rv.id) AS reviews,
              COALESCE(SUM(rv.correct), 0) AS correct,
              COALESCE(SUM(CASE WHEN rv.correct = 0 THEN 1 ELSE 0 END), 0) AS wrong
       FROM lines l
       JOIN repertoires r ON r.id = l.repertoire_id
       LEFT JOIN reviews rv ON rv.line_id = l.id ${rangeClause}
       GROUP BY l.id
       HAVING reviews > 0
       ORDER BY wrong DESC, reviews DESC`
    )
    .all(...(rangeValue ? [rangeValue] : []));
  const weak = rows
    .filter((row) => row.wrong > 0)
    .map((row) => ({
      name: row.name,
      lineId: row.lineId,
      color: row.color,
      reviews: row.reviews,
      correct: row.correct,
      wrong: row.wrong,
      accuracy: row.reviews ? Math.round((row.correct / row.reviews) * 1000) / 10 : null,
      source: "local-reviews",
    }))
    .slice(0, 10);
  const worst = [...weak].sort((a, b) => a.accuracy - b.accuracy).slice(0, 10);
  res.json({
    timeRange,
    available: true,
    capturedAvailable: false,
    captured: [],
    source: weak.length ? "local-reviews" : null,
    weak,
    worst,
    reason: weak.length ? null : "No reviewed lines in this local profile yet.",
    importedAt: captured?.imported_at ?? null,
  });
});

api.get("/openings/guides", requireAuth, (req, res) => {
  const side = req.query.side === "white" || req.query.side === "black" ? req.query.side : null;
  const q = String(req.query.q || "").trim();
  const rows = db
    .prepare(
      `SELECT * FROM opening_guides
       ${side ? "WHERE side = ?" : "WHERE 1=1"}
       ${q ? "AND (name LIKE ? OR eco LIKE ?)" : ""}
       ORDER BY sort_order`
    )
    .all(...[side, q ? `%${q}%` : null, q ? `%${q}%` : null].filter((value) => value != null));
  const guides = rows.map((row) => {
    const course = findCourseForGuide(db, row);
    return {
      id: row.id,
      slug: row.slug,
      eco: row.eco,
      name: row.name,
      side: row.side,
      family: row.family,
      moves: String(row.sans || "").split(" ").filter(Boolean),
      pgn: row.pgn,
      epd: row.epd,
      coverage: course?.coverage ?? null,
      coveragePercent:
        course?.coverage == null
          ? null
          : Math.round(Number(course.coverage) * 1000) / 10,
      course: course ? { id: course.id, slug: course.slug, name: course.name } : null,
      source: row.source,
    };
  });
  res.json({
    guides,
    white: guides.filter((guide) => guide.side === "white"),
    black: guides.filter((guide) => guide.side === "black"),
    total: guides.length,
    available: guides.length > 0,
    source: "recon/live6/02-openings.json",
  });
});

api.get("/openings/guides/:slug", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT * FROM opening_guides WHERE slug = ? OR name = ? LIMIT 1")
    .get(String(req.params.slug), String(req.params.slug));
  if (!row) return res.status(404).json({ error: "Opening guide not found" });
  const sans = String(row.sans || "").split(" ").filter(Boolean);
  const chess = new Chess();
  const steps = [];
  let notes = [];
  for (let i = 0; i < sans.length; i += 1) {
    const epd = epdOf(chess.fen());
    const fen = chess.fen();
    const move = chess.move(sans[i]);
    const annotation = annotationForMove(db, epd, move.san);
    const positionAnnotations = annotationsForPosition(db, epd);
    notes.push(
      ...positionAnnotations
        .filter((annotation) => !annotation.san || annotation.san === move.san)
        .map((annotation) => ({ ...annotation, ply: i + 1 }))
    );
    steps.push({
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      side: move.color === "w" ? "white" : "black",
      san: move.san,
      epd,
      fen,
      fenAfter: chess.fen(),
      annotation: annotation?.text ?? null,
      name: fullNameForEpd(db, epdOf(chess.fen())).name,
    });
  }
  const report = reportForEpd(db, row.epd, { repertoireColor: row.side });
  const course = findCourseForGuide(db, row);
  res.json({
    guide: {
      id: row.id,
      slug: row.slug,
      eco: row.eco,
      name: row.name,
      side: row.side,
      family: row.family,
      moves: sans,
      pgn: row.pgn,
      epd: row.epd,
      steps,
      notes,
      notesAvailable: notes.length > 0,
      plans: report?.plans ? JSON.parse(report.plans) : [],
      plansAvailable: Boolean(report?.plans && JSON.parse(report.plans).length),
      reportAvailable: Boolean(report),
      coverage: course?.coverage ?? null,
      coveragePercent:
        course?.coverage == null
          ? null
          : Math.round(Number(course.coverage) * 1000) / 10,
      course: course ? { id: course.id, slug: course.slug, name: course.name } : null,
      source: row.source,
    },
  });
});

api.get("/openings/:slug", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT * FROM opening_guides WHERE slug = ? OR name = ? LIMIT 1")
    .get(String(req.params.slug), String(req.params.slug));
  if (!row) return res.status(404).json({ error: "Opening guide not found" });
  res.redirect(307, `/api/openings/guides/${encodeURIComponent(row.slug)}`);
});

api.get("/courses", requireAuth, (req, res) => {
  const side = req.query.side === "white" || req.query.side === "black" ? req.query.side : null;
  const q = String(req.query.q || "").trim();
  const official = req.query.official;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const clauses = [];
  const values = [];
  if (side) {
    clauses.push("side = ?");
    values.push(side);
  }
  if (q) {
    clauses.push("(name LIKE ? OR description LIKE ?)");
    values.push(`%${q}%`, `%${q}%`);
  }
  if (official === "1" || official === "true") clauses.push("official = 1");
  if (official === "0" || official === "false") clauses.push("official = 0");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) AS n FROM courses ${where}`).get(...values).n;
  const rows = db
    .prepare(`SELECT * FROM courses ${where} ORDER BY official DESC, side, name LIMIT ? OFFSET ?`)
    .all(...values, limit, offset);
  res.json({
    courses: rows.map(courseOut),
    total,
    offset,
    hasMore: offset + rows.length < total,
    available: total > 0,
    source: "recon position reports (courses arrays)",
  });
});

api.get("/courses/:id", requireAuth, (req, res) => {
  const key = String(req.params.id);
  const row = db
    .prepare("SELECT * FROM courses WHERE id = ? OR slug = ? LIMIT 1")
    .get(key, key);
  if (!row) return res.status(404).json({ error: "Course not found" });
  const chapters = db
    .prepare("SELECT * FROM course_chapters WHERE course_id = ? ORDER BY sort_order")
    .all(row.id)
    .map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      description: chapter.description,
      sortOrder: chapter.sort_order,
    }));
  const guide = findGuideForCourse(db, row);
  res.json({
    course: {
      ...courseOut(row),
      chapters,
      chaptersAvailable: chapters.length > 0,
      guide: guide
        ? { slug: guide.slug, name: guide.name, moves: String(guide.sans || "").split(" ") }
        : null,
    },
  });
});

api.post("/courses/:id/clone", requireAuth, (req, res) => {
  const key = String(req.params.id);
  const course = db
    .prepare("SELECT * FROM courses WHERE id = ? OR slug = ? LIMIT 1")
    .get(key, key);
  if (!course) return res.status(404).json({ error: "Course not found" });
  const name = String(req.body?.name || course.name).trim() || course.name;
  const repertoireId = createRepertoire(
    req.user.id,
    course.side,
    name,
    course.description || ""
  );
  const guide = findGuideForCourse(db, course);
  let imported = 0;
  if (guide) {
    const sans = String(guide.sans || "").split(" ").filter(Boolean);
    const added = addLineFromSans(db, db.prepare("SELECT * FROM repertoires WHERE id = ?").get(repertoireId), {
      sans,
      name: guide.name,
      origin: "course",
      sourceRef: `course:${course.id}`,
    });
    if (added.created) imported += 1;
  }
  rebuildRepertoireMoves(db, repertoireId);
  syncRepertoireTotals(repertoireId);
  const repertoire = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(repertoireId);
  res.status(201).json({
    repertoire: repStats(repertoire),
    course: courseOut(course),
    imported,
    guide: guide ? guide.slug : null,
    chapters: [],
    chaptersAvailable: false,
    note:
      "The capture contains course metadata and a matching opening line, but no chapter/move tree; the cloned repertoire starts with that line.",
  });
});

api.get("/coaches", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM coaches ORDER BY name COLLATE NOCASE").all();
  res.json({
    coaches: rows.map(coachOut),
    total: rows.length,
    available: rows.length > 0,
    source: "recon/live6/04-coaches.json",
  });
});

api.get("/coaches/:slug", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT * FROM coaches WHERE slug = ? OR name = ? LIMIT 1")
    .get(String(req.params.slug), String(req.params.slug));
  if (!row) return res.status(404).json({ error: "Coach not found" });
  res.json({ coach: coachOut(row) });
});

api.get("/blog", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM blog_posts ORDER BY published_at DESC, sort_order")
    .all();
  res.json({
    posts: rows.map(postOut),
    total: rows.length,
    available: rows.length > 0,
    source: "recon/live6/05-blog.json",
  });
});

api.get("/blog/:slug", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT * FROM blog_posts WHERE slug = ? OR title = ? LIMIT 1")
    .get(String(req.params.slug), String(req.params.slug));
  if (!row) return res.status(404).json({ error: "Blog post not found" });
  res.json({ post: postOut(row), bodyAvailable: false });
});

function courseOut(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    side: row.side,
    authorName: row.author_name ?? null,
    authorTitle: row.author_title ?? null,
    avatarImage: row.avatar_image ?? null,
    description: row.description ?? null,
    descriptionShort: row.description_short ?? null,
    official: Boolean(row.official),
    featured: Boolean(row.featured),
    moveCount: row.move_count ?? null,
    coverage: row.coverage,
    coveragePercent:
      row.coverage == null ? null : Math.round(Number(row.coverage) * 1000) / 10,
    eloRanges: safeJson(row.elo_ranges, []),
    characteristics: {
      available: Object.keys(safeJson(row.characteristics, {})).length > 0,
      ...safeJson(row.characteristics, {}),
    },
    videoId: row.video_id ?? null,
    source: row.source,
  };
}

function coachOut(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    rating: row.rating,
    headline: row.headline,
    bio: row.bio,
    languages: safeJson(row.languages, []),
    price: row.price,
    platforms: safeJson(row.platforms, []),
    firstLessonFree: Boolean(row.first_lesson_free),
    source: row.source,
  };
}

function postOut(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    publishedAt: row.published_at,
    excerpt: row.excerpt,
    sortOrder: row.sort_order,
    source: row.source,
  };
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function findGuideForCourse(db, course) {
  const guides = db.prepare("SELECT * FROM opening_guides WHERE side = ? ORDER BY sort_order").all(course.side);
  const words = String(course.name || "").toLowerCase();
  const direct = guides.find((guide) => {
    const guideName = String(guide.name || "").toLowerCase();
    return words.includes(guideName) || guideName.includes(words);
  });
  if (direct) return direct;
  const aliases = [
    ["spanish", "ruy lopez"],
    ["qgd", "queen's gambit declined"],
    ["caro-kann", "caro-kann"],
    ["london", "london"],
    ["reti", "réti"],
    ["nimzo-larsen", "nimzo-larsen"],
    ["bird", "bird"],
    ["kings-indian-attack", "king's indian attack"],
    ["english", "english"],
  ];
  for (const [needle, guideNeedle] of aliases) {
    if (words.includes(needle)) {
      const match = guides.find((guide) =>
        String(guide.name).toLowerCase().includes(guideNeedle)
      );
      if (match) return match;
    }
  }
  return null;
}

function findCourseForGuide(db, guide) {
  const courses = db
    .prepare("SELECT * FROM courses WHERE side = ? ORDER BY official DESC, name")
    .all(guide.side);
  const guideName = String(guide.name || "").toLowerCase();
  const family = String(guide.family || "").toLowerCase();
  const direct =
    courses.find((course) => {
      const name = String(course.name || "").toLowerCase();
      return name.includes(guideName) || name.includes(family);
    }) || null;
  if (direct) return direct;

  const aliases = [
    ["ruy lopez", "spanish"],
    ["queen's gambit declined", "qgd"],
    ["queen's gambit", "qgd"],
    ["caro-kann", "caro-kann"],
    ["london", "london"],
    ["réti", "reti"],
    ["reti", "reti"],
    ["nimzo-larsen", "nimzo-larsen"],
    ["bird opening", "bird"],
    ["king's indian attack", "kings-indian-attack"],
    ["english opening", "english"],
    ["italian game", "italian"],
    ["scandinavian defense", "scandinavian"],
    ["french defense", "french"],
    ["sicilian defense", "sicilian"],
  ];
  for (const [guideNeedle, courseNeedle] of aliases) {
    if (guideName.includes(guideNeedle) || family.includes(guideNeedle)) {
      const match = courses.find((course) =>
        String(course.name).toLowerCase().includes(courseNeedle)
      );
      if (match) return match;
    }
  }
  return null;
}


api.get("/repertoires", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM repertoires WHERE user_id = ? ORDER BY id")
    .all(req.user.id)
    .map(repStats);
  res.json({ repertoires: rows });
});

api.post("/repertoires", requireAuth, (req, res) => {
  const color = String(req.body?.color || "");
  const name = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim();
  if (!["white", "black"].includes(color)) {
    return res.status(400).json({ error: "Choose white or black" });
  }
  if (!name) return res.status(400).json({ error: "Name is required" });
  const id = createRepertoire(req.user.id, color, name, description);
  const repertoire = repStats(db.prepare("SELECT * FROM repertoires WHERE id = ?").get(id));
  res.status(201).json({ repertoire });
});

api.get("/repertoires/:key", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const lines = db
    .prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id")
    .all(repertoire.id)
    .map((line) => lineView(line, repertoire));
  const chapters = db
    .prepare("SELECT * FROM repertoire_chapters WHERE repertoire_id = ? ORDER BY sort_order, id")
    .all(repertoire.id)
    .map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      description: chapter.description,
      sortOrder: chapter.sort_order,
      lineCount: lines.filter((line) => line.chapterId === chapter.id).length,
    }));
  const captured = db
    .prepare("SELECT * FROM repertoire_characteristics WHERE repertoire_id = ?")
    .get(repertoire.id);
  res.json({
    repertoire: repStats(repertoire),
    lines,
    chapters,
    chaptersAvailable: true,
    characteristicsSource: captured?.source ?? null,
    coverageSource: captured?.source ?? null,
  });
});

api.patch("/repertoires/:key", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const name = req.body?.name != null ? String(req.body.name).trim() : repertoire.name;
  const description =
    req.body?.description != null
      ? String(req.body.description).trim()
      : repertoire.description;
  db.prepare("UPDATE repertoires SET name = ?, description = ? WHERE id = ?").run(
    name || repertoire.name,
    description,
    repertoire.id
  );
  res.json({
    repertoire: repStats(
      db.prepare("SELECT * FROM repertoires WHERE id = ?").get(repertoire.id)
    ),
  });
});

api.delete("/repertoires/:key", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  db.prepare("DELETE FROM repertoires WHERE id = ?").run(repertoire.id);
  persistStreak(db, req.user.id, req.query.tzOffset);
  res.json({ ok: true, deleted: repertoire.id });
});

/**
 * Reset learning (D153): clears attempts, reviews and sessions as well as the
 * derived per-move scheduling state. The repertoire's saved moves stay saved.
 */
api.post("/repertoires/:key/reset", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const stamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM reviews WHERE repertoire_id = ?").run(repertoire.id);
    db.prepare(
      "DELETE FROM attempts WHERE line_id IN (SELECT id FROM lines WHERE repertoire_id = ?)"
    ).run(repertoire.id);
    db.prepare("DELETE FROM practice_sessions WHERE repertoire_id = ?").run(repertoire.id);
    db.prepare(
      `UPDATE line_moves
       SET state = 'new', stability = 0, difficulty = 0, lapses = 0, reps = 0,
           wrong_count = 0, last_correct = NULL, due_at = NULL, last_review = NULL,
           kept = 0, learned = 0, updated_at = ?
       WHERE repertoire_id = ?`
    ).run(stamp, repertoire.id);
    db.prepare(
      "UPDATE lines SET learned = 0, mastered = 0, due_at = NULL WHERE repertoire_id = ?"
    ).run(repertoire.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  persistStreak(db, req.user.id, req.query.tzOffset);
  res.json({ ok: true, repertoire: repStats(repertoire) });
});

function cleanEpd(...values) {
  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    if (raw.includes("/")) {
      const parts = raw.split(/\s+/);
      if (parts.length >= 4) {
        const epd = parts.slice(0, 4).join(" ");
        if (isEpdLike(epd)) return epd;
      }
    }
  }
  return null;
}

function epdFromMoves(moves) {
  const sans = Array.isArray(moves)
    ? moves.map(String)
    : String(moves || "").split(/\s+/).filter(Boolean);
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return epdOf(chess.fen());
}

function requestPosition(req, repertoire) {
  const explicit = cleanEpd(req.query.epd, req.query.fen);
  if (explicit) {
    const path = pathForEpd(db, repertoire.id, explicit);
    return { epd: explicit, prefixMoves: path?.prefixMoves ?? [] };
  }
  if (req.query.moves || req.query.path || req.query.sans) {
    const moves = req.query.moves ?? req.query.path ?? req.query.sans;
    const epd = epdFromMoves(moves);
    const sans = Array.isArray(moves)
      ? moves.map(String)
      : String(moves).split(/\s+/).filter(Boolean);
    return { epd, prefixMoves: sans };
  }
  if (req.query.line || req.query.lineId) {
    const line = getLineForUser(req.user.id, Number(req.query.line ?? req.query.lineId));
    if (!line) return null;
    const sans = lineSans(line);
    const ply = req.query.ply != null ? Math.max(1, Math.min(sans.length, Number(req.query.ply))) : sans.length;
    const chess = new Chess();
    for (const san of sans.slice(0, ply - 1)) chess.move(san);
    return { epd: epdOf(chess.fen()), prefixMoves: sans.slice(0, ply - 1), lineId: line.id };
  }
  return null;
}

function gapResponse(repertoire, detail, gap, gaps = [], req) {
  const limit =
    req.query.limit != null ? Math.max(0, Number(req.query.limit)) : null;
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const shown = detail
    ? {
        ...detail,
        candidates: limit == null
          ? detail.candidates.slice(offset)
          : detail.candidates.slice(offset, offset + limit),
        offset,
        limit,
        hasMore: offset + (limit == null ? detail.candidates.length : limit) < detail.candidates.length,
        nextOffset:
          offset + (limit == null ? detail.candidates.length : limit) < detail.candidates.length
            ? offset + (limit == null ? detail.candidates.length : limit)
            : null,
      }
    : null;
  const path = gap?.path ?? detail?.prefixMoves ?? [];
  const heading = positionHeading(path, detail?.side ?? gap?.side ?? repertoire.color);
  const line = gap?.lineId
    ? db.prepare("SELECT * FROM lines WHERE id = ?").get(gap.lineId)
    : null;
  return {
    repertoire: repStats(repertoire),
    gap: line ? lineView(line, repertoire) : null,
    line: line ? lineView(line, repertoire) : null,
    position: gap
      ? {
          epd: gap.epd,
          fen: gap.fen,
          side: gap.side,
          ply: gap.ply,
          moveNumber: gap.moveNumber,
          prefixMoves: path,
          pathPgn: gap.pathPgn ?? pgnFromSans(path),
          heading,
          note:
            notesForPosition(db, repertoire.id, gap.epd).find((note) => !note.san) ??
            null,
          annotations: annotationsForPosition(db, gap.epd),
          incidence: gap.incidence ?? null,
          oneIn: gap.oneIn ?? null,
          candidateCount: gap.candidateCount ?? null,
          savedCount: gap.savedCount ?? null,
          missingCount: gap.missingCount ?? null,
          coverage: gap.coverage ?? null,
          bestMissing: gap.bestMissing ?? null,
          capturedMiss: Boolean(gap.capturedMiss),
        }
      : null,
    // Full ranked candidate list for the current position. This is not the
    // saved-line list: every captured candidate is returned in play-rate order.
    candidates: shown?.candidates ?? [],
    candidatePosition: shown,
    available: Boolean(shown?.available),
    candidateSource: shown?.source ?? null,
    total: shown?.total ?? 0,
    hasMore: Boolean(shown?.hasMore),
    nextOffset: shown?.nextOffset ?? null,
    gaps,
    stats: repStats(repertoire),
    coverageGoal: readSettings(db, repertoire.user_id).coverageGoal,
    ratingBand: bandMatch(db, readSettings(db, repertoire.user_id)),
  };
}

api.get("/repertoires/:key/gap", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const requested = requestPosition(req, repertoire);
  const lineId = requested?.lineId ?? (req.query.lineId ? Number(req.query.lineId) : null);
  const coverageGoal = readSettings(db, req.user.id).coverageGoal;
  const selection = chooseGap(db, repertoire, {
    lineId: lineId && !requested?.epd ? lineId : null,
    epd: requested?.epd ?? null,
    afterEpd: cleanEpd(req.query.after),
    coverageGoal,
  });
  const detail = selection.detail ?? selection.position;
  res.json(
    gapResponse(repertoire, detail, selection.gap, selection.gaps, req)
  );
});

api.get("/repertoires/:key/gaps", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const lineId = req.query.lineId ? Number(req.query.lineId) : null;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const coverageGoal = readSettings(db, req.user.id).coverageGoal;
  const gaps = computeGaps(db, repertoire, { lineId, limit, coverageGoal });
  res.json({
    repertoire: repStats(repertoire),
    gaps,
    total: gaps.length,
    available: gaps.length > 0,
  });
});

api.get("/repertoires/:key/gap/next", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const afterEpd = cleanEpd(req.query.after, req.query.epd);
  const lineId = req.query.lineId ? Number(req.query.lineId) : null;
  const coverageGoal = readSettings(db, req.user.id).coverageGoal;
  const selection = chooseGap(db, repertoire, { lineId, afterEpd, coverageGoal });
  const detail = selection.detail ?? selection.position;
  res.json(gapResponse(repertoire, detail, selection.gap, selection.gaps, req));
});

/**
 * Builder: the full ranked candidate list for a position (saved and missing
 * moves), with the exact path, notes and opening names. It never restricts the
 * list to already-saved lines.
 */
api.get("/repertoires/:key/candidates", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const requested = requestPosition(req, repertoire);
  const epd = requested?.epd ?? epdOf(new Chess().fen());
  const limit = req.query.limit != null ? Math.max(0, Number(req.query.limit)) : null;
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const detail = candidateList(db, {
    epd,
    repertoire,
    prefixMoves: requested?.prefixMoves ?? pathForEpd(db, repertoire.id, epd)?.prefixMoves ?? [],
    includeExcluded: req.query.hideExcluded !== "1",
    limit,
    offset,
  });
  const heading = positionHeading(detail.prefixMoves, detail.side);
  const line = requested?.lineId
    ? db.prepare("SELECT * FROM lines WHERE id = ?").get(requested.lineId)
    : null;
  res.json({
    repertoire: repStats(repertoire),
    position: {
      ...detail,
      heading,
      note:
        notesForPosition(db, repertoire.id, epd).find((note) => !note.san) ?? null,
      annotations: annotationsForPosition(db, epd),
    },
    line: line ? lineView(line, repertoire) : null,
    candidates: detail.candidates,
    total: detail.total,
    hasMore: detail.hasMore,
    nextOffset: detail.nextOffset,
    available: detail.available,
    stats: repStats(repertoire),
  });
});


function persistExclusion(repertoire, epd, san) {
  const clean = String(epd || "").split(" ").slice(0, 4).join(" ");
  if (!isEpdLike(clean)) return false;
  let chess;
  try {
    chess = new Chess(fenFromEpd(clean));
  } catch {
    return false;
  }
  const move = findLegalMove(chess.fen(), san);
  if (!move) return false;
  db.prepare(
    `INSERT OR IGNORE INTO repertoire_exclusions
       (repertoire_id, epd, san, san_key, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(repertoire.id, clean, move.san, sanKey(move.san), now());
  return true;
}

function autofillAt(repertoire, epd, { style = "expected", maxMoves = 1, dryRun = false } = {}) {
  const path = pathForEpd(db, repertoire.id, epd);
  const detail = candidateList(db, {
    epd,
    repertoire,
    prefixMoves: path?.prefixMoves ?? [],
    includeExcluded: false,
  });
  if (!detail.available) {
    return { epd, inserted: [], skipped: [{ reason: "no-captured-report" }], considered: 0 };
  }
  if (detail.side !== repertoire.color) {
    return {
      epd,
      inserted: [],
      skipped: [{ reason: "not-your-turn", side: detail.side }],
      considered: detail.candidates.length,
    };
  }
  const playable = detail.candidates.filter(
    (candidate) => !candidate.saved && !candidate.excluded
  );
  const ranked = [...playable].sort((a, b) => {
    const as = scoreCandidate(a, style);
    const bs = scoreCandidate(b, style);
    return bs - as || Number(b.probability ?? 0) - Number(a.probability ?? 0);
  });
  const selected = ranked.slice(0, Math.max(1, Math.min(5, Number(maxMoves) || 1)));
  const inserted = [];
  const skipped = [];
  for (const candidate of selected) {
    if (dryRun) {
      inserted.push({
        epd,
        san: candidate.san,
        name: candidate.name,
        rank: candidate.rank,
        style,
        styleScore: Math.round(scoreCandidate(candidate, style) * 1e6) / 1e6,
        dryRun: true,
      });
      continue;
    }
    const added = addBranchAt(db, repertoire, {
      epd,
      san: candidate.san,
      name: candidate.name || path?.lineName || `${repertoire.name} line`,
      origin: "autofill",
      autofillStyle: style,
      sourceRef: candidate.source,
    });
    if (added.error) {
      skipped.push({ san: candidate.san, reason: added.error });
    } else {
      inserted.push({
        epd,
        san: candidate.san,
        name: candidate.name,
        lineId: added.line.id,
        name: added.line.name,
        created: added.created,
        transpositionOf: added.transpositionOf,
        rank: candidate.rank,
        style,
        styleScore: Math.round(scoreCandidate(candidate, style) * 1e6) / 1e6,
      });
    }
  }
  for (const candidate of playable.filter((c) => !selected.includes(c))) {
    skipped.push({ san: candidate.san, reason: "not-selected" });
  }
  return { epd, inserted, skipped, considered: detail.candidates.length, style };
}

api.post("/repertoires/:key/autofill", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const style = STYLES.includes(String(req.body?.style || ""))
    ? String(req.body.style)
    : "expected";
  const requested = requestPosition(req, repertoire);
  const explicit = requested?.epd ?? cleanEpd(req.body?.epd, req.body?.fen);
  const dryRun = Boolean(req.body?.dryRun);
  const maxMoves = Math.max(1, Math.min(5, Number(req.body?.maxMoves) || 1));

  // Persist exclusions sent with the autofill request.
  const exclusions = Array.isArray(req.body?.excludeMoves) ? req.body.excludeMoves : [];
  for (const exclusion of exclusions) {
    const epd = cleanEpd(exclusion.epd) || explicit;
    if (epd && exclusion.san) persistExclusion(repertoire, epd, exclusion.san);
  }

  let targetEpd = explicit;
  if (!targetEpd) {
    const selection = chooseGap(db, repertoire);
    targetEpd = selection.gap?.epd ?? null;
  }
  if (!targetEpd) {
    return res.status(404).json({
      error: "No captured candidate position is available to autofill",
      code: "no_candidates",
      filled: 0,
      considered: 0,
      repertoire: repStats(repertoire),
    });
  }

  const targets = [];
  if (req.body?.allFromHere || req.body?.all === true) {
    const selection = chooseGap(db, repertoire, { epd: targetEpd });
    const startPath = selection.position?.prefixMoves ?? [];
    const gaps = computeGaps(db, repertoire, { limit: 200 });
    const fromHere = gaps.filter(
      (gap) =>
        gap.path.length >= startPath.length &&
        startPath.every((san, index) => gap.path[index] === san)
    );
    targets.push(targetEpd);
    for (const gap of fromHere) {
      if (gap.epd !== targetEpd) targets.push(gap.epd);
      if (targets.length >= 20) break;
    }
  } else {
    targets.push(targetEpd);
  }

  const results = [];
  const inserted = [];
  const skipped = [];
  for (const epd of [...new Set(targets)]) {
    const result = autofillAt(repertoire, epd, { style, maxMoves, dryRun });
    results.push(result);
    inserted.push(...result.inserted);
    skipped.push(
      ...result.skipped.map((entry) => ({ ...entry, epd: result.epd }))
    );
  }

  const fresh = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(repertoire.id);
  res.json({
    filled: inserted.length,
    considered: results.reduce((n, result) => n + result.considered, 0),
    inserted,
    skipped,
    style,
    styles: STYLES,
    styleSource: "heuristic-from-captured-fields",
    dryRun,
    targetEpd,
    allFromHere: Boolean(req.body?.allFromHere || req.body?.all === true),
    positions: results.map((result) => ({
      epd: result.epd,
      inserted: result.inserted.length,
      considered: result.considered,
      skipped: result.skipped.length,
    })),
    repertoire: repStats(fresh),
  });
});

api.get("/repertoires/:key/exclusions", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const epd = cleanEpd(req.query.epd);
  const rows = epd
    ? db
        .prepare("SELECT * FROM repertoire_exclusions WHERE repertoire_id = ? AND epd = ? ORDER BY id")
        .all(repertoire.id, epd)
    : db
        .prepare("SELECT * FROM repertoire_exclusions WHERE repertoire_id = ? ORDER BY epd, id")
        .all(repertoire.id);
  res.json({
    exclusions: rows.map((row) => ({
      id: row.id,
      epd: row.epd,
      san: row.san,
      createdAt: row.created_at,
    })),
    count: rows.length,
  });
});

api.post("/repertoires/:key/exclusions", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const epd = cleanEpd(req.body?.epd, req.body?.fen);
  if (!epd) return res.status(400).json({ error: "A valid epd or fen is required" });
  const moves = Array.isArray(req.body?.moves) ? req.body.moves : [req.body?.san];
  const added = [];
  for (const san of moves) {
    if (!san) continue;
    if (persistExclusion(repertoire, epd, san)) added.push(san);
  }
  if (!added.length) return res.status(400).json({ error: "No legal move to exclude" });
  res.status(201).json({
    ok: true,
    added,
    exclusions: db
      .prepare("SELECT * FROM repertoire_exclusions WHERE repertoire_id = ? AND epd = ?")
      .all(repertoire.id, epd)
      .map((row) => ({ id: row.id, epd: row.epd, san: row.san, createdAt: row.created_at })),
  });
});

api.delete("/repertoires/:key/exclusions/:id", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const row = db
    .prepare("SELECT * FROM repertoire_exclusions WHERE id = ? AND repertoire_id = ?")
    .get(Number(req.params.id), repertoire.id);
  if (!row) return res.status(404).json({ error: "Exclusion not found" });
  db.prepare("DELETE FROM repertoire_exclusions WHERE id = ?").run(row.id);
  res.json({ ok: true, deleted: row.id });
});

api.delete("/repertoires/:key/exclusions", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const epd = cleanEpd(req.query.epd);
  const san = req.query.san ? String(req.query.san) : null;
  if (!epd) return res.status(400).json({ error: "epd is required" });
  const result = san
    ? db
        .prepare("DELETE FROM repertoire_exclusions WHERE repertoire_id = ? AND epd = ? AND san_key = ?")
        .run(repertoire.id, epd, sanKey(san))
    : db
        .prepare("DELETE FROM repertoire_exclusions WHERE repertoire_id = ? AND epd = ?")
        .run(repertoire.id, epd);
  res.json({ ok: true, deleted: Number(result.changes || 0) });
});

/* ------------------------------------------------------- branch operations --- */

/**
 * Reversible branch disable (D052).
 *
 * POST /repertoires/:key/branches/disable { epd, san }
 *   → { ok, disabled:{epd,san,lineIds,lineCount}, snapshot, state }
 * POST /repertoires/:key/branches/enable  { epd, san }
 *   → { ok, enabled, state }
 * GET  /repertoires/:key/branches
 *   → { disabled:[…], lines:[…], state }
 *
 * A disabled branch removes the move and every later move of the affected
 * lines from practice/stats. Review history is preserved; enabling restores
 * exactly the previous queue. `state` reports the resulting counts.
 */
api.get("/repertoires/:key/branches", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const disabled = db
    .prepare("SELECT * FROM branch_states WHERE repertoire_id = ? AND disabled = 1 ORDER BY id")
    .all(repertoire.id)
    .map((row) => ({
      epd: row.epd,
      san: row.san,
      snapshot: safeJson(row.snapshot, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  const lines = db
    .prepare("SELECT id, name, moves, disabled FROM lines WHERE repertoire_id = ? AND disabled = 1 ORDER BY id")
    .all(repertoire.id)
    .map((row) => ({ id: row.id, name: row.name, disabled: Boolean(row.disabled) }));
  const state = {
    lines: lines.length,
    moves: db
      .prepare("SELECT COUNT(*) AS n FROM line_moves WHERE repertoire_id = ? AND disabled = 1")
      .get(repertoire.id).n,
  };
  res.json({ disabled, lines, state, repertoire: repStats(repertoire) });
});

api.post("/repertoires/:key/branches/disable", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const epd = cleanEpd(req.body?.epd, req.body?.fen);
  if (!epd || !req.body?.san) {
    return res.status(400).json({ error: "epd and san are required" });
  }
  const result = disableBranch(db, repertoire, { epd, san: req.body.san });
  if (result.error) return res.status(result.status || 400).json(result);
  res.json({ ...result, repertoire: repStats(repertoire) });
});

api.post("/repertoires/:key/branches/enable", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const epd = cleanEpd(req.body?.epd, req.body?.fen);
  if (!epd || !req.body?.san) {
    return res.status(400).json({ error: "epd and san are required" });
  }
  const result = enableBranch(db, repertoire, { epd, san: req.body.san });
  res.json({ ...result, repertoire: repStats(repertoire) });
});

/**
 * Batch remove (D053).
 *
 * DELETE /repertoires/:key/branches
 *   { lineIds?: number[], branches?: [{epd,san}], dryRun?: boolean }
 *   → { ok, dryRun, removed:[{id,name,moves,openingId}], removedCount,
 *       snapshot:{lines:[…]}, repertoire }
 *
 * Everything is resolved to line ids first, deleted in one transaction and the
 * graph/totals are rebuilt once. The snapshot is accepted by
 * POST /repertoires/:key/branches/restore for an undo.
 */
api.delete("/repertoires/:key/branches", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const body = req.body || {};
  const { lines, wanted } = removeBranches(db, repertoire, {
    lineIds: body.lineIds ?? (body.lineId != null ? [body.lineId] : []),
    branches: body.branches ?? (body.epd && body.san ? [{ epd: body.epd, san: body.san }] : []),
  });
  if (!lines.length) {
    return res.status(404).json({ error: "No matching branch or line", removed: [], removedCount: 0 });
  }
  const dryRun = Boolean(body.dryRun);
  if (!dryRun) {
    const removeLine = db.prepare("DELETE FROM lines WHERE id = ? AND repertoire_id = ?");
    for (const line of lines) removeLine.run(line.id, repertoire.id);
    rebuildRepertoireMoves(db, repertoire.id);
    syncRepertoireTotals(repertoire.id);
  }
  const fresh = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(repertoire.id);
  res.json({
    ok: true,
    dryRun,
    removed: lines,
    removedLineIds: wanted,
    removedCount: lines.length,
    snapshot: { lines },
    repertoire: repStats(fresh),
  });
});

api.post("/repertoires/:key/branches/restore", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const entries = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const restored = [];
  const skipped = [];
  for (const entry of entries) {
    const moves = Array.isArray(entry?.moves) ? entry.moves : String(entry?.moves || "").split(/\s+/).filter(Boolean);
    const result = addLineFromSans(db, repertoire, {
      sans: moves,
      name: entry?.name ?? null,
      origin: "restore",
      openingId: entry?.openingId ?? null,
    });
    if (result.error) skipped.push({ moves, error: result.error });
    else restored.push({ id: result.line.id, moves: result.line.moves, created: result.created });
  }
  res.json({
    ok: restored.length > 0,
    restored,
    skipped,
    repertoire: repStats(db.prepare("SELECT * FROM repertoires WHERE id = ?").get(repertoire.id)),
  });
});

/**
 * Coverage model from captured position reports.
 *
 * Coverage is the probability mass of the captured candidate list that the
 * repertoire answers. It is undefined (not 0) for positions without a report.
 */
api.get("/repertoires/:key/coverage", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });

  const rows = db
    .prepare(
      `SELECT DISTINCT epd FROM line_moves
       WHERE repertoire_id = ? AND is_user = 1 ORDER BY epd`
    )
    .all(repertoire.id);

  const positions = [];
  let coveredMass = 0;
  let totalMass = 0;
  for (const row of rows) {
    const path = pathForEpd(db, repertoire.id, row.epd);
    const detail = candidateList(db, {
      epd: row.epd,
      repertoire,
      prefixMoves: path?.prefixMoves ?? [],
    });
    if (!detail.available) {
      positions.push({
        epd: row.epd,
        fen: detail.fen,
        side: detail.side,
        prefixMoves: detail.prefixMoves,
        available: false,
        coverage: null,
        savedCount: detail.savedMoves.length,
        candidateCount: null,
        missing: [],
      });
      continue;
    }
    const mass = detail.candidates.reduce(
      (sum, candidate) => sum + Number(candidate.probability ?? 0),
      0
    );
    const covered = detail.candidates.reduce(
      (sum, candidate) =>
        sum + (candidate.saved ? Number(candidate.probability ?? 0) : 0),
      0
    );
    totalMass += mass;
    coveredMass += covered;
    positions.push({
      epd: row.epd,
      fen: detail.fen,
      side: detail.side,
      prefixMoves: detail.prefixMoves,
      available: true,
      coverage: mass > 0 ? Math.round((covered / mass) * 1000) / 10 : null,
      savedCount: detail.candidates.filter((candidate) => candidate.saved).length,
      candidateCount: detail.candidates.length,
      missing: detail.candidates
        .filter((candidate) => !candidate.saved)
        .map((candidate) => ({
          san: candidate.san,
          name: candidate.name,
          probability: candidate.probability,
          incidence: candidate.incidence,
          oneIn: candidate.oneIn,
          eval: candidate.eval,
          masters: candidate.masters,
        })),
    });
  }

  const captured = db
    .prepare("SELECT * FROM repertoire_characteristics WHERE repertoire_id = ?")
    .get(repertoire.id);
  res.json({
    repertoire: repStats(repertoire),
    available: positions.some((position) => position.available),
    coverage: totalMass > 0 ? Math.round((coveredMass / totalMass) * 1000) / 10 : null,
    capturedCoverage: captured?.coverage == null ? null : Number(captured.coverage),
    source: totalMass > 0 ? "captured-position-reports" : null,
    positionsWithReport: positions.filter((position) => position.available).length,
    positionsWithoutReport: positions.filter((position) => !position.available).length,
    positions,
  });
});

api.get("/repertoires/:key/position-report", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const requested = requestPosition(req, repertoire);
  const epd = requested?.epd;
  if (!epd) return res.status(400).json({ error: "Provide epd, fen, moves or line" });
  const detail = candidateList(db, {
    epd,
    repertoire,
    prefixMoves: requested?.prefixMoves ?? [],
    includeExcluded: true,
  });
  res.json({
    repertoire: repStats(repertoire),
    position: {
      ...detail,
      heading: positionHeading(detail.prefixMoves, detail.side),
      note:
        notesForPosition(db, repertoire.id, epd).find((note) => !note.san) ?? null,
      annotations: annotationsForPosition(db, epd),
      report: reportForEpd(db, epd, { repertoireColor: repertoire.color }),
      name: fullNameForEpd(db, epd),
    },
    candidates: detail.candidates,
    available: detail.available,
  });
});

api.get("/repertoires/:key/learn", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });

  const profile = readSettings(db, req.user.id);
  const due = buildQueue(db, repertoire, "due");
  const weak = buildQueue(db, repertoire, "weak");
  const all = buildQueue(db, repertoire, "all");
  const common = commonMoveQueue(db, repertoire, {
    coverageGoal: profile.coverageGoal,
    limit: 40,
  });
  const ordered = [...new Set([...due, ...weak, ...all])].slice(0, 100);

  const queue = ordered
    .map((epd) => {
      const task = buildTask(db, repertoire, epd);
      if (!task) return null;
      const line = db.prepare("SELECT * FROM lines WHERE id = ?").get(task.lineId);
      if (!line) return null;
      const view = taskLineView(line, task, lineAggregate(db, repertoire, line));
      view.wrong = task.alternatives.reduce(
        (n, alt) => n + Number(alt.lapses || 0),
        0
      );
      view.due = task.due;
      view.epd = epd;
      view.alternatives = task.alternatives.map((a) => a.san);
      return view;
    })
    .filter(Boolean);

  res.json({
    repertoire: repStats(repertoire),
    queue,
    due: due.length,
    weak: weak.length,
    all: all.length,
    common: common.length,
    commonMoves: common,
    commonSource: "captured-position-incidence",
    reviewStyle: profile.reviewStyle,
    practiceMode: profile.practiceMode,
    coverageGoal: profile.coverageGoal,
    ratingBand: bandMatch(db, profile),
  });
});

/** Outstanding mistakes: a real wrong review that has not since been solved. */
api.get("/repertoires/:key/mistakes", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const rows = db.prepare(weakEpdQuery()).all(repertoire.id);
  const mistakes = rows
    .map((row) => {
      const task = buildTask(db, repertoire, row.epd);
      if (!task) return null;
      return {
        epd: row.epd,
        fen: task.fen,
        ply: task.ply,
        side: task.side,
        expectedSan: task.expectedSan,
        acceptableSans: task.acceptableSans,
        lineId: task.lineId,
        lineName: task.lineName,
        alternatives: task.alternatives,
      };
    })
    .filter(Boolean);
  res.json({
    source: "local-reviews",
    online: null,
    onlineAvailable: false,
    count: mistakes.length,
    mistakes,
  });
});

/* ------------------------------------------------------------------ position --- */

api.get("/repertoires/:key/position", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const raw = String(req.query.epd || req.query.fen || "").trim();
  if (!raw) return res.status(400).json({ error: "Provide epd or fen" });
  const detail = positionDetail(db, repertoire, raw);
  if (!detail) return res.status(400).json({ error: "Invalid position" });
  res.json({ repertoire: repStats(repertoire), position: detail });
});

/* -------------------------------------------------------------------- notes --- */

api.get("/repertoires/:key/notes", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const epd = String(req.query.epd || "").trim();
  const san = req.query.san != null ? String(req.query.san) : null;
  let rows;
  if (epd) {
    if (!isEpdLike(epd.split(" ").slice(0, 4).join(" "))) {
      return res.status(400).json({ error: "Invalid EPD" });
    }
    const clean = epd.split(" ").slice(0, 4).join(" ");
    rows =
      san == null
        ? db
            .prepare(
              "SELECT * FROM notes WHERE repertoire_id = ? AND epd = ? ORDER BY id"
            )
            .all(repertoire.id, clean)
        : db
            .prepare(
              "SELECT * FROM notes WHERE repertoire_id = ? AND epd = ? AND san = ?"
            )
            .all(repertoire.id, clean, san);
  } else {
    rows = db
      .prepare("SELECT * FROM notes WHERE repertoire_id = ? ORDER BY epd, id")
      .all(repertoire.id);
  }
  res.json({
    notes: rows.map((row) => ({
      id: row.id,
      epd: row.epd,
      san: row.san || null,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
});

api.put("/repertoires/:key/notes", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });

  const rawEpd = String(req.body?.epd || "").trim();
  const epd = rawEpd.split(" ").slice(0, 4).join(" ");
  if (!isEpdLike(epd)) return res.status(400).json({ error: "A valid EPD is required" });
  try {
    new Chess(fenFromEpd(epd));
  } catch {
    return res.status(400).json({ error: "That EPD is not a legal position" });
  }

  let san = req.body?.san != null ? normalizeSan(req.body.san) : "";
  if (san) {
    const move = findLegalMove(fenFromEpd(epd), san);
    if (!move) return res.status(400).json({ error: `Illegal move ${san} in that position` });
    san = move.san;
  }

  const note = String(req.body?.note ?? "").trim();
  if (note.length > 5000) {
    return res.status(400).json({ error: "Notes are limited to 5000 characters" });
  }
  if (!note) {
    db.prepare("DELETE FROM notes WHERE repertoire_id = ? AND epd = ? AND san = ?").run(
      repertoire.id,
      epd,
      san
    );
    return res.json({ note: null, deleted: true });
  }

  const stamp = now();
  db.prepare(
    `INSERT INTO notes (user_id, repertoire_id, epd, san, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repertoire_id, epd, san) DO UPDATE SET
       note = excluded.note, updated_at = excluded.updated_at`
  ).run(req.user.id, repertoire.id, epd, san, note, stamp, stamp);

  const row = db
    .prepare("SELECT * FROM notes WHERE repertoire_id = ? AND epd = ? AND san = ?")
    .get(repertoire.id, epd, san);
  res.json({
    note: {
      id: row.id,
      epd: row.epd,
      san: row.san || null,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
});

api.delete("/notes/:id", requireAuth, (req, res) => {
  const row = db
    .prepare(
      `SELECT n.* FROM notes n JOIN repertoires r ON r.id = n.repertoire_id
       WHERE n.id = ? AND r.user_id = ?`
    )
    .get(Number(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: "Note not found" });
  db.prepare("DELETE FROM notes WHERE id = ?").run(row.id);
  res.json({ ok: true, deleted: row.id });
});

/* -------------------------------------------------------------------- lines --- */

api.post("/repertoires/:key/lines", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const openingId = req.body?.openingId;
  const pgn = String(req.body?.pgn || "").trim();
  const rawMoves = req.body?.moves ?? req.body?.sans;
  let opening = null;
  let sans = null;
  let name = String(req.body?.name || "").trim();

  if (openingId) {
    opening = db.prepare("SELECT * FROM openings WHERE id = ?").get(Number(openingId));
    if (!opening) return res.status(400).json({ error: "Opening not found" });
    if (opening.side !== repertoire.color) {
      return res.status(400).json({
        error: `That opening practises ${opening.side}; this is a ${repertoire.color} repertoire`,
      });
    }
    sans = String(opening.sans || "").split(" ").filter(Boolean);
    name = name || opening.name || "New line";
  } else if (pgn || rawMoves) {
    try {
      if (rawMoves) {
        sans = Array.isArray(rawMoves)
          ? rawMoves.map(String)
          : String(rawMoves).split(/\s+/).filter(Boolean);
        const chess = new Chess();
        for (const san of sans) chess.move(san);
      } else {
        const chess = new Chess();
        chess.loadPgn(pgn);
        sans = chess.history();
      }
      if (!sans.length) throw new Error("Empty line");
    } catch (error) {
      return res.status(400).json({ error: `Could not read that line: ${error.message}` });
    }
    name = name || "Imported line";
  }
  if (!sans || !sans.length) {
    return res.status(400).json({ error: "Choose an opening or provide a PGN/moves" });
  }

  const added = addLineFromSans(db, repertoire, {
    sans,
    name: name || "New line",
    origin: openingId ? "opening" : "manual",
    sourceRef: opening ? `opening:${opening.id}` : null,
    openingId: opening ? opening.id : null,
  });
  if (added.error) return res.status(added.status || 400).json({ error: added.error });
  const status = added.created ? 201 : 200;
  res.status(status).json({
    line: lineView(added.line, repertoire),
    repertoire: repStats(repertoire),
    created: added.created,
    transposition: added.transposition,
    transpositionOf: added.transpositionOf,
    lineMoves: db
      .prepare("SELECT * FROM line_moves WHERE line_id = ? ORDER BY ply")
      .all(added.line.id)
      .map((m) => ({
        id: m.id,
        ply: m.ply,
        san: m.san,
        epd: m.epd,
        side: m.side,
        isUser: Boolean(m.is_user),
      })),
  });
});

/**
 * Add one saved move at an existing position (a real branch, D054/D055).
 * Body: { epd|fen, san, name? }
 */
api.post("/repertoires/:key/moves", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });

  const raw = String(req.body?.epd || req.body?.fen || "").trim();
  const epd = raw.split(" ").slice(0, 4).join(" ");
  if (!isEpdLike(epd)) return res.status(400).json({ error: "A valid epd or fen is required" });

  const added = addBranchAt(db, repertoire, {
    epd,
    san: String(req.body?.san || ""),
    name: String(req.body?.name || "").trim() || null,
    origin: String(req.body?.origin || "manual"),
    autofillStyle: req.body?.style ?? null,
  });
  if (added.error) return res.status(added.status || 400).json({ error: added.error });
  const status = added.created ? 201 : 200;
  res.status(status).json({
    line: lineView(added.line, repertoire),
    repertoire: repStats(repertoire),
    created: added.created,
    transposition: added.transposition,
    transpositionOf: added.transpositionOf,
  });
});

api.patch("/lines/:id", requireAuth, (req, res) => {
  const line = getLineForUser(req.user.id, Number(req.params.id));
  if (!line) return res.status(404).json({ error: "Line not found" });

  const learned =
    req.body?.learned != null ? Number(Boolean(req.body.learned)) : line.learned;
  const mastered =
    req.body?.mastered != null
      ? Math.max(0, Math.min(100, Number(req.body.mastered)))
      : line.mastered;
  const saved = req.body?.saved != null ? Number(Boolean(req.body.saved)) : line.saved;

  let dueAt = line.due_at;
  if (req.body?.dueAt !== undefined) {
    if (req.body.dueAt === null || req.body.dueAt === "") {
      dueAt = null;
    } else {
      const parsed = toIso(req.body.dueAt);
      if (!parsed) return res.status(400).json({ error: "dueAt is not a valid date" });
      dueAt = parsed;
    }
  }

  db.prepare(
    "UPDATE lines SET learned = ?, mastered = ?, saved = ?, due_at = ?, chapter_id = ? WHERE id = ?"
  ).run(
    learned,
    mastered,
    saved,
    dueAt,
    req.body?.chapterId === undefined
      ? line.chapter_id ?? null
      : req.body.chapterId == null
        ? null
        : Number(req.body.chapterId),
    line.id
  );
  const fresh = db.prepare("SELECT * FROM lines WHERE id = ?").get(line.id);
  res.json({ line: lineView(fresh) });
});

api.delete("/lines/:id", requireAuth, (req, res) => {
  const line = getLineForUser(req.user.id, Number(req.params.id));
  if (!line) return res.status(404).json({ error: "Line not found" });
  db.prepare("DELETE FROM lines WHERE id = ?").run(line.id);
  rebuildRepertoireMoves(db, line.repertoire_id);
  syncRepertoireTotals(line.repertoire_id);
  res.json({ ok: true });
});

/* ----------------------------------------------------------------- openings --- */

api.get("/openings", requireAuth, (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const side =
    req.query.side === "white" || req.query.side === "black" ? req.query.side : null;
  const prefix = String(req.query.prefix || "").trim();
  const fen =
    req.query.fen != null
      ? String(req.query.fen)
      : req.query.epd != null
        ? `${String(req.query.epd)} 0 1`
        : null;
  let rows;

  if (fen) {
    const epd = cleanEpd(fen, req.query.epd);
    const clauses = ["epd_after = ?"];
    const values = [epd];
    if (side) {
      clauses.push("side = ?");
      values.push(side);
    }
    rows = db
      .prepare(
        `SELECT id, eco, name, pgn, sans, fen, epd, epd_after, expected_san, side, family
         FROM openings WHERE ${clauses.join(" AND ")}
         ORDER BY LENGTH(sans), name LIMIT ?`
      )
      .all(...values, limit);
    const name = fullNameForEpd(db, epd);
    return res.json({
      openings: rows.map((o) => openingOut(o)),
      positions: [
        {
          epd,
          fen: fenFromEpd(epd),
          name: name.name,
          fullName: name.fullName,
          friendlyName: name.friendlyName,
          source: name.source,
          report: reportForEpd(db, epd) ? true : false,
          annotations: annotationsForPosition(db, epd),
        },
      ],
      query: { fen: fenFromEpd(epd), epd },
    });
  }

  if (prefix) {
    const like = `${prefix} %`;
    const clauses = ["sans LIKE ?"];
    const values = [like];
    if (side) {
      clauses.push("side = ?");
      values.push(side);
    }
    if (q) {
      clauses.push("(name LIKE ? OR eco LIKE ?)");
      values.push(`%${q}%`, `%${q}%`);
    }
    rows = db
      .prepare(
        `SELECT id, eco, name, pgn, sans, fen, epd, epd_after, expected_san, side, family
         FROM openings WHERE ${clauses.join(" AND ")}
         ORDER BY eco, name LIMIT ?`
      )
      .all(...values, limit);
  } else {
    rows = q
      ? searchOpenings(q, side ? 50 : limit)
          .filter((o) => !side || o.side === side)
          .slice(0, limit)
          .map((o) => ({
            ...o,
            epd: o.epd ?? epdOf(o.fen),
          }))
      : side
        ? db
            .prepare(
              "SELECT id, eco, name, pgn, sans, fen, epd, epd_after, expected_san, side, family FROM openings WHERE side = ? ORDER BY eco, name LIMIT ?"
            )
            .all(side, limit)
        : db
            .prepare(
              "SELECT id, eco, name, pgn, sans, fen, epd, epd_after, expected_san, side, family FROM openings ORDER BY eco, name LIMIT ?"
            )
            .all(limit);
  }
  res.json({
    openings: rows.map((o) => openingOut(o)),
    positions: [],
  });
});

function openingOut(o) {
  const finalEpd = o.epd_after ?? o.epd ?? epdOf(o.fen);
  const name = fullNameForEpd(db, finalEpd);
  return {
    id: o.id,
    eco: o.eco,
    name: o.name,
    fullName: name.fullName ?? o.name,
    friendlyName: name.friendlyName ?? null,
    epd: finalEpd,
    pgn: o.pgn,
    moves: String(o.sans || "").split(" ").filter(Boolean),
    fen: o.fen,
    expectedSan: o.expected_san,
    side: o.side,
    family: o.family,
  };
}

/* ---------------------------------------------------------------- sessions --- */

function parseArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSession(userId, id) {
  return db
    .prepare("SELECT * FROM practice_sessions WHERE id = ? AND user_id = ?")
    .get(String(id), userId);
}

function sessionQueue(row) {
  return parseArray(row.queue);
}

function sessionOut(row) {
  const queue = sessionQueue(row);
  const seen = new Set(parseArray(row.seen));
  const remaining = queue.filter((epd) => !seen.has(epd)).length;
  const complete = remaining === 0;
  return {
    id: row.id,
    repertoireId: row.repertoire_id,
    mode: row.mode,
    status: complete && row.status !== "paused" ? "complete" : row.status,
    total: queue.length,
    remaining,
    answered: seen.size,
    correct: Number(row.correct || 0),
    wrong: Number(row.wrong || 0),
    skipped: Number(row.skipped || 0),
    cursor: Number(row.cursor || 0),
    complete,
    style: row.style || "cards",
    practiceMode: row.practice_mode || "individual",
    replays: Number(row.replays || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function nextUnseen(queue, seen, from = 0) {
  for (let i = Math.max(0, from); i < queue.length; i += 1) {
    if (!seen.has(queue[i])) return i;
  }
  return -1;
}

/** Current task of a session, skipping positions that no longer exist. */
function currentTask(row, repertoire) {
  let queue = sessionQueue(row);
  let seen = new Set(parseArray(row.seen));
  let cursor = Math.max(0, Math.min(Number(row.cursor || 0), queue.length));
  let index = nextUnseen(queue, seen, cursor);
  if (index === -1) index = nextUnseen(queue, seen, 0);

  while (index !== -1) {
    const task = buildTask(db, repertoire, queue[index]);
    if (task) return { task, index, queue, seen };
    seen.add(queue[index]);
    db.prepare("UPDATE practice_sessions SET seen = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify([...seen]),
      now(),
      row.id
    );
    row.seen = JSON.stringify([...seen]);
    queue = sessionQueue(row);
    index = nextUnseen(queue, seen, index + 1);
    if (index === -1) index = nextUnseen(queue, seen, 0);
  }
  return { task: null, index: null, queue, seen };
}

function advanceSession(row, epd, { skipped = false } = {}) {
  const queue = sessionQueue(row);
  const seen = new Set(parseArray(row.seen));
  seen.add(epd);
  const from = Math.max(0, Number(row.cursor || 0) + 1);
  let cursor = nextUnseen(queue, seen, from);
  if (cursor === -1) cursor = nextUnseen(queue, seen, 0);
  const remaining = queue.filter((task) => !seen.has(task)).length;
  const complete = remaining === 0;
  const stamp = now();
  db.prepare(
    `UPDATE practice_sessions
     SET seen = ?, cursor = ?, status = ?, skipped = skipped + ?, updated_at = ?,
         completed_at = ?
     WHERE id = ?`
  ).run(
    JSON.stringify([...seen]),
    cursor === -1 ? queue.length : cursor,
    complete ? "complete" : row.status === "paused" ? "paused" : "active",
    skipped ? 1 : 0,
    stamp,
    complete ? row.completed_at || stamp : row.completed_at,
    row.id
  );
  return loadSession(row.user_id, row.id);
}

/**
 * "Complete lines (every time)" replay (D012): after a wrong answer, put the
 * rest of that line back at the end of the queue so the whole line is walked
 * again. Bounded to three replays and 3× the original size so a user who keeps
 * missing cannot create an endless session.
 */
function replayLine(session, repertoire, lineId) {
  if (session.style !== "complete-every") return { added: 0, replays: Number(session.replays || 0) };
  const replays = Number(session.replays || 0);
  if (replays >= 3) return { added: 0, replays };
  const epds = lineQueue(db, repertoire, lineId);
  if (!epds.length) return { added: 0, replays };
  const queue = sessionQueue(session);
  const seen = new Set(parseArray(session.seen));
  const limit = Math.max(queue.length * 3, 60);
  const additions = epds.filter((epd) => !queue.includes(epd));
  if (queue.length + additions.length > limit) return { added: 0, replays };
  const nextQueue = [...queue, ...additions];
  // Existing line positions were answered earlier in this session; clearing
  // them from `seen` is what makes this a *replay* rather than a no-op.
  for (const epd of epds) seen.delete(epd);
  db.prepare(
    `UPDATE practice_sessions SET queue = ?, seen = ?, total = ?, replays = ?,
       status = 'active', completed_at = NULL, updated_at = ? WHERE id = ?`
  ).run(
    JSON.stringify(nextQueue),
    JSON.stringify([...seen]),
    nextQueue.length,
    replays + 1,
    now(),
    session.id
  );
  return { added: additions.length, replays: replays + 1 };
}

function newSession(userId, repertoire, mode, options = {}) {
  const queue = [...new Set(buildQueue(db, repertoire, mode, options))];
  const stamp = now();
  const id = randomUUID();
  const complete = queue.length === 0;
  db.prepare(
    `INSERT INTO practice_sessions
       (id, user_id, repertoire_id, mode, style, practice_mode, status, queue, seen,
        cursor, total, correct, wrong, skipped, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, 0, 0, 0, ?, ?, ?)`
  ).run(
    id,
    userId,
    repertoire.id,
    mode,
    options.style || "cards",
    options.practiceMode || "individual",
    complete ? "complete" : "active",
    JSON.stringify(queue),
    queue.length,
    stamp,
    stamp,
    complete ? stamp : null
  );
  return loadSession(userId, id);
}

function sessionWithTask(row, repertoire, { includeTask = true } = {}) {
  const session = sessionOut(row);
  if (session.complete && row.status === "active") {
    db.prepare(
      "UPDATE practice_sessions SET status = 'complete', updated_at = ?, completed_at = COALESCE(completed_at, ?) WHERE id = ?"
    ).run(now(), now(), row.id);
    row.status = "complete";
    row.completed_at = row.completed_at || now();
  }
  if (!includeTask || session.complete) {
    return { session: sessionOut(row), task: null, autoReply: null };
  }
  const { task } = currentTask(row, repertoire);
  return { session: sessionOut(row), task, autoReply: task?.autoReply ?? null };
}

api.post("/practice/sessions", requireAuth, (req, res) => {
  const repertoire = getRepertoire(
    req.user.id,
    String(req.body?.repertoire || req.query.repertoire || "white")
  );
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });

  const requestedMode = req.body?.mode ? String(req.body.mode) : null;
  const resume = Boolean(req.body?.resume);

  if (resume) {
    const clauses = [
      "user_id = ?",
      "repertoire_id = ?",
      "status = 'active'",
    ];
    const values = [req.user.id, repertoire.id];
    if (requestedMode) {
      clauses.push("mode = ?");
      values.push(modeOf(requestedMode));
    }
    const existing = db
      .prepare(
        `SELECT * FROM practice_sessions WHERE ${clauses.join(" AND ")}
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(...values);
    if (existing) {
      return res.json({
        ...sessionWithTask(existing, repertoire),
        resumed: true,
        repertoire: repStats(repertoire),
      });
    }
  }

  const mode = modeOf(requestedMode || "due");
  const lineIds = [
    ...(Array.isArray(req.body?.lineIds) ? req.body.lineIds : []),
    ...(req.body?.lineId != null ? [req.body.lineId] : []),
  ];
  if ((mode === "specific" || mode === "line") && !lineIds.length) {
    return res.status(400).json({ error: "Choose at least one line for this mode" });
  }

  const profile = readSettings(db, req.user.id);
  const requestedStyle = req.body?.style ?? req.body?.reviewStyle;
  const style = REVIEW_STYLES.includes(String(requestedStyle))
    ? String(requestedStyle)
    : profile.reviewStyle;
  const practiceMode = ["individual", "whole-lines"].includes(String(req.body?.practiceMode))
    ? String(req.body.practiceMode)
    : profile.practiceMode;
  const coverageGoal = COVERAGE_OPTIONS.includes(Number(req.body?.coverageGoal))
    ? Number(req.body.coverageGoal)
    : profile.coverageGoal;

  const row = newSession(req.user.id, repertoire, mode, {
    lineIds,
    style,
    practiceMode,
    coverageGoal,
  });
  const payload = {
    ...sessionWithTask(row, repertoire),
    resumed: false,
    repertoire: repStats(repertoire),
  };
  if (mode === "common") {
    payload.commonMoves = commonMoveQueue(db, repertoire, {
      coverageGoal,
      lineIds: lineIds.length ? lineIds : null,
    });
    payload.commonSource = "captured-position-incidence";
  }
  res.status(201).json(payload);
});

api.get("/practice/sessions", requireAuth, (req, res) => {
  const repertoire = req.query.repertoire
    ? getRepertoire(req.user.id, String(req.query.repertoire))
    : null;
  if (req.query.repertoire && !repertoire) {
    return res.status(404).json({ error: "Repertoire not found" });
  }
  const status = String(req.query.status || "active");
  const clauses = ["user_id = ?"];
  const values = [req.user.id];
  if (status !== "all") {
    clauses.push("status = ?");
    values.push(status);
  }
  if (repertoire) {
    clauses.push("repertoire_id = ?");
    values.push(repertoire.id);
  }
  const rows = db
    .prepare(
      `SELECT * FROM practice_sessions WHERE ${clauses.join(" AND ")}
       ORDER BY updated_at DESC LIMIT 50`
    )
    .all(...values);
  res.json({ sessions: rows.map(sessionOut) });
});

api.get("/practice/sessions/latest", requireAuth, (req, res) => {
  const repertoire = getRepertoire(
    req.user.id,
    String(req.query.repertoire || "white")
  );
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const row = db
    .prepare(
      `SELECT * FROM practice_sessions
       WHERE user_id = ? AND repertoire_id = ? AND status = 'active'
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(req.user.id, repertoire.id);
  if (!row) {
    return res.json({ session: null, task: null, repertoire: repStats(repertoire) });
  }
  res.json({
    ...sessionWithTask(row, repertoire),
    repertoire: repStats(repertoire),
  });
});

api.get("/practice/sessions/:id", requireAuth, (req, res) => {
  const row = loadSession(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Session not found" });
  const repertoire = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(row.repertoire_id);
  res.json({
    ...sessionWithTask(row, repertoire),
    repertoire: repStats(repertoire),
  });
});

api.get("/practice/sessions/:id/current", requireAuth, (req, res) => {
  const row = loadSession(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Session not found" });
  const repertoire = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(row.repertoire_id);
  const payload = sessionWithTask(row, repertoire);
  res.json({ ...payload, repertoire: repStats(repertoire) });
});

api.post("/practice/sessions/:id/pause", requireAuth, (req, res) => {
  const row = loadSession(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Session not found" });
  if (row.status === "active") {
    db.prepare("UPDATE practice_sessions SET status = 'paused', updated_at = ? WHERE id = ?").run(
      now(),
      row.id
    );
  }
  const fresh = loadSession(req.user.id, row.id);
  res.json({ session: sessionOut(fresh) });
});

api.post("/practice/sessions/:id/resume", requireAuth, (req, res) => {
  const row = loadSession(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Session not found" });
  const repertoire = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(row.repertoire_id);
  if (row.status === "paused") {
    db.prepare("UPDATE practice_sessions SET status = 'active', updated_at = ? WHERE id = ?").run(
      now(),
      row.id
    );
  }
  const fresh = loadSession(req.user.id, row.id);
  res.json({
    ...sessionWithTask(fresh, repertoire),
    repertoire: repStats(repertoire),
  });
});

api.post("/practice/sessions/:id/reset", requireAuth, (req, res) => {
  const row = loadSession(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Session not found" });
  const repertoire = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(row.repertoire_id);
  const stamp = now();
  db.prepare(
    `UPDATE practice_sessions
     SET seen = '[]', cursor = 0, correct = 0, wrong = 0, skipped = 0,
         status = 'active', completed_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(stamp, row.id);
  const fresh = loadSession(req.user.id, row.id);
  res.json({
    ...sessionWithTask(fresh, repertoire),
    repertoire: repStats(repertoire),
  });
});

api.delete("/practice/sessions/:id", requireAuth, (req, res) => {
  const row = loadSession(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Session not found" });
  db.prepare("DELETE FROM practice_sessions WHERE id = ?").run(row.id);
  res.json({ ok: true, deleted: row.id });
});

api.post("/practice/sessions/:id/skip", requireAuth, (req, res) => {
  const row = loadSession(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Session not found" });
  const repertoire = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(row.repertoire_id);
  const { task } = currentTask(row, repertoire);
  if (!task) {
    return res.json({ ...sessionWithTask(row, repertoire), skipped: false });
  }
  const session = advanceSession(row, task.epd, { skipped: true });
  res.json({
    ...sessionWithTask(session, repertoire),
    skipped: task.epd,
    repertoire: repStats(repertoire),
  });
});

/** Keep this position for future review without claiming it was recalled. */
api.post("/practice/sessions/:id/keep", requireAuth, (req, res) => {
  const row = loadSession(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Session not found" });
  const repertoire = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(row.repertoire_id);
  const { task } = currentTask(row, repertoire);
  if (!task) return res.json({ ...sessionWithTask(row, repertoire), kept: null });

  const stamp = now();
  db.prepare(
    `UPDATE line_moves SET kept = 1, due_at = ?, updated_at = ? WHERE id = ?`
  ).run(stamp, stamp, task.lineMoveId);
  advanceSession(row, task.epd);
  const fresh = loadSession(req.user.id, row.id);
  res.json({
    ...sessionWithTask(fresh, repertoire),
    kept: task.epd,
    keptSan: task.expectedSan,
    repertoire: repStats(repertoire),
  });
});

/* ---------------------------------------------------------------- training --- */

function idempotentResponse(req, res, submissionId) {
  if (!submissionId) return false;
  const prior = db
    .prepare("SELECT * FROM reviews WHERE submission_id = ?")
    .get(String(submissionId));
  if (!prior) return false;
  if (prior.user_id !== req.user.id) {
    res.status(409).json({ error: "That submission id belongs to another profile" });
    return true;
  }
  let payload = null;
  if (prior.response_json) {
    try {
      payload = JSON.parse(prior.response_json);
    } catch {
      payload = null;
    }
  }
  res.json(
    payload
      ? { ...payload, idempotent: true, submissionId: prior.submission_id }
      : {
          correct: Boolean(prior.correct),
          expectedSan: prior.san,
          playedSan: prior.played_san,
          idempotent: true,
          submissionId: prior.submission_id,
        }
  );
  return true;
}

function applyCorrect(move, grade, stamp) {
  const next = schedule(
    {
      stability: move.stability,
      difficulty: move.difficulty,
      lapses: move.lapses,
      reps: move.reps,
      state: move.state,
      last_review: move.last_review,
    },
    grade,
    stamp
  );
  db.prepare(
    `UPDATE line_moves
     SET stability = ?, difficulty = ?, lapses = ?, reps = ?, state = ?, due_at = ?,
         last_review = ?, last_correct = 1, learned = 1, kept = 0, updated_at = ?
     WHERE id = ?`
  ).run(
    next.stability,
    next.difficulty,
    next.lapses,
    next.reps,
    next.state,
    next.dueAt,
    next.lastReview,
    stamp,
    move.id
  );
  return next;
}

function applyWrong(move, stamp) {
  const next = lapse(
    { difficulty: move.difficulty, lapses: move.lapses },
    stamp
  );
  db.prepare(
    `UPDATE line_moves
     SET difficulty = ?, lapses = ?, wrong_count = wrong_count + 1,
         last_correct = 0, last_review = ?, updated_at = ?
     WHERE id = ?`
  ).run(next.difficulty, next.lapses, next.lastReview, stamp, move.id);
  return next;
}

function recordReview({
  userId,
  repertoire,
  move,
  playedSan,
  correct,
  grade,
  mode,
  sessionId,
  submissionId,
  tzOffset,
  epd,
  ply,
  side,
  san,
}) {
  const stamp = now();
  const daily = localDay(stamp, parseOffset(tzOffset));
  const result = db
    .prepare(
      `INSERT INTO reviews
        (user_id, repertoire_id, line_move_id, line_id, session_id, epd, ply, san,
         played_san, side, correct, grade, mode, daily, submission_id, response_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(
      userId,
      repertoire.id,
      move.id,
      move.line_id ?? null,
      sessionId ?? null,
      epd,
      ply,
      san,
      playedSan,
      side,
      correct ? 1 : 0,
      grade ?? null,
      mode,
      daily,
      submissionId ?? null,
      stamp
    );
  return { id: Number(result.lastInsertRowid), daily, createdAt: stamp };
}

function updateRatingFor(req, correct, difficulty) {
  const after = updateTrainingRating(
    {
      rating: req.user.training?.rating,
      deviation: req.user.training?.deviation,
      volatility: req.user.training?.volatility,
    },
    { correct, difficulty: Number(difficulty) || 5 }
  );
  db.prepare(
    `UPDATE users SET training_rating = ?, training_rating_deviation = ?,
       training_rating_volatility = ? WHERE id = ?`
  ).run(after.rating, after.deviation, after.volatility, req.user.id);
  return after;
}

function attemptPayload(req, repertoire, task, playedSan, correct, grade, scheduled, extra = {}) {
  const freshUser = getLocalUser();
  return {
    correct,
    idempotent: false,
    expectedSan: extra.expectedSan,
    playedSan,
    acceptableSans: task.acceptableSans,
    alternatives: task.alternatives,
    position: {
      epd: task.epd,
      fen: task.fen,
      ply: task.ply,
      moveNumber: task.moveNumber,
      side: task.side,
      lineId: task.lineId,
      lineName: task.lineName,
    },
    grade: correct ? scheduled?.grade ?? grade : null,
    scheduled: correct && scheduled
      ? {
          stability: scheduled.stability,
          difficulty: scheduled.difficulty,
          lapses: scheduled.lapses,
          reps: scheduled.reps,
          state: scheduled.state,
          intervalDays: scheduled.intervalDays,
          dueAt: scheduled.dueAt,
          lastReview: scheduled.lastReview,
        }
      : null,
    lapse: correct ? null : extra.lapse ?? null,
    training: {
      rating: Number(freshUser.training_rating ?? 1200),
      deviation: Number(freshUser.training_rating_deviation ?? 350),
      volatility: Number(freshUser.training_rating_volatility ?? 0.06),
    },
    daily: dailySummary(db, req.user.id, req.body?.tzOffset),
    ...extra,
  };
}

function resolvePlayed(task, body) {
  const raw = String(body?.san ?? body?.playedSan ?? "").trim();
  if (!raw) return { error: "Move is required" };
  const played = findLegalMove(task.fen, raw);
  if (!played) {
    return {
      error: `Illegal move ${raw} in this position`,
      code: "illegal_move",
      legalMoves: legalSans(task.fen),
    };
  }
  const match = task.alternatives.find((alt) => sanKey(alt.san) === sanKey(played.san));
  return { played, match: match || null };
}

function gradeFor(body, correct, match) {
  if (!correct) return 1;
  const hinted = Boolean(body?.hint || body?.showAnswer);
  const requested = Number(body?.grade);
  if (Number.isInteger(requested) && requested >= 1 && requested <= 4) return requested;
  return hinted ? 2 : 3;
}

api.post("/practice/sessions/:id/attempt", requireAuth, (req, res) => {
  const submissionId =
    String(req.body?.submissionId || req.body?.submission_id || "").trim() || randomUUID();
  if (idempotentResponse(req, res, submissionId)) return;

  const session = loadSession(req.user.id, req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const repertoire = db
    .prepare("SELECT * FROM repertoires WHERE id = ?")
    .get(session.repertoire_id);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });

  if (session.status === "complete") {
    return res.status(409).json({
      error: "This session is complete",
      code: "session_complete",
      ...sessionWithTask(session, repertoire),
    });
  }

  const current = currentTask(session, repertoire);
  if (!current.task) {
    db.prepare(
      "UPDATE practice_sessions SET status = 'complete', updated_at = ?, completed_at = COALESCE(completed_at, ?) WHERE id = ?"
    ).run(now(), now(), session.id);
    return res.status(409).json({
      error: "This session is complete",
      code: "session_complete",
      ...sessionWithTask(loadSession(req.user.id, session.id), repertoire),
    });
  }

  const task = current.task;
  if (req.body?.epd) {
    const expected = epdOf(String(req.body.epd));
    if (expected !== task.epd) {
      return res.status(409).json({
        error: "That move does not belong to the current position",
        code: "position_mismatch",
        expectedEpd: task.epd,
        expectedFen: task.fen,
      });
    }
  }

  const resolved = resolvePlayed(task, req.body);
  if (resolved.error) {
    return res.status(422).json({
      error: resolved.error,
      code: resolved.code || "bad_move",
      position: { epd: task.epd, fen: task.fen },
      expectedSan: task.expectedSan,
      acceptableSans: task.acceptableSans,
      legalMoves: resolved.legalMoves,
    });
  }

  const { played, match } = resolved;
  const correct = Boolean(match);
  const stamp = now();
  const target = match ? moveById(match.lineMoveId) : moveById(task.lineMoveId);
  if (!target) {
    return res.status(409).json({ error: "The target move no longer exists", code: "move_missing" });
  }

  const grade = gradeFor(req.body, correct, match);
  const hadPriorMistake = Number(target.wrong_count || 0) > 0;
  const scheduled = correct ? applyCorrect(target, grade, stamp) : null;
  const penalty = correct ? null : applyWrong(target, stamp);
  const expectedSan = match ? match.san : task.expectedSan;

  const review = recordReview({
    userId: req.user.id,
    repertoire,
    move: target,
    playedSan: played.san,
    correct,
    grade: correct ? grade : null,
    mode: session.mode,
    sessionId: session.id,
    submissionId,
    tzOffset: req.body?.tzOffset,
    epd: task.epd,
    ply: target.ply,
    side: target.side,
    san: expectedSan,
  });

  if (correct) {
    // Production keeps the miss counter steady while you retry the same
    // position and only counts the position once it is solved (D007/D008).
    if (hadPriorMistake) {
      db.prepare("UPDATE practice_sessions SET wrong = wrong + 1, updated_at = ? WHERE id = ?").run(stamp, session.id);
    }
    advanceSession(session, task.epd);
  } else {
    if (task.lineId) replayLine(loadSession(req.user.id, session.id), repertoire, task.lineId);
  }

  const freshSession = loadSession(req.user.id, session.id);
  const nextState = sessionWithTask(freshSession, repertoire);

  let autoReply = null;
  if (correct && nextState.task && nextState.task.lineId === task.lineId) {
    const previous = nextState.task.prefix[nextState.task.prefix.length - 1];
    if (previous && previous.ply === task.ply + 1) autoReply = previous;
  }

  const training = updateRatingFor(
    req,
    correct,
    target.difficulty || task.review.difficulty
  );
  const fromPersisted = getLocalUser();
  if (fromPersisted) {
    // keep req.user in sync for the payload helper
    req.user.training = {
      rating: Number(fromPersisted.training_rating ?? training.rating),
      deviation: Number(fromPersisted.training_rating_deviation ?? training.deviation),
      volatility: Number(fromPersisted.training_rating_volatility ?? training.volatility),
    };
  }

  persistStreak(db, req.user.id, req.body?.tzOffset);

  // D020: compute a real refutation for a wrong move. The engine is a local
  // material/mate search; captured annotations enrich the explanation when the
  // position has one. The expected move is used for the damage comparison.
  const refutation = correct
    ? null
    : refuteMove(db, task.fen, played.san, { expectedSan: task.expectedSan });
  const refreshedTarget = moveById(target.id) || target;
  const refreshedLast = db
    .prepare(
      `SELECT grade, correct, created_at FROM reviews
       WHERE line_move_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
    )
    .get(target.id);
  const card = cardForMove(refreshedTarget, refreshedLast);

  const payload = attemptPayload(req, repertoire, task, played.san, correct, grade, scheduled, {
    expectedSan,
    retry: !correct,
    lapse: penalty,
    refutation,
    card,
    replay: freshSession.replays ? { replays: Number(freshSession.replays || 0) } : null,
    autoReply,
    remaining: nextState.session.remaining,
    complete: nextState.session.complete,
    next: {
      task: nextState.task,
      autoReply,
      remaining: nextState.session.remaining,
      complete: nextState.session.complete,
    },
    session: nextState.session,
    stats: repStats(repertoire),
    reviewId: review.id,
    submissionId,
  });

  db.prepare("UPDATE reviews SET response_json = ? WHERE id = ?").run(
    JSON.stringify(payload),
    review.id
  );
  res.json(payload);
});

/** Batched per-move review upload/history (D022), idempotent per entry. */
api.post("/practice/reviews", requireAuth, (req, res) => {
  const entries = Array.isArray(req.body?.reviews)
    ? req.body.reviews
    : req.body?.epd
      ? [req.body]
      : [];
  if (!entries.length) return res.status(400).json({ error: "Provide a review or reviews[]" });

  const results = [];
  for (const entry of entries) {
    const raw = String(entry?.epd || "").trim();
    const epd = raw.split(" ").slice(0, 4).join(" ");
    const repertoire = entry?.repertoire
      ? getRepertoire(req.user.id, String(entry.repertoire))
      : db
          .prepare(
            `SELECT DISTINCT r.* FROM repertoires r
             JOIN line_moves lm ON lm.repertoire_id = r.id
             WHERE r.user_id = ? AND lm.epd = ? LIMIT 1`
          )
          .get(req.user.id, epd);
    if (!repertoire) {
      results.push({ ok: false, epd, error: "Repertoire not found for this position" });
      continue;
    }
    if (!isEpdLike(epd)) {
      results.push({ ok: false, epd, error: "Invalid EPD" });
      continue;
    }
    const submissionId =
      String(entry?.submissionId || entry?.submission_id || "").trim() ||
      `upload-${randomUUID()}`;
    const prior = db
      .prepare("SELECT * FROM reviews WHERE submission_id = ?")
      .get(submissionId);
    if (prior) {
      results.push({
        ok: true,
        idempotent: true,
        epd,
        san: prior.san,
        correct: Boolean(prior.correct),
      });
      continue;
    }

    const move = entry?.san ? moveAt(repertoire.id, epd, entry.san) : null;
    if (!move) {
      results.push({ ok: false, epd, san: entry?.san ?? null, error: "No such saved move at this position" });
      continue;
    }
    const correct = entry?.correct === undefined ? true : Boolean(entry.correct);
    const grade = gradeFor(entry, correct, { lineMoveId: move.id });
    const stamp = now();
    const scheduled = correct ? applyCorrect(move, grade, stamp) : applyWrong(move, stamp);
    const review = recordReview({
      userId: req.user.id,
      repertoire,
      move,
      playedSan: String(entry?.playedSan || entry?.san || move.san),
      correct,
      grade: correct ? grade : null,
      mode: String(entry?.mode || "upload"),
      sessionId: entry?.sessionId ?? null,
      submissionId,
      tzOffset: entry?.tzOffset ?? req.body?.tzOffset,
      epd,
      ply: move.ply,
      side: move.side,
      san: move.san,
    });
    results.push({
      ok: true,
      idempotent: false,
      epd,
      san: move.san,
      correct,
      scheduled,
      reviewId: review.id,
      submissionId,
    });
  }

  persistStreak(db, req.user.id, req.body?.tzOffset);
  res.json({ results });
});

api.get("/practice/reviews", requireAuth, (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const clauses = ["r.user_id = ?"];
  const values = [req.user.id];
  let repertoire = null;
  if (req.query.repertoire) {
    repertoire = getRepertoire(req.user.id, String(req.query.repertoire));
    if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
    clauses.push("r.repertoire_id = ?");
    values.push(repertoire.id);
  }
  if (req.query.epd) {
    clauses.push("r.epd = ?");
    values.push(String(req.query.epd).split(" ").slice(0, 4).join(" "));
  }
  const rows = db
    .prepare(
      `SELECT r.*, l.name AS line_name
       FROM reviews r LEFT JOIN lines l ON l.id = r.line_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY r.created_at DESC, r.id DESC LIMIT ?`
    )
    .all(...values, limit);
  res.json({
    reviews: rows.map((row) => ({
      id: row.id,
      epd: row.epd,
      ply: row.ply,
      san: row.san,
      playedSan: row.played_san,
      side: row.side,
      correct: Boolean(row.correct),
      grade: row.grade,
      mode: row.mode,
      daily: row.daily,
      sessionId: row.session_id,
      submissionId: row.submission_id,
      lineId: row.line_id,
      lineName: row.line_name,
      createdAt: row.created_at,
    })),
    stats: repertoire ? repStats(repertoire) : null,
  });
});

api.get("/practice/daily", requireAuth, (req, res) => {
  res.json({ daily: dailySummary(db, req.user.id, req.query.tzOffset) });
});

/* ------------------------------------------------------- legacy practice API --- */

function pickLegacyEpd(repertoire, line, mode, san = "") {
  let derived;
  try {
    derived = deriveLineMoves(lineSans(line), repertoire.color).filter((m) => m.isUser);
  } catch {
    return null;
  }
  const rows = derived.map((m) => moveAt(repertoire.id, m.epd, m.san)).filter(Boolean);
  if (!rows.length) return null;

  // The client played a move: use the position where that move is the answer.
  if (san) {
    const played = rows.find((row) => sanKey(row.san) === sanKey(san));
    if (played) return played.epd;
  }

  if (mode === "due") {
    const due = rows
      .filter((row) => isDue(row.due_at))
      .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
    if (due.length) return due[0].epd;
    return null;
  }
  const fresh = rows.find((row) => row.reps === 0);
  return (fresh || rows[rows.length - 1]).epd;
}

function legacyNext(user, repertoire, mode) {
  const stats = repStats(repertoire);
  if (mode === "all") {
    const row = db
      .prepare(
        `SELECT epd FROM line_moves
         WHERE repertoire_id = ? AND is_user = 1
         GROUP BY epd HAVING MAX(reps) = 0
         ORDER BY MIN(line_id), MIN(ply), MIN(id) LIMIT 1`
      )
      .get(repertoire.id);
    const remaining = db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT epd FROM line_moves
           WHERE repertoire_id = ? AND is_user = 1
           GROUP BY epd HAVING MAX(reps) = 0
         )`
      )
      .get(repertoire.id).n;
    if (!row) return { line: null, task: null, stats, remaining: 0, complete: true };
    const task = buildTask(db, repertoire, row.epd);
    if (!task) return { line: null, task: null, stats, remaining: 0, complete: true };
    const line = db.prepare("SELECT * FROM lines WHERE id = ?").get(task.lineId);
    return {
      line: taskLineView(line, task, lineAggregate(db, repertoire, line)),
      task,
      stats,
      remaining: Number(remaining || 0),
      complete: false,
    };
  }

  const queue = buildQueue(db, repertoire, mode);
  const epd = queue[0] ?? null;
  const remaining = queue.length;
  if (!epd) return { line: null, task: null, stats, remaining: 0, complete: true };
  const task = buildTask(db, repertoire, epd);
  if (!task) return { line: null, task: null, stats, remaining: 0, complete: true };
  const line = db.prepare("SELECT * FROM lines WHERE id = ?").get(task.lineId);
  return {
    line: taskLineView(line, task, lineAggregate(db, repertoire, line)),
    task,
    stats,
    remaining,
    complete: false,
  };
}

api.get("/practice/next", requireAuth, (req, res) => {
  const repertoire = getRepertoire(
    req.user.id,
    String(req.query.repertoire || "white")
  );
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });

  const mode = modeOf(req.query.mode);

  if (req.query.line) {
    const line = getLineForUser(req.user.id, Number(req.query.line));
    if (!line) return res.status(404).json({ error: "Line not found" });
    const epd = pickLegacyEpd(repertoire, line, mode);
    const task = epd ? buildTask(db, repertoire, epd) : null;
    return res.json({
      line: task
        ? taskLineView(line, task, lineAggregate(db, repertoire, line))
        : lineView(line, repertoire),
      task,
      stats: repStats(repertoire),
      remaining: task ? 1 : 0,
      complete: !task,
    });
  }

  const next = legacyNext(req.user.id, repertoire, mode);
  res.json(next);
});

api.post("/practice/attempt", requireAuth, (req, res) => {
  const submissionId =
    String(req.body?.submissionId || req.body?.submission_id || "").trim() || randomUUID();
  if (idempotentResponse(req, res, submissionId)) return;

  const line = getLineForUser(req.user.id, Number(req.body?.lineId));
  if (!line) return res.status(404).json({ error: "Line not found" });
  const repertoire = db
    .prepare("SELECT * FROM repertoires WHERE id = ?")
    .get(line.repertoire_id);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });

  const mode = modeOf(req.body?.mode, "all");
  let epd = req.body?.epd ? epdOf(String(req.body.epd)) : null;
  if (!epd) epd = pickLegacyEpd(repertoire, line, mode, req.body?.san);
  if (!epd) {
    return res.status(409).json({
      error: "Nothing is due for this line",
      code: "nothing_due",
      next: { line: null, stats: repStats(repertoire), remaining: 0, complete: true },
    });
  }

  const task = buildTask(db, repertoire, epd);
  if (!task) return res.status(404).json({ error: "Position not found" });

  const resolved = resolvePlayed(task, req.body);
  if (resolved.error) {
    return res.status(422).json({
      error: resolved.error,
      code: resolved.code || "bad_move",
      position: { epd: task.epd, fen: task.fen },
      expectedSan: task.expectedSan,
      acceptableSans: task.acceptableSans,
      legalMoves: resolved.legalMoves,
    });
  }

  const { played, match } = resolved;
  const correct = Boolean(match);
  const target = match ? moveById(match.lineMoveId) : moveById(task.lineMoveId);
  if (!target) return res.status(409).json({ error: "The target move no longer exists" });
  const grade = gradeFor(req.body, correct, match);
  const stamp = now();
  const scheduled = correct ? applyCorrect(target, grade, stamp) : null;
  const penalty = correct ? null : applyWrong(target, stamp);
  const expectedSan = match ? match.san : task.expectedSan;

  const review = recordReview({
    userId: req.user.id,
    repertoire,
    move: target,
    playedSan: played.san,
    correct,
    grade: correct ? grade : null,
    mode,
    sessionId: null,
    submissionId,
    tzOffset: req.body?.tzOffset,
    epd: task.epd,
    ply: target.ply,
    side: target.side,
    san: expectedSan,
  });

  const training = updateRatingFor(req, correct, target.difficulty || task.review.difficulty);
  persistStreak(db, req.user.id, req.body?.tzOffset);

  const next = legacyNext(req.user.id, repertoire, mode);
  const freshLine = db.prepare("SELECT * FROM lines WHERE id = ?").get(line.id);

  let autoReply = null;
  if (correct && next.task && next.task.lineId === task.lineId) {
    const previous = next.task.prefix[next.task.prefix.length - 1];
    if (previous && previous.ply === task.ply + 1) autoReply = previous;
  }

  const payload = {
    correct,
    idempotent: false,
    expectedSan,
    playedSan: played.san,
    acceptableSans: task.acceptableSans,
    alternatives: task.alternatives,
    line: lineView(freshLine, repertoire),
    position: {
      epd: task.epd,
      fen: task.fen,
      ply: task.ply,
      side: task.side,
    },
    scheduled,
    lapse: penalty,
    autoReply,
    next: {
      line: next.line,
      task: next.task,
      autoReply,
      stats: next.stats,
      remaining: next.remaining,
      complete: next.complete,
      remainingDue: repStats(repertoire).due,
    },
    stats: repStats(repertoire),
    training,
    daily: dailySummary(db, req.user.id, req.body?.tzOffset),
    reviewId: review.id,
    submissionId,
  };

  db.prepare("UPDATE reviews SET response_json = ? WHERE id = ?").run(
    JSON.stringify(payload),
    review.id
  );
  res.json(payload);
});

/* ------------------------------------------------------------------- model --- */

api.get("/model-games", requireAuth, (req, res) => {
  const settings = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.user.id);
  const requested = String(req.query.source || settings?.model_source || "historical").toLowerCase();
  let rows = gameRows(db);
  if (requested === "online") {
    rows = rows.filter((row) =>
      String(row.data_source || "").toLowerCase().includes("online")
    );
  } else if (requested === "masters") {
    rows = rows.filter((row) =>
      String(row.data_source || "").toLowerCase().includes("master")
    );
  }
  const games = rows.map((row) => gameSummary(db, row, req.user.id));
  const daily = db
    .prepare("SELECT game_id FROM model_daily_selection WHERE date = ?")
    .get(new Date().toISOString().slice(0, 10));
  res.json({
    games,
    total: games.length,
    dailyGameId: daily?.game_id ?? games.find((game) => game.daily)?.id ?? null,
    source: requested,
    available: games.length > 0,
    reason:
      games.length > 0
        ? null
        : requested === "online"
          ? "No online games are connected in this local-first build."
          : "No model games match this source.",
  });
});

api.get("/model-games/daily", requireAuth, (req, res) => {
  const result = dailyGame(db, req.user.id, {
    date: req.query.date,
    forceNewGame: req.query.forceNewGame === "1" || req.query.force_new_game === "1",
    random: req.query.random === "1",
  });
  res.json(result);
});

api.post("/model-games/daily", requireAuth, (req, res) => {
  const body = req.body || {};
  const result = dailyGame(db, req.user.id, {
    date: body.date ? String(body.date).slice(0, 10) : undefined,
    forceNewGame: Boolean(body.forceNewGame ?? body.force_new_game),
    newGame: Boolean(body.newGame ?? body.new_game),
    random: Boolean(body.random),
  });
  res.json(result);
});

api.get("/model-games/random", requireAuth, (req, res) => {
  const game = randomGame(db, req.user.id, { exclude: req.query.exclude });
  if (!game) return res.status(404).json({ error: "No model games available" });
  res.json({ game, random: true });
});

api.get("/model-games/next", requireAuth, (req, res) => {
  const game = nextGame(db, req.user.id, { after: req.query.after });
  if (!game) return res.status(404).json({ error: "No model games available" });
  res.json({ game, next: true });
});

api.get("/model-games/history", requireAuth, (req, res) => {
  const payload = modelHistory(db, req.user.id, {
    groupBy: req.query.groupBy === "day" ? "day" : "week",
    includeDaily: req.query.includeDaily !== "0",
  });
  res.json({
    ...payload,
    available: payload.total > 0,
    source: "captured",
  });
});

api.get("/model-games/:id", requireAuth, (req, res) => {
  const row = gameRow(db, Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Game not found" });
  const game = gameDetail(db, row, req.user.id);
  res.json({
    game: {
      ...game,
      // Old clients expect `moves` to be SAN strings; the detailed move list is
      // available as `plies` and `moveList`.
      moves: (game.moves || []).map((move) => move.san),
      plies: game.moves,
      moveList: game.moves,
      evals: game.evalSamples.map((sample) => sample.evalCp),
      evalsAvailable: game.evalGraph.available,
      players: game.players,
      performances: game.performances,
      eventName: game.eventName,
      playedAt: game.playedAt,
      progressState: game.progressState,
    },
  });
});

api.post("/model-games/:id/progress", requireAuth, (req, res) => {
  const row = gameRow(db, Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Game not found" });
  const total = Number(
    db.prepare("SELECT COUNT(*) AS n FROM model_game_moves WHERE game_id = ?").get(row.id).n
  );
  const requested = Math.trunc(Number(req.body?.ply) || 0);
  const ply = Math.max(0, Math.min(total, requested));
  if (requested > total) {
    return res.status(400).json({
      error: `This game has ${total} plies`,
      code: "ply_out_of_range",
      total,
    });
  }
  const completed = ply >= total;
  const reviewed = Boolean(req.body?.reviewed);
  const score =
    req.body?.score == null
      ? null
      : Math.max(0, Math.min(100, Number(req.body.score)));
  const stamp = now();
  const existing = db
    .prepare("SELECT * FROM model_progress WHERE user_id = ? AND game_id = ?")
    .get(req.user.id, row.id);

  db.prepare(
    `INSERT INTO model_progress
       (user_id, game_id, ply, completed, reviewed, score, completed_at, reviewed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, game_id) DO UPDATE SET
       ply = excluded.ply,
       completed = excluded.completed,
       reviewed = excluded.reviewed,
       score = COALESCE(excluded.score, model_progress.score),
       completed_at = COALESCE(model_progress.completed_at, excluded.completed_at),
       reviewed_at = COALESCE(model_progress.reviewed_at, excluded.reviewed_at),
       updated_at = excluded.updated_at`
  ).run(
    req.user.id,
    row.id,
    ply,
    completed ? 1 : 0,
    reviewed ? 1 : 0,
    score,
    completed ? existing?.completed_at || stamp : null,
    reviewed
      ? existing && !existing.reviewed
        ? stamp
        : existing?.reviewed_at || stamp
      : null,
    stamp
  );

  res.json({
    ok: true,
    ply,
    progress: progressFor(db, row.id, req.user.id),
  });
});

api.get("/model-games/:id/review", requireAuth, (req, res) => {
  const row = gameRow(db, Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Game not found" });
  const game = gameDetail(db, row, req.user.id);
  res.json({
    gameId: row.id,
    review: game.review,
    analysis: game.analysis,
    annotations: game.annotations,
    annotationsAvailable: game.annotationsAvailable,
    available: game.analysis.available,
    engineReviewAvailable: false,
  });
});

api.post("/model-games/:id/review", requireAuth, (req, res) => {
  const row = gameRow(db, Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Game not found" });
  const progress = markReviewed(db, req.user.id, row.id, {
    reviewed: req.body?.reviewed !== false,
    score: req.body?.score == null ? null : req.body.score,
  });
  const game = gameDetail(db, row, req.user.id);
  res.json({
    ok: true,
    progress,
    review: game.review,
    analysis: game.analysis,
    engineReviewAvailable: false,
  });
});

/* ---------------------------------------------------------------- settings --- */

api.get("/settings", requireAuth, (req, res) => {
  const settings = readSettings(db, req.user.id);
  res.json({
    settings,
    ...settingsMeta(),
    ratingBand: bandMatch(db, settings),
  });
});

api.patch("/settings", requireAuth, (req, res) => {
  const settings = updateSettings(db, req.user.id, req.body || {});
  res.json({
    settings,
    ...settingsMeta(),
    ratingBand: bandMatch(db, settings),
  });
});

/* --------------------------------------------------------------- integrity --- */

api.get("/integrity", requireAuth, (_req, res) => {
  res.json(checkDatabase(db));
});

api.get("/health", (_req, res) => res.json({ ok: true, time: now() }));
