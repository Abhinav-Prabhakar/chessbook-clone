import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { startTestServer } from "./helpers.js";

function legalMoves(fen) {
  return new Chess(fen).moves();
}

test("play API: progress, training games, puzzles, intuition, visualization and vision", async (t) => {
  const ctx = await startTestServer();
  t.after(async () => {
    await ctx.close();
  });

  await t.test("capabilities and per-feature progress are exposed", async () => {
    const root = await ctx.apiOk("GET", "/play");
    assert.ok(root.features.includes("training"));
    assert.ok(root.features.includes("puzzles"));
    assert.equal(root.engine.stockfish, false);

    const progress = await ctx.apiOk("GET", "/play/progress");
    for (const feature of ["training", "puzzles", "intuition", "visualization", "vision"]) {
      assert.equal(typeof progress.profiles[feature].rating, "number");
      assert.equal(progress.profiles[feature].attempts, 0);
    }
    const unknown = await ctx.api("GET", "/play/progress/nope");
    assert.equal(unknown.status, 404);
  });

  await t.test("training game validates legality, clocks the bot and produces a review", async () => {
    const options = await ctx.apiOk("GET", "/play/training-games/options");
    assert.ok(options.timeControls.some((tc) => tc.id === "3+2"));
    assert.ok(options.bots.length >= 5);

    const start = await ctx.apiOk("POST", "/play/training-games", {
      rating: 1600,
      timeControl: "3+2",
      side: "white",
    });
    const game = start.game;
    assert.equal(game.status, "active");
    assert.equal(game.playerColor, "white");
    assert.equal(game.turn, "white");
    assert.equal(game.moves.length, 0);
    assert.equal(game.clock.whiteMs, 180000);
    assert.ok(game.legalMoves.includes("e4"));

    const illegal = await ctx.api("POST", `/play/training-games/${game.id}/moves`, {
      san: "Qh5",
      timeSpentMs: 100,
    });
    assert.equal(illegal.status, 422);
    assert.equal(illegal.body.code, "illegal_move");

    const played = await ctx.apiOk("POST", `/play/training-games/${game.id}/moves`, {
      san: "e4",
      timeSpentMs: 250,
    });
    assert.equal(played.game.moves.length, 2);
    assert.equal(played.game.moves[0].san, "e4");
    assert.equal(played.game.moves[0].by, "player");
    assert.equal(played.game.moves[1].by, "bot");
    assert.equal(played.game.turn, "white");
    assert.ok(played.game.clock.whiteMs > 180000, "the 3+2 increment is applied");
    assert.ok(played.game.clock.blackMs < 182000, "the bot move is clocked with the increment");

    const resigned = await ctx.apiOk("POST", `/play/training-games/${game.id}/resign`);
    assert.equal(resigned.game.status, "finished");
    assert.equal(resigned.game.result.outcome, "loss");
    assert.equal(resigned.game.result.reason, "resignation");

    const review = await ctx.apiOk("POST", `/play/training-games/${game.id}/review`);
    assert.equal(review.review.available, true);
    assert.equal(review.review.playerMoves, 1);
    assert.ok(review.review.accuracy >= 0 && review.review.accuracy <= 100);
    assert.equal(review.review.engine.stockfish, false);
    assert.match(review.review.engine.name, /Chessbook local heuristic/);
    assert.equal(review.review.moves[0].san, "e4");

    const cached = await ctx.apiOk("POST", `/play/training-games/${game.id}/review`);
    assert.equal(cached.cached, true);

    const history = await ctx.apiOk("GET", "/play/training-games");
    assert.equal(history.games[0].id, game.id);
    assert.equal(history.games[0].result.outcome, "loss");
    assert.equal(history.profile.games, 1);
  });

  await t.test("training games can start from a studied position (D034 link target)", async () => {
    const chess = new Chess();
    chess.move("e4");
    chess.move("c5");
    const fen = chess.fen();
    const started = await ctx.apiOk("POST", "/play/training-games", {
      rating: 1800,
      timeControl: "5+3",
      side: "white",
      fen,
      from: "/build/white?ply=2",
    });
    assert.equal(new Chess(started.game.startFen).fen(), fen);
    assert.equal(started.game.playerColor, "white");
    assert.equal(started.game.turn, "white");
    assert.equal(started.game.moves.length, 0);
    assert.equal(started.setup.customPosition, true);
    assert.equal(started.setup.from, "/build/white?ply=2");

    const badFen = await ctx.api("POST", "/play/training-games", { fen: "not-a-fen" });
    assert.equal(badFen.status, 400);
    assert.equal(badFen.body.code, "invalid_fen");
  });

  await t.test("bot move selection is deterministic for the same seed", async () => {
    const { chooseBotMove } = await import("../../server/bot.js");
    const fen = new Chess().fen();
    const first = chooseBotMove(fen, { rating: 1400, seed: "seed-1" });
    const second = chooseBotMove(fen, { rating: 1400, seed: "seed-1" });
    assert.equal(first.san, second.san);
    assert.ok(legalMoves(fen).includes(first.san));
    const strong = chooseBotMove(fen, { rating: 2600, seed: "seed-1" });
    assert.ok(legalMoves(fen).includes(strong.san));
  });

  await t.test("blunder puzzles derive from captured games and persist rating/streak", async () => {
    const list = await ctx.apiOk("GET", "/play/blunder-puzzles");
    assert.ok(list.counts.total > 0);
    assert.ok(list.counts.modelGame > 0);
    assert.equal(list.counts.repertoireMistakes, 0, "a fresh profile has no real mistakes yet");
    assert.equal(list.engine.stockfish, false);
    const puzzle = list.puzzles[0];
    assert.ok(puzzle.fen);
    assert.ok(puzzle.sourceLabel.includes("–"));
    assert.ok(puzzle.cpLoss >= 60);

    const unknown = await ctx.api("POST", "/play/blunder-puzzles/attempt", { key: "nope" });
    assert.equal(unknown.status, 404);

    const gaveUp = await ctx.apiOk("POST", "/play/blunder-puzzles/attempt", {
      key: puzzle.key,
      giveUp: true,
    });
    assert.equal(gaveUp.result, "gave-up");
    assert.ok(legalMoves(puzzle.fen).includes(gaveUp.best.san));

    const wrongMove = legalMoves(puzzle.fen).find((san) => san !== gaveUp.best.san);
    if (wrongMove) {
      const wrong = await ctx.apiOk("POST", "/play/blunder-puzzles/attempt", {
        key: puzzle.key,
        san: wrongMove,
      });
      assert.equal(wrong.correct, false);
    }

    const solved = await ctx.apiOk("POST", "/play/blunder-puzzles/attempt", {
      key: puzzle.key,
      san: gaveUp.best.san,
    });
    assert.equal(solved.correct, true);
    assert.equal(solved.result, "solved");
    assert.equal(solved.profile.streak, 1);
    assert.ok(solved.profile.rating > 1200);
    assert.ok(solved.profile.attempts >= 3);

    const illegal = await ctx.api("POST", "/play/blunder-puzzles/attempt", {
      key: puzzle.key,
      san: "Zz9",
    });
    assert.equal(illegal.status, 422);
  });

  await t.test("intuition builder scores the moves actually played and persists the style", async () => {
    const index = await ctx.apiOk("GET", "/play/intuition-builder");
    assert.equal(index.available, true);
    assert.ok(index.positions.length >= 4);

    const started = await ctx.apiOk("POST", "/play/intuition-builder/session", { count: 3 });
    assert.equal(started.session.total, 3);
    assert.ok(started.session.position.fen);
    let session = started.session;
    let last = null;
    let guard = 0;
    while (!session.complete && guard < 10) {
      const san = legalMoves(session.position.fen)[0];
      last = await ctx.apiOk("POST", "/play/intuition-builder/answer", {
        sessionId: session.id,
        san,
      });
      assert.equal(last.answer.san, san);
      assert.ok(last.answer.stylePoints);
      for (const key of ["aggressive", "solid", "sharp", "learnable"]) {
        assert.ok(last.answer.stylePoints[key] >= 0);
        assert.ok(last.answer.stylePoints[key] <= 100);
      }
      assert.ok(last.top.length > 0);
      session = last.session;
      guard += 1;
    }
    assert.equal(session.complete, true);
    assert.equal(last.complete, true);
    assert.ok(last.result.label);
    assert.equal(last.result.answers.length, 3);

    const after = await ctx.apiOk("GET", "/play/intuition-builder");
    assert.equal(after.profile.data.answers, 3);
    assert.equal(after.profile.data.sessions, 1);
    assert.ok(after.profile.data.styles);
    assert.equal(after.summary.sessions, 1);

    const again = await ctx.api("POST", "/play/intuition-builder/answer", {
      sessionId: session.id,
      san: "e4",
    });
    assert.equal(again.status, 409);
  });

  await t.test("visualization drills hide the moves and score reconstructions/questions", async () => {
    const index = await ctx.apiOk("GET", "/play/visualization");
    assert.ok(index.difficulties.length >= 3);

    const reconstruct = await ctx.apiOk("POST", "/play/visualization/session", {
      difficulty: 2,
      mode: "reconstruct",
    });
    assert.equal(reconstruct.session.mode, "reconstruct");
    assert.equal(reconstruct.session.hiddenMoves, 3);
    assert.equal(reconstruct.session.playback.length, 3);
    assert.equal(reconstruct.session.playback[0].san, undefined, "SANs are not sent to the client");
    assert.ok(reconstruct.session.startFen);
    assert.ok(reconstruct.session.source.label);

    const zero = await ctx.apiOk("POST", "/play/visualization/answer", {
      sessionId: reconstruct.session.id,
      moves: [],
    });
    assert.equal(zero.result.score, 0);
    assert.equal(zero.result.total, 3);
    assert.equal(zero.profile.attempts, 1);

    const repeat = await ctx.apiOk("POST", "/play/visualization/answer", {
      sessionId: reconstruct.session.id,
      moves: [],
    });
    assert.equal(repeat.idempotent, true);

    const questions = await ctx.apiOk("POST", "/play/visualization/session", {
      difficulty: 3,
      mode: "questions",
    });
    assert.equal(questions.session.questions.length, 3);
    const answers = await ctx.apiOk("POST", "/play/visualization/answer", {
      sessionId: questions.session.id,
      answers: [0, 1, 0],
    });
    assert.equal(answers.result.questions.length, 3);
    assert.ok(answers.result.score >= 0 && answers.result.score <= 100);
  });

  await t.test("vision drills are generated from real positions with immediate scoring", async () => {
    const index = await ctx.apiOk("GET", "/play/vision");
    assert.equal(index.sources.available, true);
    assert.ok(index.kinds.some((kind) => kind.id === "checks"));

    for (const kind of ["hanging", "checks", "undefended"]) {
      const started = await ctx.api("POST", "/play/vision/session", { kind, difficulty: 2 });
      assert.equal(started.status, 201, `${kind} should generate a drill`);
      const session = started.body.session;
      assert.ok(session.fen);
      assert.ok(session.count > 0);
      const stored = ctx.db
        .prepare("SELECT payload_json FROM play_drills WHERE id = ?")
        .get(session.id);
      const answer = JSON.parse(stored.payload_json).answer;
      assert.equal(answer.length, session.count);

      const empty = await ctx.apiOk("POST", "/play/vision/answer", {
        sessionId: session.id,
        squares: [],
      });
      assert.equal(empty.result.score, 0);
      assert.equal(empty.result.missedSquares.length, answer.length);
      assert.equal(empty.profile.attempts > 0, true);

      const exact = await ctx.api("POST", "/play/vision/session", { kind, difficulty: 2 });
      const exactSession = exact.body.session;
      const exactStored = ctx.db
        .prepare("SELECT payload_json FROM play_drills WHERE id = ?")
        .get(exactSession.id);
      const exactAnswer = JSON.parse(exactStored.payload_json).answer;
      const perfect = await ctx.apiOk("POST", "/play/vision/answer", {
        sessionId: exactSession.id,
        squares: exactAnswer,
      });
      assert.equal(perfect.result.exact, true);
      assert.equal(perfect.result.score, 100);
    }

    const badKind = await ctx.api("POST", "/play/vision/session", { kind: "not-a-kind" });
    assert.equal(badKind.status, 201, "unknown kinds fall back to hanging");
  });

  await t.test("all play progress is persisted in SQLite", async () => {
    const profiles = ctx.db
      .prepare("SELECT feature, rating, attempts, games FROM play_profiles ORDER BY feature")
      .all();
    const features = profiles.map((row) => row.feature);
    for (const feature of ["training", "puzzles", "intuition", "visualization", "vision"]) {
      assert.ok(features.includes(feature), `${feature} profile row is stored`);
    }
    const attempts = ctx.db.prepare("SELECT COUNT(*) AS n FROM play_attempts").get().n;
    assert.ok(attempts >= 8);
    const drills = ctx.db.prepare("SELECT COUNT(*) AS n FROM play_drills").get().n;
    assert.ok(drills >= 6);
    const games = ctx.db.prepare("SELECT COUNT(*) AS n FROM play_games").get().n;
    assert.equal(games, 2);
    const review = ctx.db
      .prepare("SELECT review_json FROM play_games WHERE status = 'finished' AND review_json IS NOT NULL")
      .get();
    assert.ok(review.review_json.includes("accuracy"));
  });
});
