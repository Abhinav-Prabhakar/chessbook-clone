/**
 * Local refutation for a wrong practice move (D020).
 *
 * There is no bundled Stockfish binary in this build, so this module is a
 * small, deterministic material/mate search over `chess.js` — not a fake
 * number and not a cloud call. Every result is labelled with its engine and
 * depth so the UI can say exactly where it came from. When the captured
 * production data contains an annotation for the reply, it is attached as an
 * explanation, but the move itself is still computed locally.
 */
import { Chess } from "chess.js";
import { annotationForMove } from "./opening-data.js";
import { epdOf, findLegalMove } from "./positions.js";

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;
const NODE_CAP = 60000;
const TIME_CAP_MS = 400;

const PIECE_NAME = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

function material(game) {
  let score = 0;
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      score += (piece.color === "w" ? 1 : -1) * VALUE[piece.type];
    }
  }
  return score;
}

/** Tiny positional bonus: central pawns/knights, castled king safety. */
function positional(game) {
  let score = 0;
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const file = "abcdefgh".indexOf(piece.square[0]);
      const rank = Number(piece.square[1]);
      const centre = 3.5 - Math.max(Math.abs(file - 3.5), Math.abs(rank - 4.5));
      const bonus =
        piece.type === "p"
          ? Math.round(centre * 4)
          : piece.type === "n" || piece.type === "b"
            ? Math.round(centre * 5)
            : 0;
      score += (piece.color === "w" ? 1 : -1) * bonus;
    }
  }
  return score;
}

function evaluate(game) {
  return material(game) + positional(game);
}

function orderedMoves(game) {
  const moves = game.moves({ verbose: true });
  moves.sort((a, b) => {
    const capture = (move) => (move.captured ? VALUE[move.captured] : 0) + (move.promotion ? 800 : 0);
    return capture(b) - capture(a) || (a.san < b.san ? -1 : 1);
  });
  return moves;
}

class SearchBudget {
  constructor() {
    this.nodes = 0;
    this.started = Date.now();
  }
  exhausted() {
    this.nodes += 1;
    return this.nodes > NODE_CAP || Date.now() - this.started > TIME_CAP_MS;
  }
}

/** Quiescence over captures only, so hanging material is not missed. */
function quiesce(game, alpha, beta, budget, depth = 2) {
  if (budget.exhausted()) return evaluate(game);
  const standing = evaluate(game);
  if (depth === 0) return standing;
  if (game.turn() === "w") {
    if (standing >= beta) return standing;
    if (standing > alpha) alpha = standing;
  } else {
    if (standing <= alpha) return standing;
    if (standing < beta) beta = standing;
  }
  const captures = orderedMoves(game).filter((move) => move.captured || move.promotion);
  if (!captures.length) return standing;
  let best = standing;
  for (const move of captures) {
    const probe = new Chess(game.fen());
    try {
      probe.move(move.san);
    } catch {
      continue;
    }
    const score = quiesce(probe, alpha, beta, budget, depth - 1);
    if (game.turn() === "w") {
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    } else {
      if (score < best) best = score;
      if (best < beta) beta = best;
      if (beta <= alpha) break;
    }
  }
  return best;
}

/** Negamax-style minimax returning White's centipawn evaluation. */
function search(game, depth, alpha, beta, budget) {
  if (budget.exhausted()) return evaluate(game);
  if (game.isCheckmate()) return game.turn() === "w" ? -MATE - depth : MATE + depth;
  if (game.isDraw() || game.isStalemate() || game.isThreefoldRepetition()) return 0;
  if (depth <= 0) return quiesce(game, alpha, beta, budget);
  const moves = orderedMoves(game);
  if (!moves.length) return 0;
  if (game.turn() === "w") {
    let best = -Infinity;
    for (const move of moves) {
      const probe = new Chess(game.fen());
      probe.move(move.san);
      const score = search(probe, depth - 1, alpha, beta, budget);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const move of moves) {
    const probe = new Chess(game.fen());
    probe.move(move.san);
    const score = search(probe, depth - 1, alpha, beta, budget);
    if (score < best) best = score;
    if (best < beta) beta = best;
    if (beta <= alpha) break;
  }
  return best;
}

function bestReply(game, depth, budget) {
  const moves = orderedMoves(game);
  if (!moves.length) return { move: null, score: evaluate(game), line: [] };
  const maximizing = game.turn() === "w";
  let best = null;
  let bestScore = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    const probe = new Chess(game.fen());
    probe.move(move.san);
    const score = search(probe, Math.max(0, depth - 1), -Infinity, Infinity, budget);
    if (maximizing ? score > bestScore : score < bestScore) {
      bestScore = score;
      best = move;
    }
    if (budget.nodes > NODE_CAP) break;
  }
  let line = [];
  if (best) {
    line.push(best.san);
    if (depth > 1) {
      const after = new Chess(game.fen());
      after.move(best.san);
      const reply = bestReply(after, depth - 2, budget);
      if (reply.move) line = [best.san, reply.move.san];
    }
  }
  return { move: best, score: bestScore, line };
}

function describe({ game, reply, damage, expectedSan, expectedMove, captured }) {
  const parts = [];
  const check = (() => {
    const probe = new Chess(game.fen());
    try {
      probe.move(reply.san);
      return probe.isCheck();
    } catch {
      return false;
    }
  })();
  const mate = (() => {
    const probe = new Chess(game.fen());
    try {
      probe.move(reply.san);
      return probe.isCheckmate();
    } catch {
      return false;
    }
  })();

  if (mate) {
    parts.push(`${reply.san} is checkmate.`);
  } else if (reply.captured) {
    parts.push(
      `${reply.san} wins your ${PIECE_NAME[reply.captured] ?? "piece"} on ${reply.to}.`
    );
  } else if (check) {
    parts.push(`${reply.san} comes with check and takes the initiative.`);
  } else {
    parts.push(`${reply.san} is the strongest reply in this position.`);
  }

  if (Number.isFinite(damage)) {
    const pawns = Math.round((damage / 100) * 10) / 10;
    if (pawns >= 9) {
      parts.push(
        `It throws away decisive material (about ${pawns} pawns) compared with your saved move ${
          expectedSan ?? expectedMove?.san ?? ""
        }.`
      );
    } else if (pawns >= 0.5) {
      parts.push(
        `That is about ${pawns} pawn${pawns === 1 ? "" : "s"} worse than your saved move ${
          expectedSan ?? expectedMove?.san ?? ""
        }.`.trim()
      );
    } else if (pawns <= -0.5) {
      parts.push("The evaluation is still close — it is the move, not the advantage, that is wrong.");
    }
  }
  if (captured?.text) parts.push(captured.text);

  return {
    text: parts.join(" "),
    check,
    mate,
    captured: reply.captured ?? null,
    damagePawns: Number.isFinite(damage) ? Math.round((damage / 100) * 10) / 10 : null,
  };
}

/**
 * Compute a refutation for `playedSan` at `fen`.
 *
 * @returns {{
 *   available: boolean, san?: string, uci?: string, from?: string, to?: string,
 *   fen?: string, epd?: string, line?: string[], evalPawns?: number|null,
 *   mate?: boolean, depth?: number, engine?: string, source?: string,
 *   explanation?: string, damagePawns?: number|null, expectedEvalPawns?: number|null,
 *   nodes?: number, reason?: string
 * }}
 */
export function refuteMove(db, fen, playedSan, { expectedSan = null, depth = 2 } = {}) {
  let before;
  try {
    before = new Chess(fen);
  } catch {
    return { available: false, reason: "invalid_position" };
  }
  const played = findLegalMove(fen, playedSan);
  if (!played) return { available: false, reason: "illegal_move" };

  let after;
  try {
    after = new Chess(fen);
    after.move(played.san);
  } catch {
    return { available: false, reason: "illegal_move" };
  }
  if (after.isGameOver()) {
    return {
      available: false,
      reason: after.isCheckmate() ? "checkmate" : "game_over",
      playedSan: played.san,
      engine: "local-material-search",
    };
  }

  const budget = new SearchBudget();
  const reply = bestReply(after, depth, budget);
  if (!reply.move) return { available: false, reason: "no_reply", playedSan: played.san };

  let expectedEval = null;
  let expectedMove = null;
  if (expectedSan) {
    const expected = findLegalMove(fen, expectedSan);
    if (expected) {
      expectedMove = expected;
      const probe = new Chess(fen);
      probe.move(expected.san);
      if (!probe.isGameOver()) {
        const expectedReply = bestReply(probe, depth, budget);
        expectedEval = expectedReply.score;
      } else if (probe.isCheckmate()) {
        expectedEval = MATE;
      }
    }
  }

  const evalCp = reply.score;
  const damage =
    expectedEval == null || Math.abs(evalCp) > MATE / 2 || Math.abs(expectedEval) > MATE / 2
      ? null
      : expectedEval - evalCp;
  const epd = epdOf(after.fen());
  const captured = db ? annotationForMove(db, epd, reply.move.san) : null;
  const description = describe({
    game: after,
    reply: reply.move,
    damage,
    expectedSan,
    expectedMove,
    captured,
  });

  return {
    available: true,
    playedSan: played.san,
    san: reply.move.san,
    uci: `${reply.move.from}${reply.move.to}${reply.move.promotion ?? ""}`,
    from: reply.move.from,
    to: reply.move.to,
    fen: after.fen(),
    epd,
    line: reply.line,
    evalPawns:
      Math.abs(evalCp) > MATE / 2 ? null : Math.round((evalCp / 100) * 10) / 10,
    mate: Math.abs(evalCp) > MATE / 2,
    depth,
    engine: "local-material-search",
    source: "local",
    explanation: description.text,
    check: description.check,
    mateAvailable: description.mate,
    captured: description.captured,
    damagePawns: description.damagePawns,
    expectedEvalPawns:
      expectedEval == null || Math.abs(expectedEval) > MATE / 2
        ? null
        : Math.round((expectedEval / 100) * 10) / 10,
    nodes: budget.nodes,
    annotation: captured?.text ?? null,
    annotationSource: captured?.source ?? null,
  };
}

export { evaluate as evaluateFen };
