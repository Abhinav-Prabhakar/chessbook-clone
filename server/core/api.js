import { Router } from "express";
import { db, nowIso } from "./db.js";
import { applyMove, epdOf, movesText, pgnLines, replay, START_FEN, turnOf } from "./chess.js";
import { masters, openingAt, openingForPath, peers, percentRow, explorerSummary, clearExplorerCache } from "./explorer.js";
import {
  addLine,
  createRepertoire,
  deleteRepertoire,
  getRepertoire,
  graphOf,
  httpError,
  listRepertoires,
  moveStats,
  movesAt,
  pathsOf,
  removeMove,
  renameRepertoire,
  resolvePath,
  setMoveNote,
} from "./repertoire.js";
import { autofill, computeCoverage, coverageContext, reachOf } from "./coverage.js";
import { buildSession, dailyProgress, queueCounts, recordReview, recentMistakes, reviewHistory } from "./practice.js";
import { readSettings, writeSettings, userBand, lichessEquivalent, BANDS } from "./settings.js";
import { positionEval, cachedEval } from "./engine-cache.js";
import * as models from "./model-games.js";
import * as puzzles from "./puzzles.js";
import * as training from "./training.js";
import { builtinNote } from "./notes.js";

export const api = Router();

const wrap = (fn) => async (req, res) => {
  try {
    const value = await fn(req, res);
    if (!res.headersSent) res.json(value ?? { ok: true });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? "Something went wrong" : error.message });
  }
};

const pathParam = (value) =>
  Array.isArray(value)
    ? value.map(String).filter(Boolean)
    : String(value || "")
        .split(/[\s,]+/)
        .filter(Boolean);

/* ------------------------------------------------------------ coverage --- */

const coverageCache = new Map();
function coverageFor(repertoireId, from = []) {
  const repertoire = getRepertoire(repertoireId);
  const settings = readSettings();
  const key = `${repertoire.id}|${repertoire.updated_at}|${userBand(settings)}|${settings.coverageGoal}|${from.join(" ")}`;
  if (coverageCache.has(key)) return coverageCache.get(key);
  const value = computeCoverage(repertoire.id, { from });
  coverageCache.set(key, value);
  if (coverageCache.size > 300) coverageCache.delete(coverageCache.keys().next().value);
  return value;
}

function touch(repertoireId) {
  db.prepare("UPDATE repertoires SET updated_at = ? WHERE id = ?").run(nowIso(), Number(repertoireId));
}

function summary(repertoire) {
  const stats = moveStats(repertoire.id);
  const counts = queueCounts(repertoire.id);
  const coverage = coverageFor(repertoire.id);
  const gap = coverage.gaps[0] || null;
  return {
    id: repertoire.id,
    name: repertoire.name,
    color: repertoire.color,
    completion: coverage.completionPercent,
    stats,
    due: counts.due,
    fresh: counts.fresh,
    difficult: counts.difficult,
    scheduled: counts.scheduled,
    nextDue: counts.nextDue,
    biggestGap: gap ? gapView(gap) : null,
    gapCount: coverage.gaps.length,
    started: stats.saved > 0,
  };
}

function gapView(gap) {
  return {
    path: gap.path,
    expectedIn: gap.expectedIn,
    lastMove: gap.lastMove,
    ply: gap.ply,
    label: gap.lastMove ? labelFor(gap.ply - 1, gap.lastMove) : "your first move",
    opening: gap.opening,
  };
}

function labelFor(plyIndex, san) {
  const number = Math.floor(plyIndex / 2) + 1;
  return plyIndex % 2 === 0 ? `${number}. ${san}` : `${number}… ${san}`;
}

/* ---------------------------------------------------------------- basics --- */

api.get("/health", (_req, res) => res.json({ ok: true }));

api.get(
  "/settings",
  wrap(() => ({ settings: readSettings(), band: userBand(), lichessRating: lichessEquivalent() }))
);

api.patch(
  "/settings",
  wrap((req) => {
    const { settings, errors } = writeSettings(req.body || {});
    if (errors.length) throw httpError(400, errors.join(". "));
    coverageCache.clear();
    clearExplorerCache();
    return { settings, band: userBand(settings), lichessRating: lichessEquivalent(settings) };
  })
);

api.get(
  "/dashboard",
  wrap((req) => {
    const repertoires = listRepertoires().map(summary);
    const daily = dailyProgress(req.query.tz);
    const due = repertoires.reduce((s, r) => s + r.due, 0);
    const fresh = repertoires.reduce((s, r) => s + r.fresh, 0);
    const gapRep = repertoires
      .filter((r) => r.biggestGap && r.started)
      .sort((a, b) => (a.biggestGap.expectedIn || 1e9) - (b.biggestGap.expectedIn || 1e9))[0];
    let model = null;
    try {
      const game = models.dailyGame(req.query.tz);
      if (game) model = { id: game.id, white: game.white, black: game.black, completed: game.progress?.completed || false };
    } catch {
      model = null;
    }
    return {
      repertoires,
      daily,
      tasks: {
        due,
        fresh,
        practiceRepertoire: repertoires.find((r) => r.due > 0)?.id ?? repertoires.find((r) => r.fresh > 0)?.id ?? null,
        gap: gapRep ? { repertoireId: gapRep.id, repertoireName: gapRep.name, ...gapRep.biggestGap } : null,
        model,
      },
      settings: readSettings(),
    };
  })
);

/* ----------------------------------------------------------- repertoires --- */

api.get("/repertoires", wrap(() => ({ repertoires: listRepertoires().map(summary) })));

api.post(
  "/repertoires",
  wrap((req) => {
    const repertoire = createRepertoire(req.body || {});
    return { repertoire: summary(repertoire) };
  })
);

api.get(
  "/repertoires/:id",
  wrap((req) => {
    const repertoire = getRepertoire(req.params.id);
    return { repertoire: summary(repertoire), daily: dailyProgress(req.query.tz) };
  })
);

api.patch(
  "/repertoires/:id",
  wrap((req) => ({ repertoire: summary(renameRepertoire(req.params.id, req.body?.name)) }))
);

api.delete(
  "/repertoires/:id",
  wrap((req) => {
    deleteRepertoire(req.params.id);
    return { ok: true };
  })
);

/** Everything the builder shows for one position. */
api.get(
  "/repertoires/:id/position",
  wrap((req) => {
    const repertoire = getRepertoire(req.params.id);
    const path = pathParam(req.query.path);
    const { steps, fen } = resolvePath(path);
    const epd = epdOf(fen);
    const ctx = coverageContext(repertoire.id);
    const turn = turnOf(fen);
    const mine = turn === repertoire.color;
    const graph = graphOf(repertoire.id);
    const saved = graph.get(epd) || [];
    const savedBySan = new Map(saved.map((m) => [m.san, m]));
    const reach = reachOf(path, repertoire.color, ctx.band);

    // Is every move on the path saved?
    let onRepertoire = true;
    for (const step of steps) {
      const here = graph.get(step.epdBefore) || [];
      if (!here.some((m) => m.san === step.san)) {
        onRepertoire = false;
        break;
      }
    }

    const m = masters(epd);
    const p = peers(epd, ctx.band);
    const sans = new Set();
    const rows = [];
    const add = (san) => {
      if (sans.has(san)) return;
      const next = applyMove(fen, san);
      if (!next) return;
      sans.add(san);
      const mm = m?.moves.find((x) => x.san === san) || null;
      const pm = p?.moves.find((x) => x.san === san) || null;
      const savedMove = savedBySan.get(san);
      rows.push({
        san,
        uci: next.uci,
        from: next.from,
        to: next.to,
        name: openingAt(next.epd)?.name || null,
        masters: mm ? { share: mm.share, games: mm.games } : null,
        peers: pm ? { share: pm.share, games: pm.games, ...percentRow(pm) } : null,
        note: savedMove?.note || builtinNote(epd, san),
        ownNote: Boolean(savedMove?.note),
        saved: Boolean(savedMove),
        expectedIn: !mine && pm && reach * pm.share > 0 ? Math.max(1, Math.round(1 / (reach * pm.share))) : null,
      });
    };
    for (const s of saved) add(s.san);
    if (mine) {
      for (const x of m?.moves || []) if (x.share >= 0.01 || (x.games >= 25 && x.share >= 0.004)) add(x.san);
      for (const x of p?.moves || []) if (x.share >= 0.02) add(x.san);
    } else {
      for (const x of p?.moves || []) if (x.share >= 0.005) add(x.san);
      for (const x of m?.moves || []) if (x.share >= 0.03) add(x.san);
    }
    const sortKey = (row) =>
      mine
        ? (row.saved ? 10 : 0) + (row.masters?.share ?? 0) * 2 + (row.peers?.share ?? 0)
        : (row.peers?.share ?? 0) * 2 + (row.masters?.share ?? 0) * 0.5;
    rows.sort((a, b) => sortKey(b) - sortKey(a));

    // Coverage of each likely opponent reply.
    if (!mine) {
      for (const row of rows) {
        const share = row.peers?.share ?? 0;
        if (reach * share < ctx.threshold) {
          row.coverage = null;
          row.rare = true;
          continue;
        }
        const sub = coverageFor(repertoire.id, [...path, row.san]);
        row.coverage = sub.completionPercent;
        row.rare = false;
      }
    }

    const positionNote = db
      .prepare("SELECT note FROM position_notes WHERE repertoire_id = ? AND epd = ?")
      .get(repertoire.id, epd)?.note || null;
    const epds = [epdOf(START_FEN), ...steps.map((s) => s.epdAfter)];
    const last = steps[steps.length - 1] || null;
    const mineSaved = saved.filter((x) => x.mine === 1);
    return {
      repertoire: { id: repertoire.id, name: repertoire.name, color: repertoire.color },
      path,
      fen,
      epd,
      turn,
      mine,
      ply: path.length,
      moves: steps.map((s) => ({ san: s.san, from: s.from, to: s.to, fen: s.fenAfter })),
      lastMove: last ? { from: last.from, to: last.to } : null,
      opening: openingForPath(epds),
      onRepertoire,
      reach,
      expectedIn: reach > 0 ? Math.max(1, Math.round(1 / reach)) : null,
      belowGoal: reach < ctx.threshold,
      coverageGoal: ctx.goal,
      saved: saved.map((x) => ({ san: x.san, mine: x.mine === 1, note: x.note, reps: x.reps, source: x.source })),
      mySaved: mineSaved.map((x) => x.san),
      candidates: rows,
      positionNote,
      eval: cachedEval(fen),
      data: { masters: m?.games || 0, peers: p?.games || 0, band: ctx.band },
      gameOver: (() => {
        const chess = replay(path).chess;
        return chess.isGameOver();
      })(),
    };
  })
);

api.post(
  "/repertoires/:id/moves",
  wrap((req) => {
    const path = pathParam(req.body?.path);
    const san = String(req.body?.san || "");
    const sans = san ? [...path, san] : path;
    const added = addLine(req.params.id, sans, { source: "user" });
    touch(req.params.id);
    const applied = replay(sans);
    return { added: added.length, path: applied.steps.map((s) => s.san) };
  })
);

api.delete(
  "/repertoires/:id/moves",
  wrap((req) => {
    const path = pathParam(req.body?.path ?? req.query.path);
    const san = String(req.body?.san ?? req.query.san ?? "");
    const { fen } = resolvePath(path);
    const result = removeMove(req.params.id, epdOf(fen), san);
    touch(req.params.id);
    return result;
  })
);

api.put(
  "/repertoires/:id/notes",
  wrap((req) => {
    const repertoire = getRepertoire(req.params.id);
    const path = pathParam(req.body?.path);
    const { fen } = resolvePath(path);
    const epd = epdOf(fen);
    const note = String(req.body?.note || "").trim().slice(0, 1000);
    if (req.body?.san) {
      return { move: setMoveNote(repertoire.id, epd, String(req.body.san), note) };
    }
    if (note) {
      db.prepare(
        `INSERT INTO position_notes (repertoire_id, epd, note, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(repertoire_id, epd) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`
      ).run(repertoire.id, epd, note, nowIso());
    } else {
      db.prepare("DELETE FROM position_notes WHERE repertoire_id = ? AND epd = ?").run(repertoire.id, epd);
    }
    return { note: note || null };
  })
);

api.get(
  "/repertoires/:id/gaps",
  wrap((req) => {
    const from = pathParam(req.query.from);
    const coverage = coverageFor(req.params.id, from);
    return {
      completion: coverage.completionPercent,
      coverageGoal: coverage.goal,
      gaps: coverage.gaps.slice(0, Number(req.query.limit) || 25).map(gapView),
      total: coverage.gaps.length,
    };
  })
);

api.post(
  "/repertoires/:id/autofill",
  wrap((req) => {
    const from = pathParam(req.body?.from);
    const limit = Math.max(1, Math.min(60, Number(req.body?.limit) || 15));
    const style = req.body?.style === "practical" ? "practical" : "mainline";
    const added = autofill(req.params.id, { from, limit, style });
    touch(req.params.id);
    return { added, completion: coverageFor(req.params.id).completionPercent };
  })
);

api.post(
  "/repertoires/:id/import",
  wrap((req) => {
    const repertoire = getRepertoire(req.params.id);
    const text = typeof req.body === "string" ? req.body : String(req.body?.pgn || "");
    const lines = pgnLines(text);
    if (!lines.length) throw httpError(400, "No games or lines found in that PGN");
    let added = 0;
    let skipped = 0;
    for (const line of lines) {
      try {
        added += addLine(repertoire.id, line.sans.slice(0, 40), { source: "import" }).length;
      } catch {
        skipped += 1;
      }
    }
    touch(repertoire.id);
    return { lines: lines.length, added, skipped };
  })
);

api.get(
  "/repertoires/:id/export",
  wrap((req, res) => {
    const repertoire = getRepertoire(req.params.id);
    const graph = graphOf(repertoire.id);
    const paths = pathsOf(repertoire.id, graph);
    // Leaves: positions with no saved continuation.
    const leaves = [];
    for (const [epd, path] of paths) {
      if (!(graph.get(epd) || []).length && path.length) leaves.push(path);
    }
    leaves.sort((a, b) => a.join(" ").localeCompare(b.join(" ")));
    const pgn = leaves
      .map(
        (path, i) =>
          `[Event "${repertoire.name}"]\n[Round "${i + 1}"]\n[White "${repertoire.color === "white" ? "Repertoire" : "?"}"]\n[Black "${repertoire.color === "black" ? "Repertoire" : "?"}"]\n[Result "*"]\n\n${movesText(path)} *\n`
      )
      .join("\n");
    res.setHeader("Content-Type", "application/x-chess-pgn; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${repertoire.name.replace(/[^\w -]/g, "")}.pgn"`);
    res.send(pgn);
  })
);

/* -------------------------------------------------------------- practice --- */

api.get(
  "/practice/:id",
  wrap((req) => {
    const repertoire = getRepertoire(req.params.id);
    return {
      repertoire: summary(repertoire),
      counts: queueCounts(repertoire.id),
      daily: dailyProgress(req.query.tz),
      mistakes: recentMistakes(repertoire.id, 8).map((r) => ({ san: r.san, played: r.played, epd: r.epd, at: r.at, opening: openingAt(r.epd) })),
    };
  })
);

api.get(
  "/practice/:id/session",
  wrap((req) =>
    buildSession(req.params.id, {
      mode: String(req.query.mode || "due"),
      path: req.query.path ? pathParam(req.query.path) : null,
    })
  )
);

api.post(
  "/practice/:id/review",
  wrap((req) => {
    const body = req.body || {};
    const result = recordReview(req.params.id, {
      moveId: body.moveId,
      correct: Boolean(body.correct),
      played: body.played ? String(body.played).slice(0, 12) : null,
      kind: body.kind === "learn" ? "learn" : "review",
      hinted: Boolean(body.hinted),
      submissionId: body.submissionId ? String(body.submissionId).slice(0, 64) : null,
      tzOffset: body.tzOffset,
    });
    return { ...result, daily: dailyProgress(body.tzOffset) };
  })
);

api.get(
  "/history",
  wrap((req) => ({
    reviews: reviewHistory({ repertoireId: req.query.repertoire || null, limit: Math.min(500, Number(req.query.limit) || 150) }),
  }))
);

/* ------------------------------------------------------------------ eval --- */

api.get(
  "/eval",
  wrap(async (req) => {
    const fen = String(req.query.fen || "");
    try {
      replay([], fen);
    } catch {
      throw httpError(400, "Invalid position");
    }
    const result = await positionEval(fen);
    if (!result) throw httpError(503, "The engine is not available");
    return result;
  })
);

/* ----------------------------------------------------------- model games --- */

api.get("/model-games/daily", wrap((req) => ({ game: models.dailyGame(req.query.tz) })));
api.post("/model-games/random", wrap(() => ({ game: models.randomGame() })));
api.get("/model-games/history", wrap(() => ({ games: models.history(), total: models.modelGameCount() })));
api.get("/model-games/:id", wrap((req) => ({ game: models.gameView(req.params.id) })));
api.get("/model-games/:id/evals", wrap((req) => models.gameEvals(req.params.id)));
api.post(
  "/model-games/:id/progress",
  wrap((req) => ({ game: models.saveProgress(req.params.id, req.body || {}) }))
);

/* --------------------------------------------------------------- puzzles --- */

api.get("/puzzles/next", wrap((req) => puzzles.nextPuzzle({ scope: req.query.scope === "all" ? "all" : "repertoire" })));
api.get("/puzzles/stats", wrap(() => puzzles.puzzleStats()));
api.post("/puzzles/:id/attempt", wrap((req) => puzzles.recordAttempt(req.params.id, { correct: Boolean(req.body?.correct) })));

/* -------------------------------------------------------- training games --- */

api.get("/training", wrap(() => ({ games: training.listGames(), ratings: training.BOT_RATINGS })));
api.post(
  "/training",
  wrap((req) =>
    training.startGame({
      color: req.body?.color,
      botRating: Number(req.body?.botRating) || 1500,
      path: pathParam(req.body?.path),
      repertoireId: req.body?.repertoireId || null,
    })
  )
);
api.get("/training/:id", wrap((req) => training.getGame(req.params.id)));
api.post("/training/:id/move", wrap((req) => training.playMove(req.params.id, req.body || {})));
api.post("/training/:id/resign", wrap((req) => training.resign(req.params.id)));

/* -------------------------------------------------------------- openings --- */

api.get(
  "/openings/search",
  wrap((req) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return { openings: [] };
    const rows = db
      .prepare(
        `SELECT eco, name, pgn, plies FROM openings WHERE name LIKE ? OR eco LIKE ?
         ORDER BY (CASE WHEN name LIKE ? THEN 0 ELSE 1 END), plies, name LIMIT 40`
      )
      .all(`%${q}%`, `${q}%`, `${q}%`);
    return {
      openings: rows.map((r) => ({
        eco: r.eco,
        name: r.name,
        sans: r.pgn.split(/\s+/).filter((t) => t && !/^\d+\./.test(t)),
        pgn: r.pgn,
      })),
    };
  })
);

api.get(
  "/about",
  wrap(() => ({
    data: explorerSummary(),
    modelGames: models.modelGameCount(),
    puzzles: db.prepare("SELECT COUNT(*) AS n FROM puzzles").get().n,
    openings: db.prepare("SELECT COUNT(*) AS n FROM openings").get().n,
    bands: BANDS,
  }))
);

api.post(
  "/reset",
  wrap((req) => {
    const what = String(req.body?.what || "");
    if (what === "progress") {
      db.prepare("UPDATE moves SET state = 'new', stability = NULL, difficulty = NULL, reps = 0, lapses = 0, due_at = NULL, last_review = NULL").run();
      db.prepare("DELETE FROM reviews").run();
      return { ok: true };
    }
    throw httpError(400, "Unknown reset");
  })
);

api.use((_req, res) => res.status(404).json({ error: "Not found" }));
