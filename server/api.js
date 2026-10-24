import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import {
  db,
  getLocalUser,
  createRepertoire,
  searchOpenings,
  syncRepertoireTotals,
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
  buildQueue,
  buildTask,
  dailySummary,
  lineAggregate,
  lineOut,
  modeOf,
  notesForPosition,
  persistStreak,
  positionDetail,
  rebuildRepertoireMoves,
  statsFor,
  streakFor,
  taskLineView,
  weakEpdQuery,
} from "./repertoire.js";
import { checkDatabase } from "./integrity.js";

export const api = Router();

const now = () => nowIso();

const userOut = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  plan: u.plan,
  trainingRating: Number(u.training_rating ?? 1200),
  training: {
    rating: Number(u.training_rating ?? 1200),
    deviation: Number(u.training_rating_deviation ?? 350),
    volatility: Number(u.training_rating_volatility ?? 0.06),
  },
  currentStreak: Number(u.current_streak ?? 0),
  highestStreak: Number(u.highest_streak ?? 0),
  lastStreakDate: u.last_streak_date ?? null,
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

function lineEpds(sans) {
  const chess = new Chess();
  const out = [epdOf(chess.fen())];
  for (const san of sans) {
    chess.move(san);
    out.push(epdOf(chess.fen()));
  }
  return out;
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
  res.json({
    user: {
      ...userOut(user),
      streak: streakFor(db, user.id, req.query.tzOffset),
      daily: dailySummary(db, user.id, req.query.tzOffset),
    },
  });
});

api.patch("/user", requireAuth, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required" });
  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, req.user.id);
  res.json({ user: { ...userOut(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)), name } });
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

  const modelGame = db.prepare("SELECT * FROM model_games ORDER BY id LIMIT 1").get();
  res.json({
    user: userOut(getLocalUser()),
    repertoires,
    tasks,
    streak: daily.streak,
    daily,
    modelGame: modelGame
      ? {
          id: modelGame.id,
          white: modelGame.white,
          black: modelGame.black,
          event: modelGame.event,
          year: modelGame.year,
          result: modelGame.result,
        }
      : null,
    connected: false,
  });
});

api.get("/stats/streak", requireAuth, (req, res) => {
  res.json({
    streak: streakFor(db, req.user.id, req.query.tzOffset),
    daily: dailySummary(db, req.user.id, req.query.tzOffset),
  });
});

/* -------------------------------------------------------------- repertoires --- */

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
  res.json({ repertoire: repStats(repertoire), lines });
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

api.get("/repertoires/:key/gap", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const gap = db
    .prepare(
      `SELECT * FROM lines WHERE repertoire_id = ?
       ORDER BY mastered ASC, learned ASC, id ASC LIMIT 1`
    )
    .get(repertoire.id);
  let position = null;
  let candidates = [];
  if (gap) {
    const prefixMoves = lineSans(gap).slice(0, -1);
    const widths = new Map();
    const allLines = db
      .prepare("SELECT * FROM lines WHERE repertoire_id = ?")
      .all(repertoire.id);
    const rows = db
      .prepare(
        `SELECT * FROM openings WHERE fen = ? AND side = ?
         ORDER BY eco, name LIMIT 80`
      )
      .all(gap.fen, repertoire.color);
    for (const row of rows) {
      if (widths.has(row.expected_san)) continue;
      const branchSan = [...prefixMoves, row.expected_san].join(" ");
      const branch = allLines.filter(
        (line) =>
          lineSans(line).slice(0, prefixMoves.length + 1).join(" ") === branchSan
      );
      const mastery = branch.length
        ? Math.round(
            branch.reduce((sum, line) => sum + Number(line.mastered || 0), 0) /
              branch.length
          )
        : 0;
      widths.set(row.expected_san, {
        san: row.expected_san,
        openingId: row.id,
        name: row.name,
        eco: row.eco,
        pgn: row.pgn,
        mastery,
        lineCount: branch.length,
        lineId: branch[0]?.id ?? null,
        inRepertoire: branch.length > 0,
        // This install has no engine/peer/incidence database: be explicit.
        eval: null,
        masters: null,
        peers: null,
        incidence: null,
      });
    }
    candidates = [...widths.values()].slice(0, 10);
    position = {
      fen: gap.fen,
      epd: epdOf(gap.fen),
      side: gap.side,
      prefixMoves,
      moveNumber: Math.floor(prefixMoves.length / 2) + 1,
      note: notesForPosition(db, repertoire.id, epdOf(gap.fen)).find((n) => !n.san) ?? null,
    };
  }
  const stats = repStats(repertoire);
  res.json({ repertoire: stats, gap: gap ? lineView(gap, repertoire) : null, position, candidates, stats });
});

api.post("/repertoires/:key/autofill", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  // Kept for the current client. It deliberately does not invent review
  // state: autofill is implemented properly by the builder workstream.
  const gaps = db
    .prepare(
      "SELECT id FROM lines WHERE repertoire_id = ? AND learned = 0 ORDER BY id LIMIT 6"
    )
    .all(repertoire.id);
  res.json({ filled: 0, considered: gaps.length, repertoire: repStats(repertoire) });
});

api.get("/repertoires/:key/learn", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });

  const due = buildQueue(db, repertoire, "due");
  const weak = buildQueue(db, repertoire, "weak");
  const all = buildQueue(db, repertoire, "all");
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

  res.json({ repertoire: repStats(repertoire), queue, due: due.length, weak: weak.length, all: all.length });
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
  let row = null;
  let sans = null;
  let name = String(req.body?.name || "").trim();

  if (openingId) {
    row = db.prepare("SELECT * FROM openings WHERE id = ?").get(Number(openingId));
    if (!row) return res.status(400).json({ error: "Opening not found" });
    if (row.side !== repertoire.color) {
      return res.status(400).json({
        error: `That opening practises ${row.side}; this is a ${repertoire.color} repertoire`,
      });
    }
    sans = String(row.sans || "").split(" ").filter(Boolean);
    name = name || row.name || "New line";
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
    row = { id: null, name };
  }
  if (!sans || !sans.length) {
    return res.status(400).json({ error: "Choose an opening or provide a PGN/moves" });
  }

  const lastSide = sans.length % 2 === 1 ? "white" : "black";
  if (lastSide !== repertoire.color) {
    return res.status(400).json({
      error: `That line ends with a ${lastSide} move; add it to a ${lastSide} repertoire`,
    });
  }

  const joined = sans.join(" ");
  const duplicate = db
    .prepare("SELECT * FROM lines WHERE repertoire_id = ? AND moves = ? LIMIT 1")
    .get(repertoire.id, joined);
  if (duplicate) {
    return res.json({
      line: lineView(duplicate, repertoire),
      repertoire: repStats(repertoire),
      created: false,
    });
  }

  const before = new Chess();
  for (const san of sans.slice(0, -1)) before.move(san);
  const stamp = now();
  const result = db
    .prepare(
      `INSERT INTO lines
        (repertoire_id, opening_id, name, moves, pgn, fen, side, expected_san,
         learned, mastered, saved, due_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, NULL, ?)`
    )
    .run(
      repertoire.id,
      row.id ?? null,
      name || "New line",
      joined,
      row.pgn ? String(row.pgn) : pgn || pgnFromSans(sans),
      before.fen(),
      repertoire.color,
      sans[sans.length - 1],
      stamp
    );

  rebuildRepertoireMoves(db, repertoire.id);
  syncRepertoireTotals(repertoire.id);
  const line = db
    .prepare("SELECT * FROM lines WHERE id = ?")
    .get(result.lastInsertRowid);
  res.status(201).json({
    line: lineView(line, repertoire),
    repertoire: repStats(repertoire),
    created: true,
    lineMoves: db
      .prepare("SELECT * FROM line_moves WHERE line_id = ? ORDER BY ply")
      .all(line.id)
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
  if (epd.split(" ")[1] === (repertoire.color === "white" ? "b" : "w")) {
    return res.status(400).json({ error: "It is not your turn at that position" });
  }

  let sanitized;
  try {
    sanitized = new Chess(fenFromEpd(epd));
  } catch {
    return res.status(400).json({ error: "That position is illegal" });
  }
  const move = findLegalMove(sanitized.fen(), String(req.body?.san || ""));
  if (!move) {
    return res.status(400).json({ error: "That move is not legal in this position" });
  }

  const lines = db.prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id").all(repertoire.id);
  let best = null;
  let bestIndex = -1;
  for (const line of lines) {
    const sans = lineSans(line);
    let positions;
    try {
      positions = lineEpds(sans);
    } catch {
      continue;
    }
    const index = positions.indexOf(epd);
    if (index === -1) continue;
    if (!best || sans.length > lineSans(best).length) {
      best = line;
      bestIndex = index;
    }
  }

  if (!best) {
    if (epd !== epdOf(new Chess().fen())) {
      return res.status(400).json({
        error: "That position is not in this repertoire yet; add a line that reaches it first",
      });
    }
    bestIndex = 0;
  }

  const prefix = best ? lineSans(best).slice(0, bestIndex) : [];
  const sans = [...prefix, move.san];
  const joined = sans.join(" ");
  const duplicate = db
    .prepare("SELECT * FROM lines WHERE repertoire_id = ? AND moves = ? LIMIT 1")
    .get(repertoire.id, joined);
  if (duplicate) {
    return res.json({
      line: lineView(duplicate, repertoire),
      repertoire: repStats(repertoire),
      created: false,
    });
  }

  const before = new Chess();
  for (const san of sans.slice(0, -1)) before.move(san);
  const result = db
    .prepare(
      `INSERT INTO lines
        (repertoire_id, opening_id, name, moves, pgn, fen, side, expected_san,
         learned, mastered, saved, due_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, NULL, ?)`
    )
    .run(
      repertoire.id,
      best?.opening_id ?? null,
      String(req.body?.name || best?.name || `${repertoire.name} line`).trim(),
      joined,
      pgnFromSans(sans),
      before.fen(),
      repertoire.color,
      move.san,
      now()
    );

  rebuildRepertoireMoves(db, repertoire.id);
  syncRepertoireTotals(repertoire.id);
  const line = db
    .prepare("SELECT * FROM lines WHERE id = ?")
    .get(result.lastInsertRowid);
  res.status(201).json({
    line: lineView(line, repertoire),
    repertoire: repStats(repertoire),
    created: true,
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
    "UPDATE lines SET learned = ?, mastered = ?, saved = ?, due_at = ? WHERE id = ?"
  ).run(learned, mastered, saved, dueAt, line.id);
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
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const side =
    req.query.side === "white" || req.query.side === "black" ? req.query.side : null;
  const prefix = String(req.query.prefix || "").trim();
  let rows;
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
        `SELECT id, eco, name, pgn, sans, fen, expected_san, side, family
         FROM openings WHERE ${clauses.join(" AND ")}
         ORDER BY eco, name LIMIT ?`
      )
      .all(...values, limit);
  } else {
    rows = q
      ? searchOpenings(q, side ? 50 : limit)
          .filter((o) => !side || o.side === side)
          .slice(0, limit)
      : side
        ? db
            .prepare(
              "SELECT id, eco, name, pgn, sans, fen, expected_san, side, family FROM openings WHERE side = ? ORDER BY eco, name LIMIT ?"
            )
            .all(side, limit)
        : db
            .prepare(
              "SELECT id, eco, name, pgn, sans, fen, expected_san, side, family FROM openings ORDER BY eco, name LIMIT ?"
            )
            .all(limit);
  }
  res.json({
    openings: rows.map((o) => ({
      id: o.id,
      eco: o.eco,
      name: o.name,
      pgn: o.pgn,
      moves: String(o.sans || "").split(" ").filter(Boolean),
      fen: o.fen,
      expectedSan: o.expected_san,
      side: o.side,
      family: o.family,
    })),
  });
});

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

function newSession(userId, repertoire, mode, options = {}) {
  const queue = [...new Set(buildQueue(db, repertoire, mode, options))];
  const stamp = now();
  const id = randomUUID();
  const complete = queue.length === 0;
  db.prepare(
    `INSERT INTO practice_sessions
       (id, user_id, repertoire_id, mode, status, queue, seen, cursor, total,
        correct, wrong, skipped, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', 0, ?, 0, 0, 0, ?, ?, ?)`
  ).run(
    id,
    userId,
    repertoire.id,
    mode,
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

  const row = newSession(req.user.id, repertoire, mode, { lineIds });
  res.status(201).json({
    ...sessionWithTask(row, repertoire),
    resumed: false,
    repertoire: repStats(repertoire),
  });
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

  if (correct) advanceSession(session, task.epd);
  else db.prepare("UPDATE practice_sessions SET wrong = wrong + 1, updated_at = ? WHERE id = ?").run(stamp, session.id);

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

  const payload = attemptPayload(req, repertoire, task, played.san, correct, grade, scheduled, {
    expectedSan,
    retry: !correct,
    lapse: penalty,
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

function gamePlies(game) {
  const chess = new Chess();
  chess.loadPgn(game.pgn);
  return chess.history();
}

function progressState(game, row) {
  const plies = gamePlies(game);
  const total = plies.length;
  const ply = Math.max(0, Math.min(total, Number(row?.ply || 0)));
  const completed = Boolean(row?.completed) || (total > 0 && ply >= total);
  return {
    ply,
    total,
    percent: total ? Math.round((ply / total) * 100) : 0,
    completed,
    reviewed: Boolean(row?.reviewed),
    score: row?.score ?? null,
    completedAt: row?.completed_at ?? null,
    reviewedAt: row?.reviewed_at ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

api.get("/model-games", requireAuth, (req, res) => {
  const games = db
    .prepare(
      `SELECT g.*, p.ply, p.completed, p.reviewed, p.score, p.completed_at,
              p.reviewed_at, p.updated_at
       FROM model_games g
       LEFT JOIN model_progress p ON p.game_id = g.id AND p.user_id = ?
       ORDER BY g.id`
    )
    .all(req.user.id);
  res.json({
    games: games.map((g) => ({
      id: g.id,
      white: g.white,
      black: g.black,
      event: g.event,
      year: g.year,
      result: g.result,
      pgn: g.pgn,
      description: g.description,
      progress: Number(g.ply || 0),
      progressState: progressState(g, g),
    })),
  });
});

api.get("/model-games/:id", requireAuth, (req, res) => {
  const game = db.prepare("SELECT * FROM model_games WHERE id = ?").get(Number(req.params.id));
  if (!game) return res.status(404).json({ error: "Game not found" });
  const row = db
    .prepare("SELECT * FROM model_progress WHERE user_id = ? AND game_id = ?")
    .get(req.user.id, game.id);
  res.json({
    game: {
      id: game.id,
      white: game.white,
      black: game.black,
      event: game.event,
      year: game.year,
      result: game.result,
      pgn: game.pgn,
      description: game.description,
      moves: gamePlies(game),
      progressState: progressState(game, row),
    },
  });
});

api.post("/model-games/:id/progress", requireAuth, (req, res) => {
  const game = db.prepare("SELECT * FROM model_games WHERE id = ?").get(Number(req.params.id));
  if (!game) return res.status(404).json({ error: "Game not found" });
  const total = gamePlies(game).length;
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
    .get(req.user.id, game.id);

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
    game.id,
    ply,
    completed ? 1 : 0,
    reviewed ? 1 : 0,
    score,
    completed ? existing?.completed_at || stamp : null,
    reviewed && existing && !existing.reviewed ? stamp : reviewed ? existing?.reviewed_at || stamp : null,
    stamp
  );

  const row = db
    .prepare("SELECT * FROM model_progress WHERE user_id = ? AND game_id = ?")
    .get(req.user.id, game.id);
  res.json({ ok: true, ply, progress: progressState(game, row) });
});

/* ---------------------------------------------------------------- settings --- */

api.get("/settings", requireAuth, (req, res) => {
  const s = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.user.id);
  res.json({
    settings: {
      boardTheme: s.board_theme,
      coordinates: Boolean(s.coordinates),
      legalMoves: Boolean(s.legal_moves),
      sound: Boolean(s.sound),
      showHints: Boolean(s.show_hints),
      dailyGoal: s.daily_goal,
    },
  });
});

api.patch("/settings", requireAuth, (req, res) => {
  const s = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(req.user.id);
  const body = req.body || {};
  const boardTheme = ["green", "blue", "brown"].includes(body.boardTheme)
    ? body.boardTheme
    : s.board_theme;
  const coordinates =
    body.coordinates != null ? Number(Boolean(body.coordinates)) : s.coordinates;
  const legalMoves =
    body.legalMoves != null ? Number(Boolean(body.legalMoves)) : s.legal_moves;
  const sound = body.sound != null ? Number(Boolean(body.sound)) : s.sound;
  const showHints =
    body.showHints != null ? Number(Boolean(body.show_hints)) : s.show_hints;
  const dailyGoal =
    body.dailyGoal != null
      ? Math.max(1, Math.min(500, Number(body.dailyGoal)))
      : s.daily_goal;
  db.prepare(
    `UPDATE settings SET board_theme = ?, coordinates = ?, legal_moves = ?,
       sound = ?, show_hints = ?, daily_goal = ? WHERE user_id = ?`
  ).run(boardTheme, coordinates, legalMoves, sound, showHints, dailyGoal, req.user.id);
  res.json({
    settings: {
      boardTheme,
      coordinates: Boolean(coordinates),
      legalMoves: Boolean(legalMoves),
      sound: Boolean(sound),
      showHints: Boolean(showHints),
      dailyGoal,
    },
  });
});

/* --------------------------------------------------------------- integrity --- */

api.get("/integrity", requireAuth, (_req, res) => {
  res.json(checkDatabase(db));
});

api.get("/health", (_req, res) => res.json({ ok: true, time: now() }));
