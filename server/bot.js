import { Chess } from "chess.js";

/**
 * Deterministic local chess engine used by the training-game bot, the puzzle
 * verifier and the game review.
 *
 * There is no Stockfish binary in this local-first build. This module is an
 * honest, dependency-free alternative: material + piece-square evaluation with
 * a shallow alpha-beta search. It is *not* presented as Stockfish anywhere; the
 * API labels it `Chessbook local heuristic` and reports its depth/node count.
 *
 * Everything here is deterministic: the same FEN, rating and seed always pick
 * the same move. Randomisation is a seeded PRNG, never Math.random.
 */

const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const MATE = 100000;

/* Piece-square tables, indexed a8 → h1 (rank 8 first). Mirrored for Black. */
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

const FILES = "abcdefgh";

function squareIndex(square, color) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  if (color === "w") return (8 - rank) * 8 + file;
  return (rank - 1) * 8 + file;
}

function pawnFiles(chess, color) {
  const counts = new Array(8).fill(0);
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece && piece.type === "p" && piece.color === color) {
        counts[FILES.indexOf(piece.square[0])] += 1;
      }
    }
  }
  return counts;
}

/**
 * Static evaluation in centipawns from White's perspective. Positive is good
 * for White. Cheap enough to call at every leaf.
 */
export function evaluatePosition(chess) {
  let score = 0;
  const bishops = { w: 0, b: 0 };
  const board = chess.board();
  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      const table = PST[piece.type];
      const value = PIECE_VALUE[piece.type];
      const pst = table[squareIndex(piece.square, piece.color)];
      const total = value + pst;
      score += piece.color === "w" ? total : -total;
      if (piece.type === "b") bishops[piece.color] += 1;
    }
  }

  // Bishop pair.
  if (bishops.w >= 2) score += 28;
  if (bishops.b >= 2) score -= 28;

  const wFiles = pawnFiles(chess, "w");
  const bFiles = pawnFiles(chess, "b");
  for (let file = 0; file < 8; file += 1) {
    if (wFiles[file] > 1) score -= (wFiles[file] - 1) * 14;
    if (bFiles[file] > 1) score += (bFiles[file] - 1) * 14;
    if (wFiles[file] > 0 && !wFiles[file - 1] && !wFiles[file + 1]) score -= 12;
    if (bFiles[file] > 0 && !bFiles[file - 1] && !bFiles[file + 1]) score += 12;
  }

  // Rooks like open and semi-open files.
  for (const row of board) {
    for (const piece of row) {
      if (!piece || piece.type !== "r") continue;
      const file = FILES.indexOf(piece.square[0]);
      const own = piece.color === "w" ? wFiles[file] : bFiles[file];
      const other = piece.color === "w" ? bFiles[file] : wFiles[file];
      const bonus = own === 0 && other === 0 ? 18 : own === 0 ? 9 : 0;
      score += piece.color === "w" ? bonus : -bonus;
    }
  }

  // A tiny tempo term keeps the search from preferring the null move.
  score += chess.turn() === "w" ? 6 : -6;
  return score;
}

export function evaluate(fen) {
  try {
    return evaluatePosition(new Chess(fen));
  } catch {
    return 0;
  }
}

function evaluateForTurn(chess) {
  const white = evaluatePosition(chess);
  return chess.turn() === "w" ? white : -white;
}

function moveOrderScore(move) {
  let score = 0;
  if (move.captured) {
    score += 1000 + (PIECE_VALUE[move.captured] || 0) - (PIECE_VALUE[move.piece] || 0) / 10;
  }
  if (move.promotion) score += 850 + (PIECE_VALUE[move.promotion] || 0);
  if (move.san.includes("+")) score += 60;
  if (move.san.includes("#")) score += 5000;
  return score;
}

function orderedMoves(chess) {
  return chess
    .moves({ verbose: true })
    .map((move) => ({ move, order: moveOrderScore(move) }))
    .sort((a, b) => b.order - a.order || a.move.san.localeCompare(b.move.san))
    .map((entry) => entry.move);
}

function negamax(chess, depth, alpha, beta, ctx, ply) {
  ctx.nodes += 1;
  if (ctx.nodes >= ctx.maxNodes) return evaluateForTurn(chess);
  if (chess.isCheckmate()) return -MATE + ply;
  if (chess.isDraw() || chess.isStalemate()) return 0;
  if (depth <= 0) return evaluateForTurn(chess);

  const moves = orderedMoves(chess);
  let best = -Infinity;
  for (const move of moves) {
    chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    const value = -negamax(chess, depth - 1, -beta, -alpha, ctx, ply + 1);
    chess.undo();
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best === -Infinity ? evaluateForTurn(chess) : best;
}

export function depthForRating(rating) {
  const value = clamp(Number(rating) || 1600, 600, 2800);
  if (value < 900) return 1;
  if (value < 1500) return 2;
  if (value < 1900) return 2;
  return 3;
}

function maxNodesForRating(rating) {
  const value = clamp(Number(rating) || 1600, 600, 2800);
  if (value < 900) return 4000;
  if (value < 1500) return 14000;
  if (value < 1900) return 28000;
  return 60000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 32-bit string hash for the deterministic PRNG seed. */
export function hashString(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32 seeded PRNG. */
export function seededRandom(seed) {
  let state = typeof seed === "number" ? seed >>> 0 : hashString(seed);
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeUci(move) {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

/**
 * Score every legal move at `fen` with a shallow minimax search.
 *
 * `moves[].score` is from the side-to-move's perspective; `whiteCp` is the
 * same score from White's perspective.
 */
export function analyzePosition(fen, { depth = 2, maxNodes = 30000, limit = null } = {}) {
  const chess = new Chess(fen);
  const side = chess.turn() === "w" ? "white" : "black";
  const legal = orderedMoves(chess);
  if (!legal.length) {
    return {
      fen,
      side,
      depth,
      nodes: 0,
      score: chess.isCheckmate() ? -MATE : 0,
      whiteCp: chess.isCheckmate() ? (side === "white" ? -MATE : MATE) : 0,
      best: null,
      moves: [],
      gameOver: true,
    };
  }
  const ctx = { nodes: 0, maxNodes };
  const scored = [];
  const wanted = limit ? Math.min(limit, legal.length) : legal.length;
  for (let i = 0; i < wanted; i += 1) {
    const move = legal[i];
    chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = -negamax(chess, Math.max(0, depth - 1), -Infinity, Infinity, ctx, 1);
    chess.undo();
    scored.push({
      san: move.san,
      uci: makeUci(move),
      from: move.from,
      to: move.to,
      promotion: move.promotion || null,
      score,
      whiteCp: side === "white" ? score : -score,
      order: moveOrderScore(move),
    });
  }
  scored.sort((a, b) => b.score - a.score || a.san.localeCompare(b.san));
  const best = scored[0] ?? null;
  return {
    fen,
    side,
    depth,
    nodes: ctx.nodes,
    score: best ? best.score : evaluateForTurn(chess),
    whiteCp: best ? best.whiteCp : side === "white" ? evaluatePosition(chess) : -evaluatePosition(chess),
    best,
    moves: scored,
    gameOver: false,
  };
}

/**
 * Pick a human-like move. Lower ratings search less deeply and add more noise
 * to the move ordering, so a 900 player misses things a 2000 player finds.
 */
export function chooseBotMove(fen, { rating = 1600, seed = "", depth = null } = {}) {
  const numericRating = clamp(Number(rating) || 1600, 600, 2800);
  const searchDepth = depth ?? depthForRating(numericRating);
  const analysis = analyzePosition(fen, {
    depth: searchDepth,
    maxNodes: maxNodesForRating(numericRating),
  });
  const legal = new Chess(fen).moves({ verbose: true });
  if (!legal.length) {
    return {
      san: null,
      uci: null,
      from: null,
      to: null,
      promotion: null,
      score: analysis.score,
      whiteCp: analysis.whiteCp,
      depth: searchDepth,
      nodes: analysis.nodes,
      rating: numericRating,
      candidates: [],
      gameOver: true,
      engine: "Chessbook local heuristic",
    };
  }

  // Randomisation shrinks as the rating rises. The pool is the top few moves;
  // a weak bot can pick a materially worse move and a strong one plays best.
  const sigma = Math.max(10, (1950 - numericRating) * 0.19);
  const poolSize = numericRating < 900 ? 6 : numericRating < 1300 ? 5 : numericRating < 1800 ? 4 : 3;
  const pool = analysis.moves.slice(0, poolSize);
  const rng = seededRandom(`${seed}|${fen}|${numericRating}`);
  let chosen = pool[0] ?? analysis.best;
  let bestNoisy = -Infinity;
  for (const move of pool) {
    const noisy = move.score + (rng() * 2 - 1) * sigma;
    if (noisy > bestNoisy) {
      bestNoisy = noisy;
      chosen = move;
    }
  }
  return {
    san: chosen?.san ?? legal[0].san,
    uci: chosen?.uci ?? makeUci(legal[0]),
    from: chosen?.from ?? legal[0].from,
    to: chosen?.to ?? legal[0].to,
    promotion: chosen?.promotion ?? legal[0].promotion ?? null,
    score: chosen?.score ?? analysis.score,
    whiteCp: chosen?.whiteCp ?? analysis.whiteCp,
    bestSan: analysis.best?.san ?? null,
    depth: searchDepth,
    nodes: analysis.nodes,
    rating: numericRating,
    candidates: pool.map((move) => ({
      san: move.san,
      uci: move.uci,
      from: move.from,
      to: move.to,
      score: Math.round(move.score),
      whiteCp: Math.round(move.whiteCp),
    })),
    gameOver: false,
    engine: "Chessbook local heuristic",
  };
}

/* --------------------------------------------------------------- review --- */

export function classifyLoss(cpLoss) {
  if (cpLoss >= 300) return "blunder";
  if (cpLoss >= 150) return "mistake";
  if (cpLoss >= 60) return "inaccuracy";
  if (cpLoss <= 15) return "best";
  return "good";
}

/** Lichess-style per-move accuracy from centipawn loss. */
export function accuracyFromLoss(cpLoss) {
  const loss = Math.max(0, Number(cpLoss) || 0);
  const accuracy = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
  return Math.round(clamp(accuracy, 0, 100) * 10) / 10;
}

/**
 * Simple local game review. Every player move is compared against the best
 * move this heuristic engine can find at the same depth; the resulting
 * centipawn loss drives accuracy and the blunder/mistake/inaccuracy counts.
 *
 * `playerColor` is the side being reviewed. All moves are still returned so a
 * result screen can show the opponent's choices too.
 */
export function reviewGame({
  sans,
  playerColor = "white",
  depth = 1,
  maxNodes = 16000,
  startFen = null,
}) {
  const moves = Array.isArray(sans) ? sans.filter(Boolean) : [];
  const chess = new Chess(startFen || undefined);
  const history = [];
  const samples = [{ ply: 0, evalCp: evaluatePosition(chess) }];
  let playerMoves = 0;
  let opponentMoves = 0;
  let accuracySum = 0;
  let cpLossSum = 0;
  let blunders = 0;
  let mistakes = 0;
  let inaccuracies = 0;
  let bestMoves = 0;

  for (let index = 0; index < moves.length; index += 1) {
    const san = moves[index];
    const beforeFen = chess.fen();
    const side = chess.turn() === "w" ? "white" : "black";
    let analysis;
    try {
      analysis = analyzePosition(beforeFen, { depth, maxNodes });
    } catch {
      break;
    }
    let move;
    try {
      move = chess.move(san);
    } catch {
      break;
    }
    const played = analysis.moves.find((entry) => entry.san === move.san) ?? null;
    const bestScore = analysis.best?.score ?? analysis.score;
    const playedScore =
      played?.score ?? (chess.turn() === "w" ? evaluatePosition(chess) : -evaluatePosition(chess));
    const cpLoss = Math.max(0, Math.round(bestScore - playedScore));
    const classification = classifyLoss(cpLoss);
    const accuracy = accuracyFromLoss(cpLoss);
    const isPlayer = side === playerColor;
    if (isPlayer) {
      playerMoves += 1;
      accuracySum += accuracy;
      cpLossSum += cpLoss;
      if (classification === "blunder") blunders += 1;
      else if (classification === "mistake") mistakes += 1;
      else if (classification === "inaccuracy") inaccuracies += 1;
      if (classification === "best") bestMoves += 1;
    } else {
      opponentMoves += 1;
    }
    history.push({
      ply: index + 1,
      moveNumber: Math.floor(index / 2) + 1,
      side,
      san: move.san,
      from: move.from,
      to: move.to,
      bestSan: analysis.best?.san ?? null,
      bestFrom: analysis.best?.from ?? null,
      bestTo: analysis.best?.to ?? null,
      cpLoss,
      accuracy,
      classification,
      evalCp: evaluatePosition(chess),
      byPlayer: isPlayer,
    });
    samples.push({ ply: index + 1, evalCp: history[history.length - 1].evalCp });
  }

  const accuracy = playerMoves ? Math.round((accuracySum / playerMoves) * 10) / 10 : 0;
  const averageCpLoss = playerMoves ? Math.round(cpLossSum / playerMoves) : 0;
  const headline =
    playerMoves === 0
      ? "No player moves to review."
      : `${playerMoves} move${playerMoves === 1 ? "" : "s"} reviewed at ${accuracy}% accuracy.`;
  const summary =
    blunders + mistakes + inaccuracies === 0
      ? "No blunders, mistakes or inaccuracies were found at this search depth."
      : `${blunders} blunder${blunders === 1 ? "" : "s"}, ${mistakes} mistake${
          mistakes === 1 ? "" : "s"
        }, ${inaccuracies} inaccurac${inaccuracies === 1 ? "y" : "ies"}.`;

  return {
    available: playerMoves > 0,
    engine: {
      name: "Chessbook local heuristic",
      depth,
      maxNodes,
      stockfish: false,
      note: "No Stockfish binary is bundled with the local-first build; this review uses a deterministic material + piece-square search.",
    },
    playerColor,
    playerMoves,
    opponentMoves,
    accuracy,
    averageCpLoss,
    blunders,
    mistakes,
    inaccuracies,
    bestMoves,
    headline,
    summary,
    moves: history,
    samples,
  };
}
