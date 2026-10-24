import test from "node:test";
import assert from "node:assert/strict";
import {
  FSRS_WEIGHTS,
  MASTERY_STABILITY_DAYS,
  initialDifficulty,
  initialStability,
  isMastered,
  lapse,
  nextIntervalDays,
  nextStability,
  retrievability,
  schedule,
  updateTrainingRating,
} from "../../server/srs.js";
import { computeStreak, localDay, shiftDay, toIso } from "../../server/dates.js";

test("FSRS starts from the documented weights and grades", () => {
  assert.equal(FSRS_WEIGHTS.length, 17);
  assert.equal(initialStability(3), 3.7145);
  assert.ok(initialStability(1) < initialStability(2));
  assert.ok(initialStability(2) < initialStability(3));
  assert.ok(initialStability(3) < initialStability(4));
  assert.equal(initialDifficulty(3), 5.1618);
  assert.ok(initialDifficulty(1) > initialDifficulty(3));
  assert.ok(initialDifficulty(4) < initialDifficulty(3));
});

test("retrievability is 1 at zero elapsed time and ~0.9 at the stability interval", () => {
  assert.equal(retrievability(0, 10), 1);
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 0.002);
  assert.ok(retrievability(30, 10) < retrievability(10, 10));
});

test("a new Good review is scheduled a stability-sized interval in the future", () => {
  const at = "2026-01-01T00:00:00.000Z";
  const next = schedule({ stability: 0, difficulty: 0, lapses: 0, reps: 0, state: "new" }, 3, at);
  assert.equal(next.reps, 1);
  assert.equal(next.lapses, 0);
  assert.equal(next.state, "review");
  assert.equal(next.stability, 3.7145);
  assert.ok(next.intervalDays > 3 && next.intervalDays < 4);
  assert.ok(Date.parse(next.dueAt) > Date.parse(at));
  assert.equal(next.lastReview, at);
  assert.equal(next.grade, 3);
});

test("scheduling is deterministic and successful reviews grow stability", () => {
  const first = schedule({ stability: 0, difficulty: 0, lapses: 0, reps: 0 }, 3, "2026-01-01T00:00:00.000Z");
  const again = schedule({ stability: 0, difficulty: 0, lapses: 0, reps: 0 }, 3, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(first, again);

  const second = schedule(
    { stability: first.stability, difficulty: first.difficulty, reps: 1, lapses: 0, last_review: first.lastReview },
    3,
    first.dueAt
  );
  assert.ok(second.stability > first.stability, `${second.stability} > ${first.stability}`);
  assert.ok(second.intervalDays > first.intervalDays);
  assert.equal(second.reps, 2);
});

test("grade 1 lapses reduce stability and record the lapse", () => {
  const card = { stability: 30, difficulty: 6, reps: 3, lapses: 1, last_review: "2025-12-01T00:00:00.000Z" };
  const next = schedule(card, 1, "2026-01-01T00:00:00.000Z");
  assert.ok(next.stability < 30);
  assert.ok(next.stability >= 0.1);
  assert.equal(next.lapses, 2);
  assert.equal(next.state, "relearning");
});

test("hard and easy grades bracket good", () => {
  const base = { stability: 10, difficulty: 5, reps: 2, last_review: "2025-12-25T00:00:00.000Z" };
  const hard = schedule(base, 2, "2026-01-01T00:00:00.000Z");
  const good = schedule(base, 3, "2026-01-01T00:00:00.000Z");
  const easy = schedule(base, 4, "2026-01-01T00:00:00.000Z");
  assert.ok(hard.stability < good.stability);
  assert.ok(easy.stability > good.stability);
  assert.ok(easy.difficulty < good.difficulty);
});

test("a wrong attempt only penalises difficulty and lapses (never scheduling)", () => {
  const card = { stability: 12, difficulty: 5, reps: 2, lapses: 0 };
  const next = lapse(card, "2026-01-01T00:00:00.000Z");
  assert.ok(next.difficulty >= 5);
  assert.equal(next.lapses, 1);
  assert.equal(next.lastCorrect, 0);
  assert.equal(next.dueAt, undefined);
  assert.equal(next.stability, undefined);
  assert.equal(next.reps, undefined);
});

test("mastery uses the 21-day stability threshold", () => {
  assert.equal(isMastered(MASTERY_STABILITY_DAYS), true);
  assert.equal(isMastered(MASTERY_STABILITY_DAYS - 0.1), false);
  assert.ok(nextIntervalDays(MASTERY_STABILITY_DAYS) > 20);
});

test("training rating moves in the right direction and narrows deviation", () => {
  const profile = { rating: 1200, deviation: 350, volatility: 0.06 };
  const win = updateTrainingRating(profile, { correct: true, difficulty: 5 });
  const loss = updateTrainingRating(profile, { correct: false, difficulty: 5 });
  assert.ok(win.rating > 1200);
  assert.ok(loss.rating < 1200);
  assert.ok(win.deviation < 350);
  assert.ok(loss.deviation < 350);
});

test("streaks survive a day ending yesterday and are computed in the requested timezone", () => {
  const today = "2026-10-24";
  const endingYesterday = computeStreak(["2026-10-22", "2026-10-23"], -330, today);
  assert.equal(endingYesterday.current, 2);
  assert.equal(endingYesterday.highest, 2);
  assert.equal(endingYesterday.lastStreakDate, "2026-10-23");

  const endedTwoDaysAgo = computeStreak(["2026-10-21", "2026-10-22"], -330, today);
  assert.equal(endedTwoDaysAgo.current, 0);
  assert.equal(endedTwoDaysAgo.highest, 2);

  const withGap = computeStreak(["2026-10-20", "2026-10-22", "2026-10-23", "2026-10-24"], -330, today);
  assert.equal(withGap.current, 3);
  assert.equal(withGap.highest, 3);

  assert.equal(shiftDay(today, -1), "2026-10-23");
  assert.equal(localDay("2026-10-23T20:00:00.000Z", -330), "2026-10-24");
  assert.equal(localDay("2026-10-23T20:00:00.000Z", 600), "2026-10-23");
});

test("date normalisation rejects junk and always emits UTC", () => {
  assert.equal(toIso("2026-01-01T05:30:00+05:30"), "2026-01-01T00:00:00.000Z");
  assert.equal(toIso("not a date"), null);
  assert.equal(toIso(null), null);
});

test("nextStability never goes below the minimum", () => {
  const value = nextStability({
    stability: 0.1,
    difficulty: 10,
    grade: 1,
    elapsedDays: 1000,
  });
  assert.ok(value >= 0.1);
});
