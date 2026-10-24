/**
 * Practice, modelled on production Chessbook (see docs/learning-flow-parity.md).
 *
 * The unit is a quiz group: one position where you have saved move(s), with
 * the line that leads to it. Every saved move in the group has to be played.
 * Groups are collected by walking the repertoire depth-first from the start;
 * at your opponent's turns, common replies tend to come first (weighted by
 * how often they are played at your level, with some randomness).
 *
 * A move is "due" when its due date is today or earlier, or when it has never
 * been practised. Never-practised moves are in first practice ("learning"):
 * the client shows them with arrows, and that first pass is what gets
 * recorded.
 */
import { db, nowIso } from "./db.js";
import { getRepertoire, graphOf, httpError } from "./repertoire.js";
import { readSettings, userBand } from "./settings.js";
import { schedule } from "./srs.js";
import { computeStreak, localDay, parseOffset, todayLocal } from "./dates.js";
import { applyMove, epdOf, START_FEN, turnOf } from "./chess.js";
import { openingAt, openingForPath, replyDistribution } from "./explorer.js";
import { builtinNote } from "./notes.js";

export const FILTERS = ["due", "daily", "recommended", "difficult-due", "difficult", "early", "all", "line"];

/* ------------------------------------------------------------ move state --- */

/** Scheduled interval in days (0 for a move never practised). */
export function intervalOf(move) {
  if (move.interval_days != null) return Number(move.interval_days);
  if (!move.due_at || !move.last_review) return 0;
  return Math.max(0, (Date.parse(move.due_at) - Date.parse(move.last_review)) / 86_400_000);
}

/** 0–1 mastery from the interval, on a log scale capped at 100 days. */
export function masteryOf(move) {
  if (!move.reps) return 0;
  const i = Math.min(100, Math.max(0, intervalOf(move)));
  return Math.log(i + 1) / Math.log(101);
}

export function statusOf(move) {
  const i = move.reps ? intervalOf(move) : 0;
  return i <= 1 ? "new" : i <= 15 ? "learning" : i < 100 ? "solid" : "mastered";
}

/** FSRS difficulty (1–10) as 0–1, as production reports it. */
export function difficultyOf(move) {
  if (!move.reps || move.difficulty == null) return null;
  return Math.max(0, Math.min(1, (Number(move.difficulty) - 1) / 9));
}

export function isDue(move, today, offset) {
  if (!move.reps || !move.due_at) return true;
  return localDay(move.due_at, offset) <= today;
}

export function isDifficult(move) {
  const d = difficultyOf(move);
  return d != null && d > 0.6;
}

/* ----------------------------------------------------------------- walk --- */

/**
 * Every one of your positions, depth-first from `startPath`, as quiz groups.
 * `random` makes the opponent-reply order vary from session to session.
 */
function walkGroups(repertoire, { startPath = [], random = Math.random } = {}) {
  const graph = graphOf(repertoire.id);
  const band = userBand();
  const groups = [];
  const seen = new Set();
  let fen = START_FEN;
  for (const san of startPath) {
    const next = applyMove(fen, san);
    if (!next) throw httpError(400, "That line is not legal");
    fen = next.fen;
  }

  const visit = (fen, line, preceding, reach) => {
    const epd = epdOf(fen);
    const saved = graph.get(epd) || [];
    if (!saved.length) return;
    const myTurn = turnOf(fen) === repertoire.color;
    if (myTurn) {
      const mine = saved.filter((m) => m.mine === 1);
      if (!mine.length) return;
      const group = { epd, fen, line, side: repertoire.color, moves: mine, reach };
      groups.push({ ...group, preceding });
      const nextPreceding = [...preceding, group];
      for (const move of mine) {
        const next = applyMove(fen, move.san);
        if (!next || seen.has(next.epd)) continue;
        seen.add(next.epd);
        visit(next.fen, [...line, next.san], nextPreceding, reach);
      }
      return;
    }
    // Opponent's turn: common replies tend to come first.
    const shares = new Map(replyDistribution(epd, band).map((r) => [r.san, r.p]));
    const ordered = saved
      .map((m) => ({ m, key: 1 - random() * (shares.get(m.san) ?? 0) }))
      .sort((a, b) => a.key - b.key)
      .map((x) => x.m);
    for (const move of ordered) {
      const next = applyMove(fen, move.san);
      if (!next || seen.has(next.epd)) continue;
      seen.add(next.epd);
      visit(next.fen, [...line, next.san], preceding, reach * (shares.get(move.san) ?? 0));
    }
  };
  seen.add(epdOf(fen));
  visit(fen, [...startPath], [], 1);
  return groups;
}

/* ---------------------------------------------------------------- counts --- */

export function queueCounts(repertoireId, tzOffset = null) {
  const repertoire = getRepertoire(repertoireId);
  const offset = parseOffset(tzOffset);
  const today = todayLocal(offset);
  const groups = walkGroups(repertoire, { random: () => 0.5 });
  const counts = { due: 0, fresh: 0, difficultDue: 0, difficult: 0, early: 0, all: 0 };
  let nextDue = null;
  for (const group of groups) {
    for (const move of group.moves) {
      counts.all += 1;
      const due = isDue(move, today, offset);
      if (!move.reps) counts.fresh += 1;
      if (due) counts.due += 1;
      else {
        counts.early += 1;
        if (!nextDue || move.due_at < nextDue) nextDue = move.due_at;
      }
      if (isDifficult(move)) {
        counts.difficult += 1;
        if (due) counts.difficultDue += 1;
      }
    }
  }
  const settings = readSettings();
  return { ...counts, nextDue, batch: Number(settings.dailyGoal) || 10 };
}

/* --------------------------------------------------------------- session --- */

function serializeGroup(group, { learning, offset, today, synthetic = false }) {
  const epds = [epdOf(START_FEN)];
  let fen = START_FEN;
  for (const san of group.line) {
    fen = applyMove(fen, san).fen;
    epds.push(epdOf(fen));
  }
  return {
    epd: group.epd,
    fen: group.fen,
    line: group.line,
    side: group.side,
    synthetic,
    opening: openingForPath(epds),
    moves: group.moves.map((m) => {
      const applied = applyMove(group.fen, m.san);
      return {
        moveId: m.id,
        san: applied.san,
        uci: applied.uci,
        from: applied.from,
        to: applied.to,
        note: m.note || builtinNote(group.epd, applied.san),
        // Learning = first practice; synthetic groups never teach.
        learning: synthetic ? false : learning && !m.reps,
        due: isDue(m, today, offset),
        // A move with no saved continuation ends the line.
        leaf: false,
      };
    }),
  };
}

/**
 * Build a session.
 *  filter: due | daily | recommended | difficult-due | difficult | early | all | line
 *  path:   for "line" (and "Practice from here"), the start of the line.
 */
export function buildSession(repertoireId, { filter = "due", path = [], tzOffset = null } = {}) {
  if (!FILTERS.includes(filter)) throw httpError(400, "Unknown practice filter");
  const repertoire = getRepertoire(repertoireId);
  const settings = readSettings();
  const offset = parseOffset(tzOffset);
  const today = todayLocal(offset);
  const style = settings.reviewStyle;
  const batch = Number(settings.dailyGoal) || 10;
  const learning = !settings.skipFirstPractice;
  const graph = graphOf(repertoire.id);

  const groups = walkGroups(repertoire);

  const due = (g) => g.moves.some((m) => isDue(m, today, offset));
  const difficult = (g) => g.moves.some((m) => isDifficult(m));
  let selected;
  switch (filter) {
    case "due":
      selected = groups.filter(due);
      break;
    case "daily":
    case "recommended": {
      // The most frequently reached due positions, kept in walk order.
      const pool = groups.filter(due);
      const keep = new Set([...pool].sort((a, b) => b.reach - a.reach).slice(0, batch));
      selected = pool.filter((g) => keep.has(g));
      break;
    }
    case "difficult-due":
      selected = groups.filter((g) => due(g) && difficult(g));
      break;
    case "difficult":
      selected = groups.filter(difficult);
      break;
    case "early": {
      const pool = groups.filter((g) => !due(g));
      const firstDue = (g) => g.moves.map((m) => m.due_at || "").sort()[0] || "";
      const keep = new Set([...pool].sort((a, b) => firstDue(a).localeCompare(firstDue(b))).slice(0, batch));
      selected = pool.filter((g) => keep.has(g));
      break;
    }
    case "line": {
      // The positions along the line and everything after its end.
      const prefix = Array.isArray(path) ? path : [];
      const isPrefix = (a, b) => a.length <= b.length && a.every((san, i) => b[i] === san);
      selected = groups.filter((g) => isPrefix(g.line, prefix) || isPrefix(prefix, g.line));
      break;
    }
    default:
      selected = groups;
  }

  const ended = (group, san) => {
    const next = applyMove(group.fen, san);
    return !next || !(graph.get(next.epd) || []).length;
  };
  const serialize = (g, opts) => {
    const out = serializeGroup(g, { learning, offset, today, ...opts });
    out.moves.forEach((m) => {
      m.leaf = ended(g, m.san);
    });
    return out;
  };

  const lineStyle = style === "every" || style === "once";
  return {
    repertoireId: repertoire.id,
    color: repertoire.color,
    filter,
    style,
    pause: settings.reviewPauseBehavior,
    groups: selected.map((g) => ({
      ...serialize(g, {}),
      // In "complete lines" styles the positions before this one are asked too, unscored.
      preceding: lineStyle ? g.preceding.map((p) => serialize({ ...p, moves: p.moves }, { synthetic: true })) : [],
    })),
  };
}

/* --------------------------------------------------------------- reviews --- */

/**
 * Record the results of one quiz group. Each result: { moveId, correct, played }.
 * Mirrors production's moves_reviewed: one call per group, idempotent by
 * submissionId, returning each move's new schedule.
 */
export function recordGroup(repertoireId, { submissionId, results = [], daily = false, tzOffset = null }) {
  getRepertoire(repertoireId);
  if (!Array.isArray(results) || !results.length) throw httpError(400, "No results");
  const at = nowIso();
  const day = localDay(at, parseOffset(tzOffset));
  const out = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [index, result] of results.entries()) {
      const move = db
        .prepare("SELECT * FROM moves WHERE id = ? AND repertoire_id = ?")
        .get(Number(result.moveId), Number(repertoireId));
      if (!move) throw httpError(404, "Move not found");
      if (move.mine !== 1) throw httpError(400, "Only your own moves are reviewed");
      const key = submissionId ? `${String(submissionId).slice(0, 64)}:${index}` : null;
      if (key && db.prepare("SELECT 1 FROM reviews WHERE submission_id = ?").get(key)) {
        out.push(srsView(move));
        continue;
      }
      const firstReview = !move.reps;
      const grade = result.correct ? 3 : 1;
      const next = schedule(move, grade, at);
      db.prepare(
        `UPDATE moves SET state = ?, stability = ?, difficulty = ?, reps = ?, lapses = ?, due_at = ?,
           last_review = ?, interval_days = ? WHERE id = ?`
      ).run(next.state, next.stability, next.difficulty, next.reps, next.lapses, next.dueAt, next.lastReview, next.intervalDays, move.id);
      db.prepare(
        `INSERT INTO reviews (repertoire_id, move_id, epd, san, played, correct, grade, kind, submission_id, at, day)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        move.repertoire_id,
        move.id,
        move.epd,
        move.san,
        result.played ? String(result.played).slice(0, 12) : null,
        result.correct ? 1 : 0,
        grade,
        firstReview ? "first" : daily ? "daily" : "review",
        key,
        at,
        day
      );
      out.push(srsView(db.prepare("SELECT * FROM moves WHERE id = ?").get(move.id)));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return out;
}

export function srsView(move) {
  return {
    moveId: move.id,
    dueAt: move.due_at,
    firstReview: !move.reps,
    difficulty: difficultyOf(move),
    interval: Math.round(intervalOf(move) * 10) / 10,
    mastery: masteryOf(move),
    status: statusOf(move),
  };
}

/* ------------------------------------------------------------ progress --- */

export function dailyProgress(tzOffset = null) {
  const offset = parseOffset(tzOffset);
  const today = todayLocal(offset);
  const settings = readSettings();
  const rows = db.prepare("SELECT day, COUNT(*) AS n, SUM(correct) AS ok FROM reviews GROUP BY day").all();
  const days = rows.map((r) => r.day);
  const todayRow = rows.find((r) => r.day === today);
  const streak = computeStreak(days, offset, today);
  return {
    today,
    reviewed: todayRow?.n || 0,
    correct: todayRow?.ok || 0,
    goal: Number(settings.dailyGoal) || 10,
    streak: streak.current,
    bestStreak: streak.highest,
    practicedToday: Boolean(todayRow),
  };
}

export function recentMistakes(repertoireId, limit = 20) {
  return db
    .prepare(
      `SELECT r.*, m.note FROM reviews r LEFT JOIN moves m ON m.id = r.move_id
       WHERE r.repertoire_id = ? AND r.correct = 0
       ORDER BY r.at DESC LIMIT ?`
    )
    .all(Number(repertoireId), limit);
}

export function reviewHistory({ repertoireId = null, limit = 100 } = {}) {
  const rows = repertoireId
    ? db.prepare("SELECT * FROM reviews WHERE repertoire_id = ? ORDER BY at DESC LIMIT ?").all(Number(repertoireId), limit)
    : db.prepare("SELECT * FROM reviews ORDER BY at DESC LIMIT ?").all(limit);
  return rows.map((r) => ({ ...r, correct: r.correct === 1, opening: openingAt(r.epd) }));
}
