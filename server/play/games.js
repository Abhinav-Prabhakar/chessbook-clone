import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import { chooseBotMove, reviewGame } from "../bot.js";
import { findLegalMove, pgnFromSans } from "../positions.js";
import {
  db,
  nowIso,
  clamp,
  profileFor,
  recordProfileResult,
  recentAttempts,
} from "./db.js";

export const gamesRouter = Router();

export const TIME_CONTROLS = [
  { id: "1+0", label: "Bullet 1+0", initialMs: 60_000, incrementMs: 0 },
  { id: "3+0", label: "Blitz 3+0", initialMs: 180_000, incrementMs: 0 },
  { id: "3+2", label: "Blitz 3+2", initialMs: 180_000, incrementMs: 2_000 },
  { id: "5+3", label: "Blitz 5+3", initialMs: 300_000, incrementMs: 3_000 },
  { id: "10+0", label: "Rapid 10+0", initialMs: 600_000, incrementMs: 0 },
  { id: "10+5", label: "Rapid 10+5", initialMs: 600_000, incrementMs: 5_000 },
  { id: "15+10", label: "Classical 15+10", initialMs: 900_000, incrementMs: 10_000 },
];

export const BOT_RATINGS = [600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600];

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function timeControlFor(id) {
  return TIME_CONTROLS.find((tc) => tc.id === id) ?? TIME_CONTROLS.find((tc) => tc.id === "3+2");
}

function resultLabel(outcome, reason, playerColor) {
  const side = playerColor === "white" ? "White" : "Black";
  const other = playerColor === "white" ? "Black" : "White";
  if (outcome === "draw") {
    if (reason === "stalemate") return "Draw by stalemate";
    if (reason === "insufficient-material") return "Draw by insufficient material";
    if (reason === "fifty-move") return "Draw by the fifty-move rule";
    if (reason === "threefold") return "Draw by threefold repetition";
    return "Draw";
  }
  const won = outcome === "win";
  if (reason === "checkmate") return won ? "You won by checkmate" : "You lost by checkmate";
  if (reason === "resignation") return won ? `${side} won by resignation` : "You resigned";
  if (reason === "timeout") return won ? `${other} ran out of time` : "You ran out of time";
  return won ? `${side} won` : `${side} lost`;
}

function isDrawReason(reason) {
  return ["stalemate", "insufficient-material", "threefold", "fifty-move", "draw"].includes(reason);
}

function gameOverReason(chess) {
  if (chess.isCheckmate()) return "checkmate";
  if (chess.isStalemate()) return "stalemate";
  if (chess.isInsufficientMaterial()) return "insufficient-material";
  if (chess.isThreefoldRepetition()) return "threefold";
  if (chess.isDrawByFiftyMoves()) return "fifty-move";
  if (chess.isDraw()) return "draw";
  return null;
}

export function gameState(row, { includeLegal = true } = {}) {
  const moves = parseJson(row.moves_json, []);
  let chess;
  try {
    chess = new Chess(row.fen);
  } catch {
    chess = new Chess();
  }
  const finished = row.status !== "active";
  const result = row.result
    ? {
        outcome: row.result,
        reason: row.result_reason,
        label: resultLabel(row.result, row.result_reason, row.player_color),
      }
    : null;
  return {
    id: row.uuid,
    playerColor: row.player_color,
    botRating: Number(row.rating),
    timeControl: row.time_control,
    startFen: row.start_fen,
    fen: row.fen,
    turn: chess.turn() === "w" ? "white" : "black",
    sideToMove: chess.turn() === "w" ? "white" : "black",
    check: chess.inCheck(),
    status: row.status,
    finished,
    result,
    moves,
    moveCount: moves.length,
    pgn: pgnFromSans(moves.map((move) => move.san)),
    lastMove: moves.length ? moves[moves.length - 1] : null,
    clock: {
      whiteMs: Number(row.white_ms),
      blackMs: Number(row.black_ms),
      turn: chess.turn() === "w" ? "white" : "black",
      initialMs: Number(row.initial_ms),
      incrementMs: Number(row.increment_ms),
      updatedAt: row.turn_started_at,
    },
    legalMoves: finished || !includeLegal ? [] : chess.moves(),
    review: parseJson(row.review_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    reviewAvailable: finished,
    engine: "Chessbook local heuristic",
  };
}

function gameRow(userId, id) {
  return db
    .prepare("SELECT * FROM play_games WHERE uuid = ? AND user_id = ?")
    .get(String(id), userId);
}

function saveGame(row, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const assignments = keys.map((key) => `${key} = ?`).join(", ");
  db.prepare(`UPDATE play_games SET ${assignments}, updated_at = ? WHERE id = ?`).run(
    ...keys.map((key) => patch[key]),
    nowIso(),
    row.id
  );
}

function finishGame(row, outcome, reason) {
  const stamp = nowIso();
  saveGame(row, {
    status: "finished",
    result: outcome,
    result_reason: reason,
    finished_at: stamp,
  });
  const profile = recordProfileResult(row.user_id, "training", {
    score: outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0,
    opponentRating: Number(row.rating),
    k: 32,
    gamesDelta: 1,
    perfect: outcome === "win",
    data: {
      lastGameId: row.uuid,
      lastOutcome: outcome,
      lastReason: reason,
      lastBotRating: Number(row.rating),
      lastTimeControl: row.time_control,
      lastPlayedAt: stamp,
    },
    attempt: {
      itemKey: row.uuid,
      detail: {
        outcome,
        reason,
        botRating: Number(row.rating),
        timeControl: row.time_control,
      },
    },
  });
  return profile;
}

function appendMove(state, move, by, clock) {
  const entry = {
    ply: state.moves.length + 1,
    moveNumber: move.moveNumber,
    side: move.side,
    san: move.san,
    uci: move.uci,
    from: move.from,
    to: move.to,
    promotion: move.promotion || null,
    fenAfter: move.fenAfter,
    by,
    clockMs: { white: clock.whiteMs, black: clock.blackMs },
  };
  return [...state.moves, entry];
}

function botMoveFor(row, state) {
  return chooseBotMove(state.fen, {
    rating: Number(row.rating),
    seed: `${row.uuid}|${state.moves.length}|${state.fen}`,
  });
}

function applyBotMove(row, state, botSpendMs = null) {
  const bot = botMoveFor(row, state);
  if (!bot.san) return { row, state, botMove: null, finished: false };
  const clock = {
    whiteMs: Number(row.white_ms),
    blackMs: Number(row.black_ms),
  };
  const botColor = row.player_color === "white" ? "black" : "white";
  const spend =
    botSpendMs == null
      ? botThinkTime(row.rating, state.moves.length, row.uuid)
      : botSpendMs;
  const key = botColor === "white" ? "whiteMs" : "blackMs";
  clock[key] = Math.max(0, clock[key] - spend);
  if (botColor === "white") clock.whiteMs += Number(row.increment_ms);
  else clock.blackMs += Number(row.increment_ms);
  if (clock[key] <= 0) {
    const playerOutcome = "win";
    finishGame(row, playerOutcome, "timeout");
    return {
      row: gameRow(row.user_id, row.uuid),
      state: gameState(gameRow(row.user_id, row.uuid)),
      botMove: null,
      finished: true,
      timeoutWinner: row.player_color,
    };
  }

  const chess = new Chess(state.fen);
  const before = chess.moveNumber();
  const move = chess.move(bot.san);
  const moves = appendMove(
    state,
    {
      moveNumber: before,
      side: botColor,
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion || ""}`,
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      fenAfter: chess.fen(),
    },
    "bot",
    clock
  );
  const stamp = nowIso();
  saveGame(row, {
    fen: chess.fen(),
    moves_json: JSON.stringify(moves),
    white_ms: clock.whiteMs,
    black_ms: clock.blackMs,
    turn_started_at: stamp,
  });
  const nextRow = gameRow(row.user_id, row.uuid);
  const reason = gameOverReason(chess);
  if (reason) {
    const outcome = isDrawReason(reason)
      ? "draw"
      : chess.isCheckmate()
        ? botColor === row.player_color
          ? "win"
          : "loss"
        : "draw";
    finishGame(nextRow, outcome, reason);
    return {
      row: gameRow(row.user_id, row.uuid),
      state: gameState(gameRow(row.user_id, row.uuid)),
      botMove: { ...bot, move: moves[moves.length - 1] },
      finished: true,
    };
  }
  return {
    row: nextRow,
    state: gameState(nextRow),
    botMove: { ...bot, move: moves[moves.length - 1] },
    finished: false,
  };
}

/** Deterministic human-ish thinking time for the bot clock, in ms. */
function botThinkTime(rating, ply, seed) {
  const base = clamp(1800 - (Number(rating) - 600) * 0.55, 250, 1800);
  const jitter = (ply * 137) % 400;
  return Math.round(base + jitter);
}

gamesRouter.get("/options", (req, res) => {
  const profile = profileFor(req.user.id, "training");
  const recent = db
    .prepare(
      `SELECT uuid, rating, time_control, player_color, status, result, result_reason,
              moves_json, created_at, finished_at
       FROM play_games WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 8`
    )
    .all(req.user.id)
    .map((row) => ({
      id: row.uuid,
      botRating: Number(row.rating),
      timeControl: row.time_control,
      playerColor: row.player_color,
      status: row.status,
      result: row.result,
      resultReason: row.result_reason,
      moveCount: parseJson(row.moves_json, []).length,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    }));
  res.json({
    bots: BOT_RATINGS,
    timeControls: TIME_CONTROLS,
    sides: ["white", "black", "random"],
    defaultRating: profile.rating,
    defaultTimeControl: "3+2",
    profile,
    recent,
    engine: {
      name: "Chessbook local heuristic",
      stockfish: false,
      note: "The local bot searches material + piece-square values and scales its depth and randomness with the selected rating.",
    },
  });
});

gamesRouter.post("/", (req, res) => {
  const body = req.body || {};
  const userId = req.user.id;
  const tc = timeControlFor(String(body.timeControl || body.tc || "3+2"));
  const rating = Math.round(clamp(Number(body.rating) || 1600, 600, 2800));
  const requestedFen = body.fen ? String(body.fen).trim() : null;
  let startFen = new Chess().fen();
  if (requestedFen) {
    try {
      startFen = new Chess(requestedFen).fen();
    } catch {
      return res.status(400).json({ error: "That FEN is not a valid position", code: "invalid_fen" });
    }
  }
  const startChess = new Chess(startFen);
  if (startChess.isGameOver()) {
    return res
      .status(400)
      .json({ error: "That position is already over", code: "position_finished" });
  }
  const turn = startChess.turn() === "w" ? "white" : "black";
  let side = String(body.side || body.color || "").toLowerCase();
  if (!["white", "black", "random"].includes(side)) side = turn;
  if (side === "random") side = Math.random() < 0.5 ? "white" : "black";
  const playerColor = side;

  const uuid = randomUUID();
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO play_games
      (uuid, user_id, rating, time_control, initial_ms, increment_ms, player_color,
       start_fen, fen, moves_json, status, white_ms, black_ms, turn_started_at,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'active', ?, ?, ?, ?, ?)`
  ).run(
    uuid,
    userId,
    rating,
    tc.id,
    tc.initialMs,
    tc.incrementMs,
    playerColor,
    startFen,
    startFen,
    tc.initialMs,
    tc.initialMs,
    stamp,
    stamp,
    stamp
  );

  let row = gameRow(userId, uuid);
  let state = gameState(row);
  let botMove = null;
  if (state.turn !== playerColor) {
    // The bot opens. Its first move does not consume clock time; the player's
    // clock starts when the bot's move arrives.
    const applied = applyBotMove(row, state, 0);
    row = applied.row;
    state = applied.state;
    botMove = applied.botMove;
  }
  res.status(201).json({
    game: state,
    botMove,
    player: profileFor(userId, "training"),
    setup: {
      rating,
      timeControl: tc,
      side: playerColor,
      startFen,
      customPosition: Boolean(requestedFen),
      from: body.from ? String(body.from).slice(0, 120) : null,
    },
  });
});

gamesRouter.get("/", (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
  const rows = db
    .prepare(
      `SELECT * FROM play_games WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(req.user.id, limit);
  res.json({
    games: rows.map((row) => {
      const state = gameState(row, { includeLegal: false });
      return {
        id: state.id,
        botRating: state.botRating,
        playerColor: state.playerColor,
        timeControl: state.timeControl,
        status: state.status,
        result: state.result,
        moveCount: state.moveCount,
        createdAt: state.createdAt,
        finishedAt: state.finishedAt,
        customPosition: state.startFen !== new Chess().fen(),
      };
    }),
    profile: profileFor(req.user.id, "training"),
    recentAttempts: recentAttempts(req.user.id, "training", 6),
  });
});

gamesRouter.get("/:id", (req, res) => {
  const row = gameRow(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Game not found" });
  res.json({ game: gameState(row), profile: profileFor(req.user.id, "training") });
});

gamesRouter.post("/:id/moves", (req, res) => {
  const row = gameRow(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Game not found" });
  if (row.status !== "active") {
    return res.status(409).json({ error: "This game is already over", code: "game_finished", game: gameState(row) });
  }
  const state = gameState(row);
  if (state.turn !== row.player_color) {
    return res
      .status(409)
      .json({ error: "It is the bot's turn", code: "not_your_turn", game: state });
  }
  const body = req.body || {};
  const sanInput = body.san || (body.from && body.to ? `${body.from}${body.to}${body.promotion || ""}` : "");
  const legal = findLegalMove(state.fen, sanInput);
  if (!legal) {
    return res.status(422).json({
      error: `Illegal move ${sanInput || "(empty)"} in this position`,
      code: "illegal_move",
      legalMoves: state.legalMoves,
      fen: state.fen,
      turn: state.turn,
    });
  }

  const color = row.player_color;
  const clock = {
    whiteMs: Number(row.white_ms),
    blackMs: Number(row.black_ms),
  };
  const key = color === "white" ? "whiteMs" : "blackMs";
  const started = Date.parse(row.turn_started_at) || Date.now();
  const serverSpent = Math.max(0, Date.now() - started);
  const clientSpent = Number(body.timeSpentMs);
  const spent = Number.isFinite(clientSpent)
    ? clamp(clientSpent, 0, Math.min(clock[key], serverSpent + 400))
    : Math.min(clock[key], serverSpent);
  clock[key] = Math.max(0, clock[key] - spent);
  if (clock[key] <= 0) {
    finishGame(row, "loss", "timeout");
    const timedOut = gameRow(req.user.id, row.uuid);
    return res.status(200).json({
      game: gameState(timedOut),
      move: null,
      botMove: null,
      timedOut: true,
      profile: profileFor(req.user.id, "training"),
    });
  }
  clock[key] += Number(row.increment_ms);

  const chess = new Chess(state.fen);
  const before = chess.moveNumber();
  const move = chess.move({ from: legal.from, to: legal.to, promotion: legal.promotion });
  const stamp = nowIso();
  const moves = appendMove(
    state,
    {
      moveNumber: before,
      side: color,
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion || ""}`,
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      fenAfter: chess.fen(),
    },
    "player",
    clock
  );
  saveGame(row, {
    fen: chess.fen(),
    moves_json: JSON.stringify(moves),
    white_ms: clock.whiteMs,
    black_ms: clock.blackMs,
    turn_started_at: stamp,
  });
  let nextRow = gameRow(req.user.id, row.uuid);
  const reason = gameOverReason(chess);
  if (reason) {
    const outcome = isDrawReason(reason)
      ? "draw"
      : chess.isCheckmate() && color === row.player_color
        ? "win"
        : "loss";
    finishGame(nextRow, outcome, reason);
    return res.json({
      game: gameState(gameRow(req.user.id, row.uuid)),
      move: moves[moves.length - 1],
      botMove: null,
      profile: profileFor(req.user.id, "training"),
    });
  }

  const applied = applyBotMove(nextRow, gameState(nextRow));
  res.json({
    game: applied.state,
    move: moves[moves.length - 1],
    botMove: applied.botMove,
    profile: profileFor(req.user.id, "training"),
  });
});

gamesRouter.post("/:id/resign", (req, res) => {
  const row = gameRow(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Game not found" });
  if (row.status !== "active") {
    return res.json({ game: gameState(row), profile: profileFor(req.user.id, "training") });
  }
  finishGame(row, "loss", "resignation");
  res.json({
    game: gameState(gameRow(req.user.id, row.uuid)),
    profile: profileFor(req.user.id, "training"),
  });
});

/**
 * Claim a flag fall. The server owns the clock: a request that arrives before
 * the reported turn actually expires is rejected (409), so a fast client cannot
 * steal a game.
 */
gamesRouter.post("/:id/flag", (req, res) => {
  const row = gameRow(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Game not found" });
  if (row.status !== "active") {
    return res.json({ game: gameState(row), profile: profileFor(req.user.id, "training") });
  }
  const state = gameState(row);
  const turn = state.turn;
  const remaining = turn === "white" ? Number(row.white_ms) : Number(row.black_ms);
  const started = Date.parse(row.turn_started_at) || Date.now();
  const elapsed = Date.now() - started;
  if (elapsed < remaining) {
    return res.status(409).json({
      error: "The clock has not expired yet",
      code: "clock_running",
      remainingMs: remaining - elapsed,
      game: state,
    });
  }
  if (turn === row.player_color) {
    finishGame(row, "loss", "timeout");
    return res.json({
      game: gameState(gameRow(req.user.id, row.uuid)),
      flagged: row.player_color,
      profile: profileFor(req.user.id, "training"),
    });
  }
  finishGame(row, "win", "timeout");
  res.json({
    game: gameState(gameRow(req.user.id, row.uuid)),
    flagged: turn,
    profile: profileFor(req.user.id, "training"),
  });
});

gamesRouter.post("/:id/review", (req, res) => {
  const row = gameRow(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: "Game not found" });
  if (row.status === "active") {
    return res.status(409).json({ error: "Finish the game before reviewing it", code: "game_active" });
  }
  const existing = parseJson(row.review_json, null);
  if (existing) return res.json({ review: existing, game: gameState(row), cached: true });
  const moves = parseJson(row.moves_json, []);
  const review = reviewGame({
    sans: moves.map((move) => move.san),
    playerColor: row.player_color,
    depth: Math.min(2, Math.max(1, Number(req.body?.depth) || 1)),
    startFen: row.start_fen,
  });
  saveGame(row, { review_json: JSON.stringify(review) });
  res.json({ review, game: gameState(gameRow(req.user.id, row.uuid)), cached: false });
});

