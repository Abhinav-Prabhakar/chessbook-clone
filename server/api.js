import { Router } from "express";
import { Chess } from "chess.js";
import { db, getLocalUser, createRepertoire, searchOpenings } from "./db.js";

export const api = Router();

const now = () => new Date().toISOString();
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const plusMinutes = (n) => new Date(Date.now() + n * 60000).toISOString();

const userOut = (u) => ({ id: u.id, email: u.email, name: u.name, plan: u.plan });
const lineOut = (l) => ({
  id: l.id,
  openingId: l.opening_id,
  name: l.name,
  moves: l.moves ? l.moves.split(" ") : [],
  pgn: l.pgn,
  fen: l.fen,
  side: l.side,
  expectedSan: l.expected_san,
  learned: Boolean(l.learned),
  mastered: l.mastered,
  saved: Boolean(l.saved),
  dueAt: l.due_at,
  due: Boolean(l.due_at && l.due_at <= now()),
  wrong: Number(l.wrong || 0),
});

function statsFor(repertoire) {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS line_count,
         COALESCE(SUM(learned), 0) AS learned,
         COALESCE(SUM(CASE WHEN mastered >= 80 THEN 1 ELSE 0 END), 0) AS mastered,
         COALESCE(SUM(saved), 0) AS saved,
         COALESCE(SUM(CASE WHEN due_at IS NOT NULL AND due_at <= ? THEN 1 ELSE 0 END), 0) AS due
       FROM lines WHERE repertoire_id = ?`
    )
    .get(now(), repertoire.id);
  const total = repertoire.total_lines || 0;
  return {
    ...repertoireOutBase(repertoire),
    lineCount: row.line_count,
    learned: row.learned,
    mastered: row.mastered,
    saved: row.saved,
    due: row.due,
    completion: total ? Math.min(100, Math.round((row.learned / total) * 100)) : 0,
    mastery: total ? Math.min(100, Math.round((row.mastered / total) * 100)) : 0,
  };
}

const repertoireOutBase = (r) => ({
  id: r.id,
  color: r.color,
  name: r.name,
  description: r.description,
  totalLines: r.total_lines,
  createdAt: r.created_at,
});

function getRepertoire(userId, key) {
  if (/^\d+$/.test(String(key))) {
    return db
      .prepare("SELECT * FROM repertoires WHERE id = ? AND user_id = ?")
      .get(Number(key), userId);
  }
  return db
    .prepare("SELECT * FROM repertoires WHERE color = ? AND user_id = ? ORDER BY id LIMIT 1")
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

function practiceNext(userId, repertoire, mode = "due") {
  let line = null;
  let remaining = 0;

  if (mode === "weak") {
    line = db
      .prepare(
        `SELECT l.*, COALESCE(SUM(CASE WHEN a.correct = 0 THEN 1 ELSE 0 END), 0) AS wrong
         FROM lines l
         LEFT JOIN attempts a ON a.line_id = l.id AND a.user_id = ?
         WHERE l.repertoire_id = ?
         GROUP BY l.id
         ORDER BY wrong DESC, l.mastered ASC, l.id ASC LIMIT 1`
      )
      .get(userId, repertoire.id);
    remaining = db
      .prepare(
        `SELECT COUNT(DISTINCT l.id) AS n
         FROM lines l JOIN attempts a ON a.line_id = l.id
         WHERE l.repertoire_id = ? AND a.user_id = ? AND a.correct = 0`
      )
      .get(repertoire.id, userId).n;
    if (!remaining) {
      remaining = db
        .prepare("SELECT COUNT(*) AS n FROM lines WHERE repertoire_id = ? AND mastered < 80")
        .get(repertoire.id).n;
    }
  } else if (mode === "all") {
    line = db
      .prepare(
        `SELECT * FROM lines WHERE repertoire_id = ?
         ORDER BY mastered ASC, id ASC LIMIT 1`
      )
      .get(repertoire.id);
    remaining = db
      .prepare("SELECT COUNT(*) AS n FROM lines WHERE repertoire_id = ?")
      .get(repertoire.id).n;
  } else {
    line =
      db
        .prepare(
          `SELECT * FROM lines
           WHERE repertoire_id = ?
             AND due_at IS NOT NULL AND due_at <= ?
           ORDER BY due_at ASC, id ASC LIMIT 1`
        )
        .get(repertoire.id, now()) ||
      db
        .prepare(
          `SELECT * FROM lines
           WHERE repertoire_id = ? AND mastered < 80
           ORDER BY mastered ASC, id ASC LIMIT 1`
        )
        .get(repertoire.id);
    remaining = db
      .prepare(
        "SELECT COUNT(*) AS n FROM lines WHERE repertoire_id = ? AND due_at IS NOT NULL AND due_at <= ?"
      )
      .get(repertoire.id, now()).n;
  }

  if (!line) return { line: null, stats: statsFor(repertoire), remaining: 0, complete: true };
  return { line: lineOut(line), stats: statsFor(repertoire), remaining, complete: false };
}

/**
 * There is no authentication in local-first mode. Every request is scoped to
 * the one profile stored in this installation's SQLite database.
 */
export function requireAuth(req, res, next) {
  const user = getLocalUser();
  if (!user) {
    return res.status(500).json({ error: "Local profile is missing. Run npm run db:reset." });
  }
  req.user = userOut(user);
  next();
}

api.get("/me", (req, res) => {
  const user = getLocalUser();
  if (!user) {
    return res.status(500).json({ error: "Local profile is missing. Run npm run db:reset." });
  }
  res.json({ user: userOut(user) });
});

/* ------------------------------------------------------------- dashboard --- */
api.get("/dashboard", requireAuth, (req, res) => {
  const repertoires = db
    .prepare("SELECT * FROM repertoires WHERE user_id = ? ORDER BY id")
    .all(req.user.id)
    .map(statsFor);
  const tasks = {
    due: repertoires.reduce((n, r) => n + r.due, 0),
    saved: repertoires.reduce((n, r) => n + r.saved, 0),
    mastered: repertoires.reduce((n, r) => n + r.mastered, 0),
    streak: 0,
  };
  const streakRows = db
    .prepare(
      "SELECT DISTINCT substr(created_at, 1, 10) AS day FROM attempts WHERE user_id = ? ORDER BY day DESC LIMIT 60"
    )
    .all(req.user.id);
  if (streakRows.length) {
    let streak = 0;
    const day = new Date();
    for (const row of streakRows) {
      const expected = day.toISOString().slice(0, 10);
      if (row.day === expected) {
        streak++;
        day.setDate(day.getDate() - 1);
      } else {
        break;
      }
    }
    tasks.streak = streak;
  }
  const modelGame = db.prepare("SELECT * FROM model_games ORDER BY id LIMIT 1").get();
  res.json({
    user: req.user,
    repertoires,
    tasks,
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

/* ----------------------------------------------------------- repertoires --- */
api.get("/repertoires", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM repertoires WHERE user_id = ? ORDER BY id")
    .all(req.user.id)
    .map(statsFor);
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
  const repertoire = statsFor(
    db.prepare("SELECT * FROM repertoires WHERE id = ?").get(id)
  );
  res.status(201).json({ repertoire });
});

api.get("/repertoires/:key", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const lines = db
    .prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id")
    .all(repertoire.id)
    .map(lineOut);
  res.json({ repertoire: statsFor(repertoire), lines });
});

api.patch("/repertoires/:key", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const name = req.body?.name != null ? String(req.body.name).trim() : repertoire.name;
  const description =
    req.body?.description != null ? String(req.body.description).trim() : repertoire.description;
  db.prepare("UPDATE repertoires SET name = ?, description = ? WHERE id = ?").run(
    name || repertoire.name,
    description,
    repertoire.id
  );
  res.json({
    repertoire: statsFor(db.prepare("SELECT * FROM repertoires WHERE id = ?").get(repertoire.id)),
  });
});

api.post("/repertoires/:key/reset", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  db.prepare(
    "UPDATE lines SET learned = 0, mastered = 0, saved = 0, due_at = NULL WHERE repertoire_id = ?"
  ).run(repertoire.id);
  res.json({ repertoire: statsFor(repertoire) });
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
    const prefixMoves = (gap.moves || "").split(" ").filter(Boolean).slice(0, -1);
    const prefix = prefixMoves.join(" ");
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
      const branch = allLines.filter((line) =>
        line.moves.split(" ").slice(0, prefixMoves.length + 1).join(" ") === branchSan
      );
      const mastery = branch.length
        ? Math.round(branch.reduce((sum, line) => sum + line.mastered, 0) / branch.length)
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
      });
    }
    candidates = [...widths.values()].slice(0, 10);
    position = {
      fen: gap.fen,
      side: gap.side,
      prefixMoves,
      moveNumber: Math.floor(prefixMoves.length / 2) + 1,
    };
  }
  res.json({
    repertoire: statsFor(repertoire),
    gap: gap ? lineOut(gap) : null,
    position,
    candidates,
    stats: statsFor(repertoire),
  });
});

api.post("/repertoires/:key/autofill", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const gaps = db
    .prepare(
      "SELECT id FROM lines WHERE repertoire_id = ? AND learned = 0 ORDER BY id LIMIT 6"
    )
    .all(repertoire.id);
  const update = db.prepare(
    "UPDATE lines SET learned = 1, mastered = MAX(mastered, 15), due_at = ? WHERE id = ?"
  );
  for (const line of gaps) update.run(plusMinutes(-1), line.id);
  res.json({
    filled: gaps.length,
    repertoire: statsFor(repertoire),
  });
});

api.get("/repertoires/:key/learn", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const queue = db
    .prepare(
      `SELECT l.*, COALESCE(SUM(CASE WHEN a.correct = 0 THEN 1 ELSE 0 END), 0) AS wrong
       FROM lines l
       LEFT JOIN attempts a ON a.line_id = l.id AND a.user_id = ?
       WHERE l.repertoire_id = ?
       GROUP BY l.id
       ORDER BY (l.due_at IS NOT NULL AND l.due_at <= ?) DESC, l.mastered ASC, l.id ASC
       LIMIT 100`
    )
    .all(req.user.id, repertoire.id, now())
    .map(lineOut);
  res.json({ repertoire: statsFor(repertoire), queue });
});

/* ----------------------------------------------------------------- lines --- */
api.post("/repertoires/:key/lines", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, req.params.key);
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  const openingId = req.body?.openingId;
  const pgn = String(req.body?.pgn || "").trim();
  let row = null;

  if (openingId) {
    row = db.prepare("SELECT * FROM openings WHERE id = ?").get(Number(openingId));
    if (row && row.side !== repertoire.color) {
      return res
        .status(400)
        .json({ error: `That opening practises ${row.side}; this is a ${repertoire.color} repertoire` });
    }
  } else if (pgn) {
    try {
      const chess = new Chess();
      chess.loadPgn(pgn);
      const sans = chess.history();
      if (!sans.length) throw new Error("Empty PGN");
      const before = new Chess();
      for (const san of sans.slice(0, -1)) before.move(san);
      const side = sans.length % 2 === 1 ? "white" : "black";
      if (side !== repertoire.color) {
        return res.status(400).json({
          error: `That PGN ends with a ${side} move; add it to a ${side} repertoire`,
        });
      }
      row = {
        id: null,
        name: req.body?.name || "Imported line",
        sans: sans.join(" "),
        fen: before.fen(),
        expected_san: sans[sans.length - 1],
        side,
      };
    } catch (e) {
      return res.status(400).json({ error: "Could not read that PGN" });
    }
  }
  if (!row) return res.status(400).json({ error: "Choose an opening or provide a PGN" });

  const name = String(req.body?.name || row.name || "New line").trim();
  const moves = row.sans;
  const result = db
    .prepare(
      `INSERT INTO lines
        (repertoire_id, opening_id, name, moves, pgn, fen, side, expected_san,
         learned, mastered, saved, due_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`
    )
    .run(
      repertoire.id,
      row.id || null,
      name,
      moves,
      pgn || moves,
      row.fen,
      repertoire.color,
      row.expected_san,
      plusMinutes(-1),
      now()
    );
  const line = lineOut(db.prepare("SELECT * FROM lines WHERE id = ?").get(result.lastInsertRowid));
  res.status(201).json({ line, repertoire: statsFor(repertoire) });
});

api.patch("/lines/:id", requireAuth, (req, res) => {
  const line = getLineForUser(req.user.id, Number(req.params.id));
  if (!line) return res.status(404).json({ error: "Line not found" });
  const learned = req.body?.learned != null ? Number(Boolean(req.body.learned)) : line.learned;
  const mastered = req.body?.mastered != null ? Math.max(0, Math.min(100, Number(req.body.mastered))) : line.mastered;
  const saved = req.body?.saved != null ? Number(Boolean(req.body.saved)) : line.saved;
  const dueAt = req.body?.dueAt !== undefined ? req.body.dueAt : line.due_at;
  db.prepare(
    "UPDATE lines SET learned = ?, mastered = ?, saved = ?, due_at = ? WHERE id = ?"
  ).run(learned, mastered, saved, dueAt, line.id);
  res.json({
    line: lineOut(db.prepare("SELECT * FROM lines WHERE id = ?").get(line.id)),
  });
});

api.delete("/lines/:id", requireAuth, (req, res) => {
  const line = getLineForUser(req.user.id, Number(req.params.id));
  if (!line) return res.status(404).json({ error: "Line not found" });
  db.prepare("DELETE FROM lines WHERE id = ?").run(line.id);
  res.json({ ok: true });
});

/* --------------------------------------------------------------- openings --- */
api.get("/openings", requireAuth, (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const side = req.query.side === "white" || req.query.side === "black" ? req.query.side : null;
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
      ? searchOpenings(q, side ? 50 : limit).filter((o) => !side || o.side === side).slice(0, limit)
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
      moves: o.sans.split(" "),
      fen: o.fen,
      expectedSan: o.expected_san,
      side: o.side,
      family: o.family,
    })),
  });
});

/* --------------------------------------------------------------- practice --- */
api.get("/practice/next", requireAuth, (req, res) => {
  const repertoire = getRepertoire(req.user.id, String(req.query.repertoire || "white"));
  if (!repertoire) return res.status(404).json({ error: "Repertoire not found" });
  if (req.query.line) {
    const line = getLineForUser(req.user.id, Number(req.query.line));
    if (!line) return res.status(404).json({ error: "Line not found" });
    return res.json({
      line: lineOut(line),
      stats: statsFor(repertoire),
      remaining: 1,
      complete: false,
    });
  }
  const mode = ["due", "weak", "all"].includes(req.query.mode) ? req.query.mode : "due";
  res.json(practiceNext(req.user.id, repertoire, mode));
});

api.post("/practice/attempt", requireAuth, (req, res) => {
  const line = getLineForUser(req.user.id, Number(req.body?.lineId));
  if (!line) return res.status(404).json({ error: "Line not found" });
  const san = String(req.body?.san || "").trim();
  const normalize = (s) => s.replace(/[+#!?]+$/g, "");
  const correct = normalize(san) === normalize(line.expected_san);
  const repertoire = db
    .prepare("SELECT * FROM repertoires WHERE id = ?")
    .get(line.repertoire_id);

  let mastered = line.mastered;
  let learned = line.learned;
  let dueAt = line.due_at;
  if (correct) {
    learned = 1;
    mastered = Math.min(100, Math.max(0, line.mastered) + 12);
    dueAt = mastered >= 100 ? plusDays(30) : plusDays(3);
  } else {
    dueAt = plusMinutes(10);
  }
  db.prepare(
    "UPDATE lines SET learned = ?, mastered = ?, due_at = ? WHERE id = ?"
  ).run(learned, mastered, dueAt, line.id);
  db.prepare(
    "INSERT INTO attempts (user_id, line_id, expected_san, played_san, correct, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(req.user.id, line.id, line.expected_san, san, correct ? 1 : 0, now());

  const fresh = db.prepare("SELECT * FROM lines WHERE id = ?").get(line.id);
  const mode = ["due", "weak", "all"].includes(req.body?.mode) ? req.body.mode : "due";
  res.json({
    correct,
    expectedSan: line.expected_san,
    playedSan: san,
    line: lineOut(fresh),
    next: practiceNext(req.user.id, repertoire, mode),
    stats: statsFor(repertoire),
  });
});

/* ------------------------------------------------------------------ model --- */
api.get("/model-games", requireAuth, (req, res) => {
  const games = db
    .prepare(
      `SELECT g.*, COALESCE(p.ply, 0) AS progress
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
      progress: g.progress,
    })),
  });
});

api.post("/model-games/:id/progress", requireAuth, (req, res) => {
  const game = db.prepare("SELECT * FROM model_games WHERE id = ?").get(Number(req.params.id));
  if (!game) return res.status(404).json({ error: "Game not found" });
  const ply = Math.max(0, Number(req.body?.ply) || 0);
  db.prepare(
    `INSERT INTO model_progress (user_id, game_id, ply) VALUES (?, ?, ?)
     ON CONFLICT(user_id, game_id) DO UPDATE SET ply = excluded.ply`
  ).run(req.user.id, game.id, ply);
  res.json({ ok: true, ply });
});

/* --------------------------------------------------------------- settings --- */
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
  const coordinates = body.coordinates != null ? Number(Boolean(body.coordinates)) : s.coordinates;
  const legalMoves = body.legalMoves != null ? Number(Boolean(body.legalMoves)) : s.legal_moves;
  const sound = body.sound != null ? Number(Boolean(body.sound)) : s.sound;
  const showHints = body.showHints != null ? Number(Boolean(body.showHints)) : s.show_hints;
  const dailyGoal = body.dailyGoal != null ? Math.max(1, Math.min(100, Number(body.dailyGoal))) : s.daily_goal;
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

api.patch("/user", requireAuth, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required" });
  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, req.user.id);
  res.json({ user: { ...req.user, name } });
});

api.get("/health", (_req, res) => res.json({ ok: true, time: now() }));
