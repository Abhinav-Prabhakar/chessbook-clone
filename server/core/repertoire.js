/**
 * A repertoire is a graph of saved moves. Every move is stored once per
 * position (EPD), so transpositions share their review state.
 */
import { db, nowIso, tx } from "./db.js";
import { START_EPD, START_FEN, applyMove, epdOf, replay, sanKey, turnOf } from "./chess.js";


export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/* ---------------------------------------------------------- repertoires --- */

export function listRepertoires() {
  return db.prepare("SELECT * FROM repertoires ORDER BY sort, id").all();
}

export function getRepertoire(id) {
  const row = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(Number(id));
  if (!row) throw httpError(404, "Repertoire not found");
  return row;
}

export function createRepertoire({ name, color }) {
  if (!["white", "black"].includes(color)) throw httpError(400, "Color must be white or black");
  const clean = String(name || "").trim().slice(0, 60) || (color === "white" ? "White openings" : "Black openings");
  const sort = (db.prepare("SELECT MAX(sort) AS s FROM repertoires").get().s ?? -1) + 1;
  const stamp = nowIso();
  const id = Number(
    db
      .prepare("INSERT INTO repertoires (name, color, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(clean, color, sort, stamp, stamp).lastInsertRowid
  );
  return getRepertoire(id);
}

export function renameRepertoire(id, name) {
  const clean = String(name || "").trim().slice(0, 60);
  if (!clean) throw httpError(400, "Name is required");
  getRepertoire(id);
  db.prepare("UPDATE repertoires SET name = ?, updated_at = ? WHERE id = ?").run(clean, nowIso(), Number(id));
  return getRepertoire(id);
}

export function deleteRepertoire(id) {
  getRepertoire(id);
  db.prepare("DELETE FROM repertoires WHERE id = ?").run(Number(id));
}

/* ---------------------------------------------------------------- moves --- */

export function movesAt(repertoireId, epd) {
  return db
    .prepare("SELECT * FROM moves WHERE repertoire_id = ? AND epd = ? ORDER BY id")
    .all(Number(repertoireId), epd);
}

export function allMoves(repertoireId) {
  return db.prepare("SELECT * FROM moves WHERE repertoire_id = ? ORDER BY id").all(Number(repertoireId));
}

/** Map epd -> saved moves at that position. */
export function graphOf(repertoireId) {
  const graph = new Map();
  for (const move of allMoves(repertoireId)) {
    if (!graph.has(move.epd)) graph.set(move.epd, []);
    graph.get(move.epd).push(move);
  }
  return graph;
}

/**
 * Shortest path (SANs) from the start to every reachable position.
 * Opponent moves are explored in the order they were saved.
 */
export function pathsOf(repertoireId, graph = graphOf(repertoireId)) {
  const paths = new Map([[START_EPD, []]]);
  const queue = [START_EPD];
  while (queue.length) {
    const epd = queue.shift();
    for (const move of graph.get(epd) || []) {
      if (paths.has(move.child_epd)) continue;
      paths.set(move.child_epd, [...paths.get(epd), move.san]);
      queue.push(move.child_epd);
    }
  }
  return paths;
}

/**
 * Save every move along `sans` (from the start position). Moves already in
 * the repertoire are kept as they are. Returns the moves that were added.
 */
export function addLine(repertoireId, sans, { source = "user", note = null } = {}) {
  const repertoire = getRepertoire(repertoireId);
  let steps;
  try {
    ({ steps } = replay(sans));
  } catch {
    throw httpError(400, "That line contains an illegal move");
  }
  if (!steps.length) throw httpError(400, "No moves to add");
  const stamp = nowIso();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO moves (repertoire_id, epd, san, uci, child_epd, mine, note, source, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const added = [];
  for (const [index, step] of steps.entries()) {
    const isLast = index === steps.length - 1;
    const result = insert.run(
      repertoire.id,
      step.epdBefore,
      step.san,
      step.uci,
      step.epdAfter,
      step.side === repertoire.color ? 1 : 0,
      isLast ? note : null,
      source,
      stamp
    );
    if (result.changes) added.push({ ...step, ply: index });
  }
  if (added.length) {
    db.prepare("UPDATE repertoires SET updated_at = ? WHERE id = ?").run(stamp, repertoire.id);
  }
  return added;
}

/** Remove one saved move and anything that is no longer reachable. */
export function removeMove(repertoireId, epd, san) {
  const repertoire = getRepertoire(repertoireId);
  const key = sanKey(san);
  const target = movesAt(repertoire.id, epd).find((m) => sanKey(m.san) === key);
  if (!target) throw httpError(404, "That move is not in your repertoire");
  return tx(() => {
    db.prepare("DELETE FROM moves WHERE id = ?").run(target.id);
    return { removed: 1 + pruneUnreachable(repertoire.id) };
  });
}

export function pruneUnreachable(repertoireId) {
  const graph = graphOf(repertoireId);
  const paths = pathsOf(repertoireId, graph);
  let removed = 0;
  const del = db.prepare("DELETE FROM moves WHERE id = ?");
  for (const [epd, moves] of graph) {
    if (paths.has(epd)) continue;
    for (const move of moves) {
      del.run(move.id);
      removed += 1;
    }
  }
  return removed;
}

export function setMoveNote(repertoireId, epd, san, note) {
  const move = movesAt(repertoireId, epd).find((m) => sanKey(m.san) === sanKey(san));
  if (!move) throw httpError(404, "That move is not in your repertoire");
  const clean = String(note || "").trim().slice(0, 1000) || null;
  db.prepare("UPDATE moves SET note = ? WHERE id = ?").run(clean, move.id);
  return { ...move, note: clean };
}

/** Validate a path of SANs from the start; returns replay info. */
export function resolvePath(sans) {
  try {
    return replay(sans);
  } catch {
    throw httpError(400, "That position is not reachable with legal moves");
  }
}

/* ---------------------------------------------------------------- stats --- */

/**
 * Counts and mastery for a repertoire. Mastery follows production: each of
 * your moves scores log(interval + 1) / log(101) (interval in days, capped at
 * 100), and the repertoire's mastery is the average.
 */
export function moveStats(repertoireId) {
  const rows = db.prepare("SELECT * FROM moves WHERE repertoire_id = ?").all(Number(repertoireId));
  const mine = rows.filter((m) => m.mine === 1);
  let masterySum = 0;
  let mastered = 0;
  let learned = 0;
  let fresh = 0;
  for (const m of mine) {
    if (!m.reps) {
      fresh += 1;
      continue;
    }
    learned += 1;
    const interval =
      m.interval_days != null
        ? Number(m.interval_days)
        : m.due_at && m.last_review
          ? Math.max(0, (Date.parse(m.due_at) - Date.parse(m.last_review)) / 86_400_000)
          : 0;
    masterySum += Math.log(Math.min(100, interval) + 1) / Math.log(101);
    if (interval >= 100) mastered += 1;
  }
  return {
    saved: rows.length,
    mine: mine.length,
    fresh,
    learned,
    mastered,
    masteredPercent: mine.length ? Math.round((masterySum / mine.length) * 1000) / 10 : 0,
  };
}

/** The line a position belongs to, as SANs, following saved moves. */
export function pathTo(repertoireId, epd) {
  return pathsOf(repertoireId).get(epd) || null;
}

export function positionFromPath(sans) {
  const { steps, fen } = resolvePath(sans);
  return { fen, epd: epdOf(fen), steps, turn: turnOf(fen) };
}

export { START_FEN, START_EPD, applyMove };
