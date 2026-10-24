/**
 * Practice: which of your moves to train, and recording each answer.
 *
 * A session is a list of lines. Each line is a path from the start; the
 * client plays it out, auto-playing the opponent and any of your moves that
 * are not being trained, and asks for the moves listed in `ask`.
 */
import { db, nowIso } from "./db.js";
import { allMoves, getRepertoire, graphOf, pathsOf, httpError, MASTERED_DAYS } from "./repertoire.js";
import { readSettings } from "./settings.js";
import { schedule } from "./srs.js";
import { computeStreak, localDay, parseOffset, todayLocal } from "./dates.js";
import { applyMove, START_FEN, epdOf, turnOf } from "./chess.js";
import { openingAt, openingForPath } from "./explorer.js";
import { builtinNote } from "./notes.js";

export const MODES = ["due", "new", "difficult", "all", "line", "early"];

function isDue(move, now) {
  return move.reps > 0 && move.due_at && move.due_at <= now;
}

function isDifficult(move) {
  return move.reps > 0 && (move.lapses >= 1 || Number(move.difficulty) >= 7);
}

/** Every one of your moves that is reachable from the start, with its path. */
function reachableMine(repertoireId) {
  const graph = graphOf(repertoireId);
  const paths = pathsOf(repertoireId, graph);
  const out = [];
  for (const [epd, moves] of graph) {
    const path = paths.get(epd);
    if (!path) continue;
    for (const move of moves) {
      if (move.mine === 1) out.push({ move, path: [...path, move.san] });
    }
  }
  // Depth-first order: lines group together, shallow moves first.
  out.sort((a, b) => {
    const n = Math.min(a.path.length, b.path.length);
    for (let i = 0; i < n; i += 1) {
      if (a.path[i] !== b.path[i]) return a.path[i] < b.path[i] ? -1 : 1;
    }
    return a.path.length - b.path.length;
  });
  return { graph, paths, items: out };
}

export function queueCounts(repertoireId, now = nowIso()) {
  const { items } = reachableMine(repertoireId);
  const counts = { due: 0, fresh: 0, difficult: 0, all: items.length, scheduled: 0 };
  let nextDue = null;
  for (const { move } of items) {
    if (move.reps === 0) counts.fresh += 1;
    else if (isDue(move, now)) counts.due += 1;
    else {
      counts.scheduled += 1;
      if (!nextDue || move.due_at < nextDue) nextDue = move.due_at;
    }
    if (isDifficult(move)) counts.difficult += 1;
  }
  return { ...counts, nextDue };
}

/**
 * Build a practice session.
 * mode: due (due + some new), new, difficult, all, early (not yet due), line (moves along `path`).
 */
export function buildSession(repertoireId, { mode = "due", path = null, limit = null } = {}) {
  const repertoire = getRepertoire(repertoireId);
  const settings = readSettings();
  const now = nowIso();
  const { graph, items } = reachableMine(repertoireId);
  const newLimit = Number(limit) || Number(settings.newPerSession) || 10;

  let targets;
  if (mode === "due") {
    const due = items.filter((i) => isDue(i.move, now));
    const fresh = items.filter((i) => i.move.reps === 0).slice(0, newLimit);
    targets = [...due, ...fresh];
  } else if (mode === "new") {
    targets = items.filter((i) => i.move.reps === 0).slice(0, newLimit);
  } else if (mode === "difficult") {
    targets = items
      .filter((i) => isDifficult(i.move))
      .sort((a, b) => b.move.lapses - a.move.lapses || Number(b.move.difficulty) - Number(a.move.difficulty))
      .slice(0, 40);
  } else if (mode === "early") {
    targets = items
      .filter((i) => i.move.reps > 0 && !isDue(i.move, now))
      .sort((a, b) => String(a.move.due_at).localeCompare(String(b.move.due_at)))
      .slice(0, 30);
  } else if (mode === "line") {
    const prefix = Array.isArray(path) ? path : [];
    targets = items.filter((i) => prefix.every((san, k) => i.path[k] === san) || i.path.every((san, k) => prefix[k] === san));
  } else if (mode === "all") {
    targets = items;
  } else {
    throw httpError(400, "Unknown practice mode");
  }

  // Keep depth-first order so related moves are practised together.
  const order = new Map(items.map((item, index) => [item.move.id, index]));
  targets = [...new Map(targets.map((t) => [t.move.id, t])).values()].sort(
    (a, b) => order.get(a.move.id) - order.get(b.move.id)
  );

  const lines = [];
  for (const target of targets) {
    const current = lines[lines.length - 1];
    if (current && target.path.length > current.sans.length && current.sans.every((s, i) => target.path[i] === s)) {
      current.sans = target.path;
      current.ask.push(target.path.length - 1);
      current.moveIds.push(target.move.id);
      continue;
    }
    lines.push({ sans: [...target.path], ask: [target.path.length - 1], moveIds: [target.move.id] });
  }

  if (settings.wholeLines || mode === "line") {
    // Continue each line to its end along saved moves and ask every one of your moves.
    for (const line of lines) {
      extendToLeaf(line, graph, repertoire.color);
    }
  }

  const byEpd = new Map();
  for (const m of allMoves(repertoireId)) {
    if (!byEpd.has(m.epd)) byEpd.set(m.epd, []);
    byEpd.get(m.epd).push(m);
  }
  return {
    repertoireId: repertoire.id,
    color: repertoire.color,
    mode,
    lines: lines.map((line) => decorateLine(line, byEpd, repertoire.color)),
    total: targets.length,
  };
}

function extendToLeaf(line, graph, color) {
  let fen = START_FEN;
  for (const san of line.sans) fen = applyMove(fen, san).fen;
  for (let guard = 0; guard < 40; guard += 1) {
    const moves = graph.get(epdOf(fen)) || [];
    const next = moves.find((m) => m.mine === 1) || moves[0];
    if (!next) break;
    const applied = applyMove(fen, next.san);
    if (!applied) break;
    line.sans.push(applied.san);
    if (next.mine === 1) {
      line.ask.push(line.sans.length - 1);
      line.moveIds.push(next.id);
    }
    fen = applied.fen;
  }
  // Ask every one of your moves in the line, not just the scheduled ones.
  const ask = new Set(line.ask);
  let f = START_FEN;
  line.sans.forEach((san, index) => {
    if (turnOf(f) === color) ask.add(index);
    f = applyMove(f, san).fen;
  });
  line.ask = [...ask].sort((a, b) => a - b);
}

function decorateLine(line, byEpd, color) {
  let fen = START_FEN;
  const plies = [];
  const epds = [epdOf(fen)];
  for (const [index, san] of line.sans.entries()) {
    const epd = epdOf(fen);
    const applied = applyMove(fen, san);
    const saved = byEpd.get(epd) || [];
    const move = saved.find((m) => m.san === applied.san);
    const asked = line.ask.includes(index);
    plies.push({
      san: applied.san,
      uci: applied.uci,
      from: applied.from,
      to: applied.to,
      fen,
      side: turnOf(fen),
      ask: asked,
      moveId: move?.id ?? null,
      fresh: asked && move ? move.reps === 0 : false,
      note: move?.note || builtinNote(epd, applied.san),
      // Other saved moves of yours from this position are accepted too.
      alternatives: asked ? saved.filter((m) => m.mine === 1 && m.san !== applied.san).map((m) => m.san) : [],
    });
    fen = applied.fen;
    epds.push(epdOf(fen));
  }
  const firstAsk = plies.findIndex((p) => p.ask);
  return {
    sans: line.sans,
    plies,
    start: Math.max(0, firstAsk),
    opening: openingForPath(epds),
    color,
  };
}

/* --------------------------------------------------------------- reviews --- */

/**
 * Record an answer for one of your moves.
 * kind "learn": first time you were shown the move (no scheduling yet).
 * kind "review": you recalled it; `correct` is false if you needed more than one try.
 */
export function recordReview(repertoireId, { moveId, correct, played = null, kind = "review", hinted = false, submissionId = null, tzOffset = null }) {
  const move = db.prepare("SELECT * FROM moves WHERE id = ? AND repertoire_id = ?").get(Number(moveId), Number(repertoireId));
  if (!move) throw httpError(404, "Move not found");
  if (move.mine !== 1) throw httpError(400, "Only your own moves are reviewed");
  if (submissionId) {
    const existing = db.prepare("SELECT * FROM reviews WHERE submission_id = ?").get(String(submissionId));
    if (existing) return { duplicate: true, move: serializeMove(move) };
  }
  const at = nowIso();
  const day = localDay(at, parseOffset(tzOffset));
  let next = move;
  let grade = null;
  if (kind === "learn") {
    db.prepare("UPDATE moves SET state = 'learning' WHERE id = ?").run(move.id);
  } else {
    grade = correct ? (hinted ? 2 : 3) : 1;
    const result = schedule(move, grade, at);
    db.prepare(
      `UPDATE moves SET state = ?, stability = ?, difficulty = ?, reps = ?, lapses = ?, due_at = ?, last_review = ?
       WHERE id = ?`
    ).run(result.state, result.stability, result.difficulty, result.reps, result.lapses, result.dueAt, result.lastReview, move.id);
    next = db.prepare("SELECT * FROM moves WHERE id = ?").get(move.id);
  }
  db.prepare(
    `INSERT INTO reviews (repertoire_id, move_id, epd, san, played, correct, grade, kind, submission_id, at, day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(move.repertoire_id, move.id, move.epd, move.san, played, correct ? 1 : 0, grade, kind, submissionId, at, day);
  return { duplicate: false, move: serializeMove(next) };
}

export function serializeMove(move) {
  return {
    id: move.id,
    san: move.san,
    epd: move.epd,
    state: move.state,
    reps: move.reps,
    lapses: move.lapses,
    dueAt: move.due_at,
    stability: move.stability,
    mastered: Number(move.stability) >= MASTERED_DAYS,
    note: move.note,
  };
}

export function dailyProgress(tzOffset = null) {
  const offset = parseOffset(tzOffset);
  const today = todayLocal(offset);
  const settings = readSettings();
  // Only graded answers count; being shown a new move is not a review.
  const rows = db
    .prepare("SELECT day, COUNT(*) AS n, SUM(correct) AS ok FROM reviews WHERE kind = 'review' GROUP BY day")
    .all();
  const days = rows.map((r) => r.day);
  const todayRow = rows.find((r) => r.day === today);
  const streak = computeStreak(days, offset, today);
  return {
    today,
    reviewed: todayRow?.n || 0,
    correct: todayRow?.ok || 0,
    goal: Number(settings.dailyGoal) || 20,
    streak: streak.current,
    bestStreak: streak.highest,
    practicedToday: Boolean(todayRow),
  };
}

export function recentMistakes(repertoireId, limit = 20) {
  return db
    .prepare(
      `SELECT r.*, m.note FROM reviews r LEFT JOIN moves m ON m.id = r.move_id
       WHERE r.repertoire_id = ? AND r.correct = 0 AND r.kind = 'review'
       ORDER BY r.at DESC LIMIT ?`
    )
    .all(Number(repertoireId), limit);
}

export function reviewHistory({ repertoireId = null, limit = 100 } = {}) {
  const rows = repertoireId
    ? db.prepare("SELECT * FROM reviews WHERE repertoire_id = ? ORDER BY at DESC LIMIT ?").all(Number(repertoireId), limit)
    : db.prepare("SELECT * FROM reviews ORDER BY at DESC LIMIT ?").all(limit);
  return rows.map((r) => ({
    ...r,
    correct: r.correct === 1,
    opening: openingAt(r.epd),
  }));
}
