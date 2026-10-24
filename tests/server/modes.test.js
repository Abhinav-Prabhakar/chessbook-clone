import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { startTestServer } from "./helpers.js";

/**
 * Follow-up server coverage (D012/D016/D020/D052/D053/D090/D135/D140/D156).
 */
let ctx;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  if (ctx) await ctx.close();
});

async function makeOneDue(repertoire = "white") {
  const started = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire,
    mode: "all",
  });
  // Advance past the shared 1.e4 root so the kept position belongs to a
  // smaller subtree (the Sicilian Nf3 positions).
  await ctx.apiOk("POST", `/practice/sessions/${started.session.id}/attempt`, {
    san: started.task.expectedSan,
    submissionId: `due-first-${Date.now()}`,
  });
  const kept = await ctx.apiOk("POST", `/practice/sessions/${started.session.id}/keep`);
  return kept;
}

test("rating, coverage, review and notification preferences round-trip (D135/D197)", async () => {
  const initial = await ctx.apiOk("GET", "/settings");
  assert.equal(initial.settings.ratingSystem, "Chess.com");
  assert.ok(initial.availablePieceSets.length >= 2);
  assert.equal(initial.availablePieceSets[0].id, "chessbook_monochrome");
  assert.ok(initial.availablePieceSets.every((set) => set.available && set.license && set.attribution));
  assert.ok(initial.availablePieceSets.some((set) => set.id === "cburnett"));
  assert.equal(initial.settings.pieceSet, "chessbook_monochrome");
  assert.ok(initial.boardThemes.includes("lichess-green"));

  const patched = await ctx.apiOk("PATCH", "/settings", {
    ratingSystem: "Lichess",
    timeControl: "Rapid",
    singleElo: 2150,
    coverageGoal: 100,
    practiceMode: "whole-lines",
    reviewStyle: "complete-every",
    pauseAfterMove: 2,
    pauseOnFail: false,
    pauseOnLowScore: true,
    pauseWhenNote: true,
    animation: "fast",
    haptics: false,
    soundVolume: 40,
    recommendedMovesSize: "large",
    notifications: { dailyPractice: true, mistakes: false },
    soundEffects: { move: false },
    pieceSet: "merida",
  });
  assert.equal(patched.settings.ratingSystem, "Lichess");
  assert.equal(patched.settings.timeControl, "Rapid");
  assert.equal(patched.settings.singleElo, 2150);
  assert.equal(patched.settings.eloRange, "2000-2200");
  assert.equal(patched.settings.coverageGoal, 100);
  assert.equal(patched.settings.reviewStyle, "complete-every");
  assert.equal(patched.settings.pauseAfterMove, 2);
  assert.equal(patched.settings.pauseOnFail, false);
  assert.equal(patched.settings.pauseOnLowScore, true);
  assert.equal(patched.settings.pauseWhenNote, true);
  assert.equal(patched.settings.soundVolume, 40);
  assert.equal(patched.settings.recommendedMovesSize, "large");
  assert.equal(patched.settings.notifications.dailyPractice, true);
  assert.equal(patched.settings.notifications.mistakes, false);
  assert.equal(patched.settings.soundEffects.move, false);
  assert.equal(patched.settings.pieceSet, "merida");

  const again = await ctx.apiOk("GET", "/settings");
  assert.equal(again.settings.reviewStyle, "complete-every");

  const me = await ctx.apiOk("GET", "/me");
  assert.equal(me.user.profile.ratingSystem, "Lichess");
  assert.equal(me.user.profile.singleElo, 2150);
  assert.equal(me.user.profile.coverageGoal, 100);
  assert.equal(me.user.ratingBand.matches, true);

  // PATCH /user writes through the same store (no second source of truth).
  const viaUser = await ctx.apiOk("PATCH", "/user", {
    ratingSystem: "Chess.com",
    singleElo: 1810,
  });
  assert.equal(viaUser.user.profile.singleElo, 1810);
  assert.equal(viaUser.user.profile.eloRange, "1800-2000");
  const settingsAfter = await ctx.apiOk("GET", "/settings");
  assert.equal(settingsAfter.settings.ratingSystem, "Chess.com");

  // Restore a deterministic profile for the following tests.
  await ctx.apiOk("PATCH", "/settings", {
    ratingSystem: "Chess.com",
    singleElo: 1900,
    coverageGoal: 50,
    practiceMode: "individual",
    reviewStyle: "cards",
    pauseAfterMove: 0,
    pauseOnFail: true,
    pauseOnLowScore: false,
    pauseWhenNote: false,
    animation: "normal",
    haptics: true,
    soundVolume: 70,
    recommendedMovesSize: "comfortable",
    notifications: { dailyPractice: false, mistakes: true },
    pieceSet: "chessbook_monochrome",
  });
});

test("the rating band gates band-specific incidence (D135)", async () => {
  const matched = await ctx.apiOk("GET", "/repertoires/white/candidates?moves=e4");
  assert.equal(matched.position.ratingBand.profile.matches, true);
  const sicilian = matched.candidates.find((candidate) => candidate.san === "c5");
  assert.ok(sicilian);
  assert.ok(sicilian.incidenceAvailable);
  assert.ok(sicilian.incidence > 0);

  await ctx.apiOk("PATCH", "/settings", { singleElo: 2600 });
  const mismatched = await ctx.apiOk("GET", "/repertoires/white/candidates?moves=e4");
  assert.equal(mismatched.position.ratingBand.profile.matches, false);
  const hidden = mismatched.candidates.find((candidate) => candidate.san === "c5");
  assert.ok(hidden);
  // The capture is for 1800-2000, so its band-specific numbers are hidden.
  // Incidence can still come from the masters corpus (labelled as such).
  assert.ok(hidden.incidence != null);
  assert.ok(["lichess-band", "pgnmentor-masters"].includes(hidden.incidenceSource));
  assert.equal(hidden.realIncidenceAvailable, true);
  assert.ok(hidden.capturedIncidence > 0);

  await ctx.apiOk("PATCH", "/settings", { singleElo: 1900 });
});

test("next common moves are derived from captured incidence (D016)", async () => {
  const learn = await ctx.apiOk("GET", "/repertoires/white/learn");
  assert.ok(learn.common > 0);
  assert.match(learn.commonSource, /captured-position-incidence/);
  const session = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "common",
  });
  assert.equal(session.session.mode, "common");
  assert.ok(session.session.total > 0);
  assert.ok(Array.isArray(session.commonMoves));
  assert.ok(session.commonMoves.length > 0);
  for (const entry of session.commonMoves) {
    assert.ok(entry.via.incidence >= 1 / learn.coverageGoal);
    assert.ok(entry.via.oneIn >= 1);
  }
  assert.ok(session.task);
  assert.ok(session.task.common?.via?.san);
  assert.ok(session.task.common.via.incidence > 0);
});

test("review styles change the session queue (D012/D140)", async () => {
  await ctx.apiOk("POST", "/repertoires/white/reset");
  const kept = await makeOneDue();
  assert.ok(kept.session.remaining >= 1);

  const cards = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "due",
    style: "cards",
    practiceMode: "individual",
  });
  assert.equal(cards.session.style, "cards");
  assert.equal(cards.session.total, 1);

  const whole = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "due",
    style: "cards",
    practiceMode: "whole-lines",
  });
  assert.equal(whole.session.practiceMode, "whole-lines");
  assert.ok(whole.session.total > 1);
  assert.ok(whole.session.total > cards.session.total);

  const entire = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "due",
    style: "entire-line",
  });
  assert.equal(entire.session.style, "entire-line");
  assert.ok(entire.session.total > whole.session.total);

  // complete-every replays the line after a wrong answer.
  const every = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "due",
    style: "complete-every",
  });
  assert.equal(every.session.style, "complete-every");
  const before = every.session.total;
  const wrong = await ctx.apiOk(
    "POST",
    `/practice/sessions/${every.session.id}/attempt`,
    { san: "h3", submissionId: `style-wrong-${Date.now()}` }
  );
  assert.equal(wrong.correct, false);
  assert.ok(wrong.session.replays >= 1);
  assert.ok(wrong.session.total >= before);
});

test("card state is real FSRS data and grades are recorded (D090)", async () => {
  await ctx.apiOk("POST", "/repertoires/white/reset");
  const session = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "all",
    style: "cards",
  });
  assert.equal(session.task.card.difficulty, 5);
  assert.equal(session.task.card.reviewed, false);
  assert.ok(session.task.card.expectedWrongPercent >= 1);

  const first = await ctx.apiOk("POST", `/practice/sessions/${session.session.id}/attempt`, {
    san: session.task.expectedSan,
    submissionId: `card-correct-${Date.now()}`,
  });
  assert.equal(first.correct, true);
  assert.equal(first.card.grade, 3);
  assert.ok(first.card.reviewed);
  assert.ok(first.card.reps >= 1);
  assert.ok(first.card.difficulty > 0);
  assert.ok(first.scheduled.dueAt);

  // A wrong answer produces a lapse card and no schedule.
  const wrong = await ctx.apiOk("POST", `/practice/sessions/${session.session.id}/attempt`, {
    san: "h3",
    submissionId: `card-wrong-${Date.now()}`,
  });
  assert.equal(wrong.correct, false);
  assert.equal(wrong.scheduled, null);
  assert.ok(wrong.card.lapses >= 1);
  assert.ok(wrong.card.expectedWrong > 0);
});

test("wrong moves return a real, legal refutation (D020)", async () => {
  const session = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "all",
    style: "cards",
  });
  const wrong = await ctx.apiOk(
    "POST",
    `/practice/sessions/${session.session.id}/attempt`,
    { san: "h3", submissionId: `refute-wrong-${Date.now()}` }
  );
  assert.equal(wrong.correct, false);
  assert.equal(wrong.refutation.available, true);
  assert.match(wrong.refutation.engine, /Stockfish|heuristic/i);
  assert.ok(["stockfish", "heuristic"].includes(wrong.refutation.source));
  assert.ok(wrong.refutation.from && wrong.refutation.to);
  assert.ok(wrong.refutation.explanation.length > 0);
  const probe = new Chess(wrong.refutation.fen);
  const reply = probe.move(wrong.refutation.san);
  assert.equal(reply.from, wrong.refutation.from);
  assert.equal(reply.to, wrong.refutation.to);
});

test("the refutation search finds a hanging queen", async () => {
  const { refuteMove } = await import("../../server/refutation.js");
  const result = await refuteMove(
    ctx.db,
    "k2r4/7p/8/8/8/8/7P/K2Q4 w - - 0 1",
    "Qd4",
    { expectedSan: "Qxd8+" }
  );
  assert.equal(result.available, true);
  assert.equal(result.san, "Rxd4");
  assert.equal(result.captured, "q");
  assert.ok(result.damagePawns > 0);
  assert.ok(result.explanation.includes("Rxd4"));
});

test("branch disable is reversible and removes the subtree from play (D052)", async () => {
  await ctx.apiOk("POST", "/repertoires/white/reset");
  const before = (await ctx.apiOk("GET", "/repertoires/white")).repertoire;

  // Record a correct review so we can prove review state survives disable/enable.
  const session = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "all",
  });
  await ctx.apiOk("POST", `/practice/sessions/${session.session.id}/attempt`, {
    san: session.task.expectedSan,
    submissionId: `disable-review-${Date.now()}`,
  });

  const disabled = await ctx.apiOk("POST", "/repertoires/white/branches/disable", {
    epd: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -",
    san: "c5",
  });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.disabled.lineCount, 4);
  assert.ok(disabled.state.moves > 0);
  assert.ok(disabled.repertoire.moveCount < before.moveCount);

  const disabledList = await ctx.apiOk("GET", "/repertoires/white/branches");
  assert.equal(disabledList.disabled.length, 1);
  assert.equal(disabledList.lines.length, 4);

  const queue = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "all",
  });
  assert.ok(queue.session.total < before.positionCount);

  const enabled = await ctx.apiOk("POST", "/repertoires/white/branches/enable", {
    epd: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -",
    san: "c5",
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.repertoire.moveCount, before.moveCount);
  assert.equal(enabled.repertoire.learned, disabled.repertoire.learned);
  const after = (await ctx.apiOk("GET", "/repertoires/white")).repertoire;
  assert.equal(after.learned, disabled.repertoire.learned);
  assert.equal(after.moveCount, before.moveCount);
});

test("batch remove resolves branches, is transactional and undoable (D053)", async () => {
  const response = await ctx.apiOk("GET", "/repertoires/white");
  const line = response.lines.find((entry) => entry.moves.includes("c5"));
  const sibling = response.lines.find((entry) => entry.id !== line.id);

  const dry = await ctx.apiOk("DELETE", "/repertoires/white/branches", {
    lineIds: [line.id, sibling.id],
    dryRun: true,
  });
  assert.equal(dry.removedCount, 2);
  assert.equal(dry.snapshot.lines.length, 2);
  assert.equal(dry.repertoire.saved, response.repertoire.saved);

  const removed = await ctx.apiOk("DELETE", "/repertoires/white/branches", {
    branches: [{ epd: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -", san: "Nf3" }],
  });
  assert.ok(removed.removedCount >= 1);
  assert.ok(removed.repertoire.saved < response.repertoire.saved);

  const restored = await ctx.apiOk("POST", "/repertoires/white/branches/restore", {
    lines: removed.snapshot.lines,
  });
  assert.ok(restored.restored.length >= 1);
  assert.equal(restored.repertoire.saved, response.repertoire.saved);
});

test("session style and practice mode are persisted on resume", async () => {
  const created = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "all",
    style: "entire-line",
    practiceMode: "whole-lines",
  });
  assert.equal(created.session.style, "entire-line");
  assert.equal(created.session.practiceMode, "whole-lines");

  await ctx.apiOk("POST", `/practice/sessions/${created.session.id}/pause`);
  const reloaded = await ctx.apiOk(
    "GET",
    `/practice/sessions/${created.session.id}`
  );
  assert.equal(reloaded.session.id, created.session.id);
  assert.equal(reloaded.session.style, "entire-line");
  assert.equal(reloaded.session.practiceMode, "whole-lines");
});
