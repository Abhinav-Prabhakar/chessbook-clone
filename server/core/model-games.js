/**
 * Model games: complete master games that follow your repertoire.
 *
 * A game is a candidate when it passes through positions you have saved.
 * The deeper the shared position, the better the match.
 */
import { db, nowIso } from "./db.js";
import { graphOf, listRepertoires, pathsOf, httpError } from "./repertoire.js";
import { openingForPath } from "./explorer.js";
import { replay, epdOf, START_EPD } from "./chess.js";
import { todayLocal } from "./dates.js";
import { masterGamesReady } from "./data-import.js";
import { analyse } from "../engine.js";

function repertoirePositions(repertoire) {
  const graph = graphOf(repertoire.id);
  const paths = pathsOf(repertoire.id, graph);
  // Deep positions are more specific (and much cheaper to look up); shallow
  // ones are only used when the repertoire has nothing deeper.
  const all = [];
  for (const [epd, path] of paths) {
    if (epd === START_EPD || path.length < 4) continue;
    all.push({ epd, depth: path.length });
  }
  const deep = all.filter((p) => p.depth >= 6);
  return deep.length >= 3 ? deep : all;
}

const candidateCache = new Map();

/** Ranked candidate games for one repertoire. */
export function candidatesFor(repertoire, limit = 150) {
  const stamp = `${repertoire.id}|${repertoire.updated_at}|${modelGameCount()}`;
  const hit = candidateCache.get(stamp);
  if (hit) return hit;
  const positions = repertoirePositions(repertoire);
  const depthByEpd = new Map(positions.map((p) => [p.epd, p.depth]));
  const best = new Map();
  const epds = [...depthByEpd.keys()];
  for (let i = 0; i < epds.length; i += 400) {
    const chunk = epds.slice(i, i + 400);
    const rows = db
      .prepare(
        `SELECT p.game_id, p.epd, p.ply, g.result, g.year FROM master_game_positions p
         JOIN master_games g ON g.id = p.game_id
         WHERE p.epd IN (${chunk.map(() => "?").join(",")})`
      )
      .all(...chunk);
    for (const row of rows) {
      const depth = depthByEpd.get(row.epd);
      if (depth !== row.ply) continue; // same position, same move order depth
      const prev = best.get(row.game_id);
      if (!prev || prev.depth < depth) best.set(row.game_id, { gameId: row.game_id, depth, result: row.result, year: row.year });
    }
  }
  const color = repertoire.color;
  const won = (r) => (color === "white" ? r === "1-0" : r === "0-1");
  const ranked = [...best.values()]
    .map((c) => ({ ...c, score: c.depth * 10 + (won(c.result) ? 6 : c.result === "1/2-1/2" ? 2 : 0) + (c.year || 1900) / 1000 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => ({ ...c, repertoireId: repertoire.id, side: color }));
  if (candidateCache.size > 20) candidateCache.clear();
  candidateCache.set(stamp, ranked);
  return ranked;
}

function allCandidates() {
  const out = [];
  for (const repertoire of listRepertoires()) out.push(...candidatesFor(repertoire, 120));
  return out.sort((a, b) => b.score - a.score);
}

function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Fallback when the repertoires are too small to match any game. */
function anyGame(seed) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM master_games").get().n;
  if (!count) return null;
  const row = db.prepare("SELECT id FROM master_games LIMIT 1 OFFSET ?").get(seed % count);
  return row ? { gameId: row.id, depth: 0, repertoireId: null, side: "white" } : null;
}

export function dailyGame(tzOffset) {
  if (!masterGamesReady()) return null;
  const today = todayLocal(tzOffset ?? undefined);
  const existing = db.prepare("SELECT * FROM model_progress WHERE daily_day = ?").get(today);
  if (existing) return gameView(existing.game_id);
  const done = new Set(db.prepare("SELECT game_id FROM model_progress").all().map((r) => r.game_id));
  const pool = allCandidates().filter((c) => !done.has(c.gameId)).slice(0, 40);
  const pick = pool.length ? pool[hash(today) % pool.length] : anyGame(hash(today));
  if (!pick) return null;
  startProgress(pick, today);
  return gameView(pick.gameId);
}

export function randomGame() {
  if (!masterGamesReady()) return null;
  const done = new Set(db.prepare("SELECT game_id FROM model_progress").all().map((r) => r.game_id));
  const pool = allCandidates().filter((c) => !done.has(c.gameId)).slice(0, 120);
  const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : anyGame(Math.floor(Math.random() * 1e9));
  if (!pick) return null;
  startProgress(pick, null);
  return gameView(pick.gameId);
}

function startProgress(pick, day) {
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO model_progress (game_id, repertoire_id, side, match_plies, started_at, updated_at, daily_day)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(game_id) DO UPDATE SET updated_at = excluded.updated_at, daily_day = COALESCE(model_progress.daily_day, excluded.daily_day)`
  ).run(pick.gameId, pick.repertoireId, pick.side, pick.depth, stamp, stamp, day);
}

export function gameView(gameId) {
  const game = db.prepare("SELECT * FROM master_games WHERE id = ?").get(Number(gameId));
  if (!game) throw httpError(404, "Model game not found");
  const progress = db.prepare("SELECT * FROM model_progress WHERE game_id = ?").get(game.id);
  const sans = game.sans.split(" ");
  const { steps } = replay(sans);
  const epds = [START_EPD, ...steps.map((s) => s.epdAfter)];
  const opening = openingForPath(epds.slice(0, 30));
  let repertoire = null;
  if (progress?.repertoire_id) {
    repertoire = db.prepare("SELECT id, name, color FROM repertoires WHERE id = ?").get(progress.repertoire_id) || null;
  }
  // How far the game follows the repertoire, move by move.
  let follows = 0;
  if (repertoire) {
    const graph = graphOf(repertoire.id);
    for (const step of steps) {
      const saved = graph.get(step.epdBefore) || [];
      if (!saved.some((m) => m.san === step.san)) break;
      follows += 1;
    }
  }
  return {
    id: game.id,
    white: cleanName(game.white),
    black: cleanName(game.black),
    whiteElo: game.white_elo,
    blackElo: game.black_elo,
    event: cleanEvent(game.event),
    year: game.year,
    result: game.result,
    eco: game.eco,
    sans,
    moves: steps.map((s) => ({ san: s.san, from: s.from, to: s.to, uci: s.uci, fen: s.fenAfter })),
    opening,
    repertoire,
    side: progress?.side || "white",
    follows,
    progress: progress
      ? {
          ply: progress.ply,
          correct: progress.correct,
          wrong: progress.wrong,
          completed: Boolean(progress.completed_at),
          daily: progress.daily_day,
        }
      : null,
  };
}

function cleanName(name) {
  // "Carlsen, Magnus" -> "Magnus Carlsen"; "Carlsen,M" -> "Carlsen"
  const text = String(name || "?").trim();
  const [last, first] = text.split(",").map((s) => s.trim());
  if (first && first.length > 2) return `${first} ${last}`;
  return last || text;
}

function cleanEvent(event) {
  const text = String(event || "").trim();
  return text && text !== "?" ? text : null;
}

export function saveProgress(gameId, { ply, correct, wrong, completed }) {
  const game = db.prepare("SELECT plies FROM master_games WHERE id = ?").get(Number(gameId));
  if (!game) throw httpError(404, "Model game not found");
  const row = db.prepare("SELECT * FROM model_progress WHERE game_id = ?").get(Number(gameId));
  if (!row) throw httpError(404, "Open the game first");
  const clamp = (n, max) => Math.max(0, Math.min(max, Math.trunc(Number(n) || 0)));
  db.prepare(
    `UPDATE model_progress SET ply = ?, correct = ?, wrong = ?, updated_at = ?,
       completed_at = CASE WHEN ? THEN COALESCE(completed_at, ?) ELSE completed_at END
     WHERE game_id = ?`
  ).run(
    clamp(ply, game.plies),
    clamp(correct, game.plies),
    clamp(wrong, 999),
    nowIso(),
    completed ? 1 : 0,
    nowIso(),
    Number(gameId)
  );
  return gameView(gameId);
}

export function history(limit = 60) {
  return db
    .prepare(
      `SELECT p.*, g.white, g.black, g.white_elo, g.black_elo, g.event, g.year, g.result, g.plies, g.sans
       FROM model_progress p JOIN master_games g ON g.id = p.game_id
       ORDER BY p.updated_at DESC LIMIT ?`
    )
    .all(limit)
    .map((r) => ({
      id: r.game_id,
      white: cleanName(r.white),
      black: cleanName(r.black),
      whiteElo: r.white_elo,
      blackElo: r.black_elo,
      event: cleanEvent(r.event),
      year: r.year,
      result: r.result,
      plies: r.plies,
      side: r.side,
      ply: r.ply,
      correct: r.correct,
      wrong: r.wrong,
      completed: Boolean(r.completed_at),
      daily: r.daily_day,
      updatedAt: r.updated_at,
      opening: openingFamily(r.sans),
    }));
}

function openingFamily(sansText) {
  try {
    const { steps } = replay(String(sansText).split(" ").slice(0, 24));
    const hit = openingForPath([START_EPD, ...steps.map((s) => s.epdAfter)]);
    return hit ? hit.name.split(":")[0] : null;
  } catch {
    return null;
  }
}

export function modelGameCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM master_games").get().n;
}

export { epdOf };

/* ---------------------------------------------------------------- evals --- */

const EVAL_DEPTH = 10;
const evalJobs = new Map();

/**
 * Engine evaluation after every move (White's point of view, in pawns,
 * mates as ±10). Computed once in the background and cached.
 */
export function gameEvals(gameId) {
  const id = Number(gameId);
  const row = db.prepare("SELECT json FROM model_game_evals WHERE game_id = ?").get(id);
  if (row) return { status: "ready", evals: JSON.parse(row.json) };
  const game = db.prepare("SELECT sans FROM master_games WHERE id = ?").get(id);
  if (!game) throw httpError(404, "Model game not found");
  let job = evalJobs.get(id);
  if (!job) {
    const { steps } = replay(game.sans.split(" "));
    job = { done: 0, total: steps.length + 1, evals: [] };
    evalJobs.set(id, job);
    (async () => {
      const fens = [steps.length ? steps[0].fenBefore : null, ...steps.map((s) => s.fenAfter)].filter(Boolean);
      for (const fen of fens) {
        const result = await analyse(fen, { depth: EVAL_DEPTH, multipv: 1 });
        let value = null;
        if (result.available) {
          value = result.mate != null ? (result.mate > 0 ? 10 : -10) : Math.max(-10, Math.min(10, (result.evalCp ?? 0) / 100));
        }
        job.evals.push(value);
        job.done += 1;
      }
      db.prepare("INSERT OR REPLACE INTO model_game_evals (game_id, depth, json) VALUES (?, ?, ?)").run(
        id,
        EVAL_DEPTH,
        JSON.stringify(job.evals)
      );
      evalJobs.delete(id);
    })().catch(() => evalJobs.delete(id));
  }
  return { status: "pending", done: job.done, total: job.total, evals: job.evals };
}
