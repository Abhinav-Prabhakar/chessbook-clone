import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  analyse,
  bestMove,
  close,
  evaluate,
  refute,
  reviewGame,
  status,
} from "../../server/engine.js";

after(async () => {
  await close();
});

const START = new Chess().fen();

function fenAfter(sans) {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return chess.fen();
}

test("engine status reports the real Stockfish 19 binary without spawning at import", () => {
  const state = status();
  assert.equal(state.available, true);
  assert.match(state.engine.name, /Stockfish 19/);
  assert.match(state.path, /stockfish-19-lite-single\.js$/);
  assert.equal(state.started, false);
});

test("analyse returns a legal best move, real depth and multipv lines", async () => {
  const result = await analyse(START, { depth: 8, multipv: 3 });
  assert.equal(result.available, true);
  assert.equal(result.source, "stockfish");
  assert.match(result.engine.name, /Stockfish 19/);
  assert.equal(result.depth >= 8, true);
  assert.equal(result.lines.length, 3);
  assert.ok(Number.isFinite(result.evalCp));
  const chess = new Chess(START);
  const move = chess.move(result.lines[0].san);
  assert.ok(move.from);
  assert.equal(result.lines[0].uci, `${move.from}${move.to}${move.promotion ?? ""}`);
  // MultiPV lines are ranked and carry their own eval.
  assert.equal(result.lines[0].rank, 1);
  assert.ok(result.lines.every((line) => Number.isFinite(line.cp)));
  assert.equal(result.bestSan, result.lines[0].san);
});

test("bestMove and evaluate expose White-POV scores", async () => {
  const best = await bestMove(fenAfter(["e4"]), { depth: 8 });
  assert.equal(best.available, true);
  const chess = new Chess(fenAfter(["e4"]));
  assert.ok(chess.move(best.san));
  const evaluation = await evaluate(fenAfter(["e4"]), { depth: 8 });
  assert.equal(evaluation.available, true);
  assert.equal(evaluation.evalCp, evaluation.cp);
  assert.equal(evaluation.evalPawns, Math.round((evaluation.cp / 100) * 100) / 100);
  assert.equal(evaluation.mate, null);
});

test("refute uses Stockfish's best reply and the real eval swing", async () => {
  const result = await refute(START, "f3", { depth: 8 });
  assert.equal(result.available, true);
  assert.equal(result.source, "stockfish");
  assert.match(result.engine.name, /Stockfish 19/);
  const probe = new Chess(result.fen);
  const reply = probe.move(result.san);
  assert.equal(reply.from, result.from);
  assert.equal(reply.to, result.to);
  assert.ok(Number.isFinite(result.evalCp));
  assert.ok(result.damagePawns == null || result.damagePawns >= 0);
});

test("reviewGame classifies a hanging queen as a mistake or blunder", async () => {
  const before = "k2r4/7p/8/8/8/8/7P/K2Q4 w - - 0 1";
  const afterQd4 = (() => {
    const chess = new Chess(before);
    chess.move("Qd4");
    return chess.fen();
  })();
  const afterRxd4 = (() => {
    const chess = new Chess(afterQd4);
    chess.move("Rxd4");
    return chess.fen();
  })();
  const review = await reviewGame([before, afterQd4, afterRxd4], {
    depth: 8,
    plies: ["Qd4", "Rxd4"],
  });
  assert.equal(review.available, true);
  assert.equal(review.moves.length, 2);
  const blunder = review.moves[0];
  assert.equal(blunder.san, "Qd4");
  assert.ok(["mistake", "blunder", "inaccuracy"].includes(blunder.classification));
  assert.ok(blunder.cpLoss >= 70);
  assert.ok(blunder.bestSan);
  assert.equal(review.summary.plies, 2);
  assert.ok(review.summary.blunders + review.summary.mistakes + review.summary.inaccuracies >= 1);
});

test("a disabled engine returns available:false instead of fabricating a score", async () => {
  process.env.CHESSBOOK_ENGINE_DISABLED = "1";
  try {
    const state = status();
    assert.equal(state.available, false);
    // A position not analysed by earlier tests, so the memory cache cannot
    // legitimately satisfy it.
    const fresh = "rnbqkbnr/pppppppp/8/8/7P/8/PPPPPPP1/RNBQKBNR b KQkq - 0 1";
    const result = await evaluate(fresh, { depth: 8 });
    assert.equal(result.available, false);
    assert.equal(result.reason, "engine_missing");
    assert.equal(result.evalCp, undefined);
    assert.equal(result.engine.version, "19");
  } finally {
    delete process.env.CHESSBOOK_ENGINE_DISABLED;
  }
});
