/**
 * Model games: real captured daily/history games, daily selection, history
 * grouping and review state. Evals are only reported when the capture contains
 * them; there is no synthetic +0.3 line.
 */
import { randomInt } from "node:crypto";
import { epdOf, lineSans } from "./positions.js";
import { nowIso } from "./dates.js";
import { reviewGame as engineReviewPositions, status as engineStatus } from "./engine.js";

const resultLabel = (result) =>
  result === "white" ? "White won" : result === "black" ? "Black won" : result === "draw" ? "Draw" : "Result unavailable";

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

const GAME_SELECT = `
  SELECT g.*,
         d.external_id, d.source AS data_source, d.link, d.event_name, d.played_at,
         d.captured_at, d.year AS data_year, d.player_white, d.player_black, d.white_elo,
         d.black_elo, d.white_title, d.black_title, d.result AS data_result,
         d.reviewed AS data_reviewed, d.performances, d.epds, d.evals,
         d.annotations, d.is_daily, d.daily_date, d.source_file
  FROM model_games g
  LEFT JOIN model_game_data d ON d.game_id = g.id`;

export function gameRow(db, id) {
  return db.prepare(`${GAME_SELECT} WHERE g.id = ?`).get(Number(id));
}

export function gameRows(db) {
  return db.prepare(`${GAME_SELECT} ORDER BY g.id`).all();
}

function playerNames(row) {
  const white = row.player_white || row.white || "White";
  const black = row.player_black || row.black || "Black";
  const last = (name) => String(name).split(",")[0].trim();
  return {
    white,
    black,
    whiteShort: last(white),
    blackShort: last(black),
    whiteElo: row.white_elo ?? null,
    blackElo: row.black_elo ?? null,
    whiteTitle: row.white_title ?? null,
    blackTitle: row.black_title ?? null,
  };
}

export function progressFor(db, gameId, userId) {
  const row = db
    .prepare("SELECT * FROM model_progress WHERE user_id = ? AND game_id = ?")
    .get(userId, gameId);
  const total = db
    .prepare("SELECT COUNT(*) AS n FROM model_game_moves WHERE game_id = ?")
    .get(gameId).n;
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

export function gameSummary(db, row, userId) {
  if (!row) return null;
  const names = playerNames(row);
  const progress = progressFor(db, row.id, userId);
  return {
    id: row.id,
    externalId: row.external_id ?? null,
    white: names.whiteShort,
    black: names.blackShort,
    whiteFullName: names.white,
    blackFullName: names.black,
    event: row.event_name || row.event,
    eventName: row.event_name || row.event,
    year: row.data_year || row.year || null,
    playedAt: row.played_at ?? row.captured_at ?? null,
    capturedAt: row.captured_at ?? null,
    link: row.link ?? null,
    linkAvailable: Boolean(row.link),
    result: row.result || null,
    resultTag: row.result || null,
    outcome: row.data_result ?? null,
    resultLabel: resultLabel(row.data_result || row.result),
    pgn: row.pgn,
    description: row.description,
    source: row.data_source || row.source_file || null,
    daily: Boolean(row.is_daily),
    reviewed: progress.reviewed || Boolean(row.data_reviewed),
    progress: progress.ply,
    progressState: progress,
    players: {
      white: {
        name: names.white,
        shortName: names.whiteShort,
        elo: names.whiteElo,
        title: names.whiteTitle,
      },
      black: {
        name: names.black,
        shortName: names.blackShort,
        elo: names.blackElo,
        title: names.blackTitle,
      },
    },
  };
}

export function gameDetail(db, row, userId, { repertoires = null } = {}) {
  if (!row) return null;
  const summary = gameSummary(db, row, userId);
  const moves = db
    .prepare("SELECT * FROM model_game_moves WHERE game_id = ? ORDER BY ply")
    .all(row.id)
    .map((move) => ({
      ply: move.ply,
      moveNumber: Math.floor((move.ply - 1) / 2) + 1,
      side: move.ply % 2 === 1 ? "white" : "black",
      san: move.san,
      epdBefore: move.epd_before,
      epdAfter: move.epd_after,
      fenBefore: move.epd_before ? `${move.epd_before} 0 1` : null,
      fenAfter: move.epd_after ? `${move.epd_after} 0 1` : null,
      evalBefore: move.eval_before,
      evalAfter: move.eval_after,
      evalCp: move.eval_after,
      evalPawn:
        move.eval_after == null ? null : Math.round((move.eval_after / 100) * 100) / 100,
      evalAvailable: move.eval_after != null,
    }));

  const storedEvals = parseJson(row.evals, []);
  const evalSamples = storedEvals.map((value, index) => {
    const cp = value == null ? null : Number(value);
    return {
      ply: index,
      epd: index === 0 ? moves[0]?.epdBefore ?? null : moves[index - 1]?.epdAfter ?? null,
      evalCp: Number.isFinite(cp) ? cp : null,
      evalPawn: Number.isFinite(cp) ? Math.round((cp / 100) * 100) / 100 : null,
      available: Number.isFinite(cp),
    };
  });

  const performances = parseJson(row.performances, {});
  const rawAnnotations = parseJson(row.annotations, {});
  const annotations = Array.isArray(rawAnnotations)
    ? rawAnnotations
    : Object.entries(rawAnnotations || {}).map(([key, value]) => ({
        key,
        ...(typeof value === "object" ? value : { text: String(value) }),
      }));

  const opening = openingMatch(db, moves, repertoires);
  const engineAvailable = engineStatus().available;
  return {
    ...summary,
    performances,
    analysis: {
      available: Object.keys(performances || {}).length > 0,
      source: "captured",
      engineReviewAvailable: engineAvailable,
      engineReviewSource: "stockfish",
      engineReviewReason: engineAvailable
        ? null
        : "Stockfish could not be found; the captured eval graph is still shown as historical data.",
      performances,
    },
    annotations,
    annotationsAvailable: annotations.length > 0,
    moves,
    moveCount: moves.length,
    evalSamples,
    evalGraph: {
      available: evalSamples.some((sample) => sample.available),
      source: "captured",
      samples: evalSamples,
      mateSupported: false,
    },
    openingMatch: opening,
    review: {
      reviewed: summary.progressState.reviewed,
      score: summary.progressState.score,
      reviewedAt: summary.progressState.reviewedAt,
    },
  };
}

function openingMatch(db, moves, repertoires) {
  const sans = moves.map((move) => move.san);
  const reps =
    repertoires ||
    db.prepare("SELECT * FROM repertoires ORDER BY id").all();
  let best = null;
  for (const repertoire of reps) {
    const lines = db
      .prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id")
      .all(repertoire.id);
    for (const line of lines) {
      const lineMoves = lineSans(line);
      let matched = 0;
      while (
        matched < lineMoves.length &&
        matched < sans.length &&
        lineMoves[matched] === sans[matched]
      ) {
        matched += 1;
      }
      if (matched < 3) continue;
      if (!best || matched > best.matchedPlies) {
        best = {
          lineId: line.id,
          lineName: line.name,
          repertoireId: repertoire.id,
          repertoireName: repertoire.name,
          repertoireColor: repertoire.color,
          moves: lineMoves,
          matchedPlies: matched,
          matchedPercent: Math.round((matched / Math.max(1, sans.length)) * 1000) / 10,
          openingId: line.opening_id ?? null,
        };
      }
    }
  }

  const guides = db.prepare("SELECT * FROM opening_guides ORDER BY sort_order").all();
  let guideMatch = null;
  for (const guide of guides) {
    const guideSans = String(guide.sans || "").split(" ").filter(Boolean);
    if (!guideSans.length) continue;
    if (guideSans.every((san, index) => sans[index] === san)) {
      if (!guideMatch || guideSans.length > guideMatch.matchedPlies) {
        guideMatch = {
          slug: guide.slug,
          name: guide.name,
          eco: guide.eco,
          matchedPlies: guideSans.length,
          moves: guideSans,
        };
      }
    }
  }

  return {
    available: Boolean(best || guideMatch),
    line: best,
    guide: guideMatch,
  };
}

/* ------------------------------------------------------------------ daily --- */

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dayNumber(date) {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : 0;
}

export function dailyGame(db, userId, { date = today(), forceNewGame = false, newGame = false, random = false } = {}) {
  const games = gameRows(db);
  if (!games.length) return { game: null, daily: null };
  const selected = forceNewGame || newGame;

  if (random) {
    const game = games[randomInt(0, games.length)];
    return {
      game: gameDetail(db, game, userId),
      daily: { date, gameId: game.id, selection: "random", forceNew: false },
    };
  }

  const stored = db
    .prepare("SELECT * FROM model_daily_selection WHERE date = ?")
    .get(date);
  // The captured daily game is the default selection. `force_new_game` rotates
  // through the real history; dates only key the persisted choice.
  const deterministic =
    games.find((row) => row.is_daily) || games[dayNumber(date) % games.length];

  let game = stored ? games.find((row) => row.id === stored.game_id) : null;
  let selection = stored ? "stored" : "date";
  if (!game) {
    game = deterministic;
    selection = "date";
  }

  if (selected) {
    const index = games.findIndex((row) => row.id === game.id);
    const next = games[(index + 1) % games.length];
    // `force_new_game` must return a different game even when two calls happen
    // within the same request boundary.
    game = next.id === game.id ? games[(index + 1) % games.length] : next;
    if (games.length > 1 && game.id === (stored?.game_id ?? -1)) {
      game = games[(index + 2) % games.length];
    }
    selection = "forced";
  }

  db.prepare(
    `INSERT INTO model_daily_selection (date, game_id, force_new, selected_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       game_id = excluded.game_id,
       force_new = excluded.force_new,
       selected_at = excluded.selected_at`
  ).run(date, game.id, selected ? 1 : Number(stored?.force_new || 0), nowIso());

  return {
    game: gameDetail(db, game, userId),
    daily: {
      date,
      gameId: game.id,
      selection,
      forceNew: Boolean(selected),
    },
  };
}

export function randomGame(db, userId, { exclude = null } = {}) {
  const games = gameRows(db);
  if (!games.length) return null;
  const pool = games.length > 1 && exclude != null
    ? games.filter((row) => row.id !== Number(exclude))
    : games;
  const game = pool[randomInt(0, pool.length)];
  return gameDetail(db, game, userId);
}

export function nextGame(db, userId, { after = null } = {}) {
  const games = gameRows(db);
  if (!games.length) return null;
  const index = games.findIndex((row) => row.id === Number(after));
  const game = games[(index + 1 + games.length) % games.length];
  return gameDetail(db, game, userId);
}

/* ---------------------------------------------------------------- history --- */

function weekStart(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const day = (parsed.getUTCDay() + 6) % 7; // Monday = 0
  parsed.setUTCDate(parsed.getUTCDate() - day);
  return parsed.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function history(db, userId, { groupBy = "week", includeDaily = true } = {}) {
  let rows = gameRows(db);
  if (!includeDaily) rows = rows.filter((row) => !row.is_daily);

  const games = rows
    .map((row) => ({
      ...gameSummary(db, row, userId),
      _date:
        String(row.played_at || row.daily_date || row.captured_at || "").slice(0, 10) ||
        null,
      _createdAt: row.imported_at || null,
    }))
    .sort((a, b) =>
      String(b._date || "").localeCompare(String(a._date || "")) || b.id - a.id
    );

  const groups = new Map();
  for (const game of games) {
    const date = game._date || null;
    const start = date ? weekStart(date) : null;
    const key = groupBy === "week" ? start : date;
    if (!groups.has(key)) {
      groups.set(key, {
        weekStart: start,
        weekEnd: start ? addDays(start, 6) : null,
        label: start ? `Week of ${start}` : "Undated",
        games: [],
      });
    }
    groups.get(key).games.push(game);
  }

  return {
    groupBy,
    total: games.length,
    games,
    weeks: [...groups.values()].sort((a, b) =>
      String(b.weekStart || "").localeCompare(String(a.weekStart || ""))
    ),
  };
}

/* ----------------------------------------------------------------- review --- */

/**
 * Stockfish review for a model game (D102/D203).
 *
 * The captured `evals` array remains the historical graph. This produces a
 * fresh, per-move engine review: real evaluations, the engine's best move and
 * inaccuracy/mistake/blunder classifications. Payloads are cached per game and
 * depth in SQLite so reopening a game is instant.
 */
export async function engineReview(
  db,
  gameRowValue,
  { depth = Math.min(10, Number(process.env.CHESSBOOK_ENGINE_DEPTH) || 10), force = false } = {}
) {
  if (!gameRowValue) return null;
  const gameId = Number(gameRowValue.id);
  const safeDepth = Math.max(4, Math.min(20, Number(depth) || 10));
  if (!force) {
    const cached = db
      .prepare("SELECT * FROM model_game_reviews WHERE game_id = ? AND depth = ?")
      .get(gameId, safeDepth);
    if (cached) {
      try {
        return { ...JSON.parse(cached.payload), cached: true };
      } catch {
        // Fall through and recompute a corrupt cache entry.
      }
    }
  }

  const moves = db
    .prepare("SELECT * FROM model_game_moves WHERE game_id = ? ORDER BY ply")
    .all(gameId);
  if (!moves.length) {
    return {
      available: false,
      reason: "no_moves",
      gameId,
      source: "stockfish",
      engine: { name: "Stockfish 19 Lite WASM", version: "19" },
    };
  }
  const fens = moves
    .map((move) => (move.epd_before ? `${move.epd_before} 0 1` : null))
    .filter(Boolean);
  const last = moves[moves.length - 1];
  if (last.epd_after) fens.push(`${last.epd_after} 0 1`);

  const review = await engineReviewPositions(fens, {
    depth: safeDepth,
    plies: moves.map((move) => move.san),
  });
  const payload = {
    ...review,
    gameId,
    depth: safeDepth,
    capturedEvalGraph: {
      source: "captured",
      note: "The stored eval samples are historical production data and are not replaced by this review.",
    },
  };
  if (review.available) {
    db.prepare(
      `INSERT INTO model_game_reviews (game_id, depth, engine, payload, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(game_id, depth) DO UPDATE SET
         engine = excluded.engine,
         payload = excluded.payload,
         created_at = excluded.created_at`
    ).run(
      gameId,
      safeDepth,
      review.engine?.id ?? "stockfish",
      JSON.stringify(payload),
      nowIso()
    );
  }
  return payload;
}

export function markReviewed(db, userId, gameId, { reviewed = true, score = null } = {}) {
  const row = db
    .prepare("SELECT * FROM model_progress WHERE user_id = ? AND game_id = ?")
    .get(userId, gameId);
  const total = db
    .prepare("SELECT COUNT(*) AS n FROM model_game_moves WHERE game_id = ?")
    .get(gameId).n;
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO model_progress
       (user_id, game_id, ply, completed, reviewed, score, completed_at, reviewed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, game_id) DO UPDATE SET
       reviewed = excluded.reviewed,
       score = COALESCE(excluded.score, model_progress.score),
       reviewed_at = CASE WHEN excluded.reviewed = 1 THEN excluded.reviewed_at ELSE model_progress.reviewed_at END,
       updated_at = excluded.updated_at`
  ).run(
    userId,
    gameId,
    row?.ply ?? 0,
    row?.completed ?? 0,
    reviewed ? 1 : 0,
    score == null ? null : Math.max(0, Math.min(100, Number(score))),
    row?.completed_at ?? null,
    reviewed ? stamp : null,
    stamp
  );
  return progressFor(db, gameId, userId);
}

export { resultLabel, epdOf };
