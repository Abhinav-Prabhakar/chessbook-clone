import { Router } from "express";
import { Chess } from "chess.js";
import { analyzePosition, classifyLoss } from "../bot.js";
import {
  fenFromEpd,
  findLegalMove,
  sanKey,
} from "../positions.js";
import {
  db,
  clamp,
  profileFor,
  recordProfileResult,
  recentAttempts,
  solvedKeys,
} from "./db.js";

export const puzzlesRouter = Router();

/** Real eval-swing threshold (centipawns) for a captured model game. */
const SWING_THRESHOLD = 60;
const analysisCache = new Map();

function cachedAnalysis(fen, depth, maxNodes) {
  const key = `${fen}|${depth}|${maxNodes}`;
  if (analysisCache.has(key)) return analysisCache.get(key);
  const result = analyzePosition(fen, { depth, maxNodes });
  analysisCache.set(key, result);
  if (analysisCache.size > 120) {
    analysisCache.delete(analysisCache.keys().next().value);
  }
  return result;
}

function moveNumberLabel(ply) {
  return `${Math.ceil(ply / 2)}${ply % 2 === 1 ? "." : "…"}`;
}

/**
 * Model-game puzzles are the real captured evaluation swings: the position is
 * the FEN before the move (`epd_before`) and the swing is `eval_before →
 * eval_after` for the side that moved. Nothing here is invented; the answer is
 * computed by the local heuristic engine when the puzzle is attempted.
 */
function modelGamePuzzles() {
  const rows = db
    .prepare(
      `SELECT m.game_id, m.ply, m.san, m.epd_before, m.eval_before, m.eval_after,
              g.white, g.black, g.event, g.result,
              d.event_name, d.is_daily
       FROM model_game_moves m
       JOIN model_games g ON g.id = m.game_id
       LEFT JOIN model_game_data d ON d.game_id = m.game_id
       WHERE m.eval_before IS NOT NULL AND m.eval_after IS NOT NULL
       ORDER BY m.game_id, m.ply`
    )
    .all();
  const puzzles = [];
  for (const row of rows) {
    const side = row.ply % 2 === 1 ? "white" : "black";
    const loss =
      side === "white"
        ? Number(row.eval_before) - Number(row.eval_after)
        : Number(row.eval_after) - Number(row.eval_before);
    if (!Number.isFinite(loss) || loss < SWING_THRESHOLD) continue;
    const fen = fenFromEpd(row.epd_before);
    if (!fen) continue;
    const event = row.event_name || row.event || "Captured model game";
    const moveLabel = moveNumberLabel(row.ply);
    puzzles.push({
      key: `model:${row.game_id}:${row.ply}`,
      source: "model-game",
      kind: "captured-eval-swing",
      sourceLabel: `${row.white}–${row.black} · ${event} · ${moveLabel}`,
      sourceDetail:
        "Position from a captured model game. The captured evaluation swung after the move played there.",
      fen,
      side,
      moveNumber: Math.ceil(row.ply / 2),
      evalBefore: Number(row.eval_before),
      evalAfter: Number(row.eval_after),
      cpLoss: Math.round(loss),
      difficulty: Math.round(clamp(1250 + loss * 3, 1000, 2400)),
      gameId: row.game_id,
      ply: row.ply,
      daily: Boolean(row.is_daily),
      playedSan: row.san,
    });
  }
  return puzzles;
}

/**
 * Repertoire-mistake puzzles are positions whose latest local review is
 * incorrect. The expected move is the saved move that was missed; all saved
 * moves at that position are accepted, exactly like practice (D025).
 */
function repertoirePuzzles() {
  const rows = db
    .prepare(
      `SELECT lm.id AS line_move_id, lm.epd, lm.fen, lm.san, lm.side, lm.ply,
              lm.difficulty, lm.lapses, lm.wrong_count,
              l.id AS line_id, l.name AS line_name,
              r.id AS repertoire_id, r.name AS repertoire_name, r.color AS repertoire_color,
              (SELECT COUNT(*) FROM reviews rv
                 WHERE rv.line_move_id = lm.id AND rv.correct = 0) AS wrong,
              (SELECT rv.correct FROM reviews rv
                 WHERE rv.line_move_id = lm.id
                 ORDER BY rv.created_at DESC, rv.id DESC LIMIT 1) AS latest
       FROM line_moves lm
       JOIN lines l ON l.id = lm.line_id
       JOIN repertoires r ON r.id = lm.repertoire_id
       WHERE lm.is_user = 1
       ORDER BY r.id, lm.epd, lm.lapses DESC, lm.id ASC`
    )
    .all();
  const byPosition = new Map();
  for (const row of rows) {
    if (row.latest == null || Number(row.latest) !== 0) continue;
    const positionKey = `${row.repertoire_id}:${row.epd}`;
    if (!byPosition.has(positionKey)) byPosition.set(positionKey, row);
  }
  const puzzles = [];
  for (const row of byPosition.values()) {
    const alternatives = db
      .prepare(
        `SELECT DISTINCT san FROM line_moves
         WHERE repertoire_id = ? AND epd = ? AND is_user = 1 ORDER BY san`
      )
      .all(row.repertoire_id, row.epd)
      .map((entry) => entry.san);
    if (!alternatives.length) alternatives.push(row.san);
    puzzles.push({
      key: `repertoire:${row.repertoire_id}:${row.epd}:${sanKey(row.san)}`,
      source: "repertoire-mistake",
      kind: "saved-move-missed",
      sourceLabel: `${row.repertoire_name} · ${row.line_name} · ${moveNumberLabel(row.ply)}`,
      sourceDetail: `A saved move you answered incorrectly ${
        Number(row.wrong) === 1 ? "once" : `${row.wrong} times`
      }. The answer is the saved repertoire move.`,
      fen: row.fen,
      side: row.side,
      ply: row.ply,
      moveNumber: Math.ceil(row.ply / 2),
      expectedSan: row.san,
      alternatives,
      cpLoss: null,
      difficulty: Math.round(clamp(1150 + Number(row.difficulty || 1) * 90, 1000, 2200)),
      wrongCount: Number(row.wrong),
      lineId: row.line_id,
      lineName: row.line_name,
      repertoireId: row.repertoire_id,
      repertoireName: row.repertoire_name,
    });
  }
  return puzzles;
}

function allPuzzles() {
  const model = modelGamePuzzles();
  const repertoire = repertoirePuzzles();
  // Repertoire mistakes are the most personal signal, so they come first.
  return [...repertoire, ...model];
}

function publicPuzzle(puzzle, solved = false) {
  return {
    key: puzzle.key,
    source: puzzle.source,
    kind: puzzle.kind,
    sourceLabel: puzzle.sourceLabel,
    sourceDetail: puzzle.sourceDetail,
    fen: puzzle.fen,
    side: puzzle.side,
    moveNumber: puzzle.moveNumber ?? (puzzle.ply ? Math.ceil(puzzle.ply / 2) : null),
    cpLoss: puzzle.cpLoss ?? null,
    evalBefore: puzzle.evalBefore ?? null,
    evalAfter: puzzle.evalAfter ?? null,
    difficulty: puzzle.difficulty,
    solved,
    lineName: puzzle.lineName ?? null,
    repertoireName: puzzle.repertoireName ?? null,
  };
}

function findPuzzle(key) {
  return allPuzzles().find((puzzle) => puzzle.key === key) ?? null;
}

function listFor(userId) {
  const solved = solvedKeys(userId, "puzzles");
  const puzzles = allPuzzles();
  const attempts = recentAttempts(userId, "puzzles", 12);
  const attemptCounts = new Map();
  for (const attempt of attempts) {
    if (!attempt.itemKey) continue;
    attemptCounts.set(attempt.itemKey, (attemptCounts.get(attempt.itemKey) || 0) + 1);
  }
  return {
    puzzles: puzzles.map((puzzle) => ({
      ...publicPuzzle(puzzle, solved.has(puzzle.key)),
      attempts: attemptCounts.get(puzzle.key) || 0,
    })),
    counts: {
      total: puzzles.length,
      modelGame: puzzles.filter((puzzle) => puzzle.source === "model-game").length,
      repertoireMistakes: puzzles.filter((puzzle) => puzzle.source === "repertoire-mistake").length,
      solved: puzzles.filter((puzzle) => solved.has(puzzle.key)).length,
    },
    profile: profileFor(userId, "puzzles"),
    recentAttempts: attempts,
    engine: {
      name: "Chessbook local heuristic",
      stockfish: false,
      note: "Captured model-game swings supply the positions; the local engine verifies the best move. Repertoire puzzles use the saved move you missed.",
    },
  };
}

export function solvePuzzle(puzzle, { san = "", giveUp = false } = {}) {
  let chess;
  try {
    chess = new Chess(puzzle.fen);
  } catch {
    return { error: "The puzzle position could not be loaded", code: "invalid_position" };
  }
  let legal = null;
  if (san) legal = findLegalMove(puzzle.fen, san);
  if (san && !legal) {
    return {
      error: `Illegal move ${san} in this position`,
      code: "illegal_move",
      legalMoves: chess.moves(),
      fen: puzzle.fen,
    };
  }

  if (puzzle.source === "repertoire-mistake") {
    const playedKey = legal ? sanKey(legal.san) : null;
    const accepted = new Set(puzzle.alternatives.map((entry) => sanKey(entry)));
    const correct = !giveUp && Boolean(playedKey) && accepted.has(playedKey);
    const bestSan = puzzle.expectedSan;
    const best = findLegalMove(puzzle.fen, bestSan);
    return {
      correct,
      result: giveUp ? "gave-up" : correct ? "solved" : "wrong",
      best: best
        ? {
            san: best.san,
            from: best.from,
            to: best.to,
            uci: `${best.from}${best.to}${best.promotion || ""}`,
          }
        : { san: bestSan, from: null, to: null, uci: null },
      alternatives: puzzle.alternatives,
      played: legal
        ? {
            san: legal.san,
            from: legal.from,
            to: legal.to,
            uci: `${legal.from}${legal.to}${legal.promotion || ""}`,
          }
        : null,
      cpLoss: null,
      classification: correct ? "best" : "wrong",
      explanation: correct
        ? `Correct. ${bestSan} is the saved repertoire move at this position.`
        : `The saved repertoire move here was ${bestSan}.`,
      source: {
        type: puzzle.source,
        label: puzzle.sourceLabel,
        detail: puzzle.sourceDetail,
        lineName: puzzle.lineName,
        repertoireName: puzzle.repertoireName,
      },
    };
  }

  // Captured model-game swing: the local engine supplies the reference move.
  const depth = puzzle.cpLoss >= 180 ? 3 : 2;
  const analysis = cachedAnalysis(puzzle.fen, depth, 45000);
  if (!analysis.best) {
    return { error: "No legal moves at the puzzle position", code: "no_moves" };
  }
  const played = legal
    ? analysis.moves.find((move) => sanKey(move.san) === sanKey(legal.san)) ?? null
    : null;
  const bestScore = analysis.best.score;
  const playedScore = played ? played.score : -Infinity;
  const cpLoss = played ? Math.max(0, Math.round(bestScore - playedScore)) : null;
  const correct = !giveUp && Boolean(played) && cpLoss != null && cpLoss <= 25;
  const alternatives = analysis.moves
    .filter((move) => move.score >= bestScore - 25)
    .slice(0, 3)
    .map((move) => move.san);
  return {
    correct,
    result: giveUp ? "gave-up" : correct ? "solved" : "wrong",
    best: {
      san: analysis.best.san,
      from: analysis.best.from,
      to: analysis.best.to,
      uci: analysis.best.uci,
      score: Math.round(bestScore),
    },
    alternatives,
    played: legal
      ? {
          san: legal.san,
          from: legal.from,
          to: legal.to,
          uci: `${legal.from}${legal.to}${legal.promotion || ""}`,
          cpLoss,
          classification: cpLoss == null ? null : classifyLoss(cpLoss),
        }
      : null,
    cpLoss,
    classification: cpLoss == null ? null : classifyLoss(cpLoss),
    explanation: correct
      ? `Correct. The local engine agrees ${analysis.best.san} keeps the position.`
      : giveUp
        ? `The local engine's best move here is ${analysis.best.san}.`
        : `The local engine prefers ${analysis.best.san}${
            cpLoss == null ? "" : ` (${cpLoss}cp better than the move played here)`
          }.`,
    source: {
      type: puzzle.source,
      label: puzzle.sourceLabel,
      detail: puzzle.sourceDetail,
      playedInGame: puzzle.playedSan ?? null,
      evalBefore: puzzle.evalBefore ?? null,
      evalAfter: puzzle.evalAfter ?? null,
    },
  };
}

puzzlesRouter.get("/", (req, res) => {
  res.json(listFor(req.user.id));
});

puzzlesRouter.post("/next", (req, res) => {
  const body = req.body || {};
  const exclude = new Set(Array.isArray(body.exclude) ? body.exclude : []);
  const solved = solvedKeys(req.user.id, "puzzles");
  const all = allPuzzles().filter((puzzle) => {
    if (exclude.has(puzzle.key)) return false;
    if (body.source && puzzle.source !== body.source) return false;
    return true;
  });
  const unsolved = all.filter((puzzle) => !solved.has(puzzle.key));
  const pool = unsolved.length ? unsolved : all;
  if (!pool.length) {
    return res.json({ puzzle: null, complete: true, profile: profileFor(req.user.id, "puzzles") });
  }
  const puzzle = pool[Math.floor(Math.random() * pool.length)];
  res.json({
    puzzle: publicPuzzle(puzzle, solved.has(puzzle.key)),
    complete: unsolved.length === 0,
    remaining: unsolved.length,
    profile: profileFor(req.user.id, "puzzles"),
  });
});

puzzlesRouter.post("/attempt", (req, res) => {
  const body = req.body || {};
  const key = String(body.key || "");
  if (!key) return res.status(400).json({ error: "A puzzle key is required" });
  const puzzle = findPuzzle(key);
  if (!puzzle) return res.status(404).json({ error: "Puzzle not found", code: "puzzle_not_found" });
  const outcome = solvePuzzle(puzzle, {
    san: body.san ? String(body.san) : "",
    giveUp: Boolean(body.giveUp),
  });
  if (outcome.error) {
    return res.status(outcome.code === "illegal_move" ? 422 : 400).json(outcome);
  }
  const profile = recordProfileResult(req.user.id, "puzzles", {
    score: outcome.correct ? 1 : 0,
    opponentRating: puzzle.difficulty,
    k: 28,
    perfect: outcome.correct,
    data: {
      lastKey: puzzle.key,
      lastSource: puzzle.source,
      lastResult: outcome.result,
      lastBest: outcome.best?.san ?? null,
      lastAt: new Date().toISOString(),
    },
    attempt: {
      itemKey: puzzle.key,
      detail: {
        source: puzzle.source,
        result: outcome.result,
        bestSan: outcome.best?.san ?? null,
        playedSan: outcome.played?.san ?? null,
        cpLoss: outcome.cpLoss,
      },
    },
  });
  res.json({
    ...outcome,
    key: puzzle.key,
    puzzle: publicPuzzle(puzzle, outcome.correct),
    profile,
  });
});
