/**
 * A small, dependency-free FSRS implementation.
 *
 * The scheduler follows the FSRS-4.5 equations (stability, difficulty,
 * retrievability, lapses, reps) with the published default weights. It is
 * deliberately deterministic: the same card + grade + timestamp always
 * produces the same state, so reviews can be replayed and tested.
 *
 * Grades: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy.
 *
 * A card that is answered correctly is scheduled with its grade. A *wrong*
 * attempt is recorded by the API as a lapse for history/difficulty, but does
 * not advance the schedule or mark the move learned: the training queue keeps
 * the same position until it is solved (audit D007/D008/D022).
 */

export const FSRS_WEIGHTS = Object.freeze([
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
]);

export const RATING_TARGET = 0.9;
export const MASTERY_STABILITY_DAYS = 21;
export const MIN_STABILITY = 0.1;
export const MAX_STABILITY = 36_500;

const DECAY = -0.5;
const FACTOR = 19 / 81;

const w = FSRS_WEIGHTS;

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function gradeOf(value) {
  const n = Math.round(Number(value));
  return n >= 1 && n <= 4 ? n : 3;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function initialDifficulty(grade) {
  const g = gradeOf(grade);
  return clamp(w[4] - (g - 3) * w[5], 1, 10);
}

export function initialStability(grade) {
  const g = gradeOf(grade);
  return clamp(w[g - 1], MIN_STABILITY, MAX_STABILITY);
}

/** Probability of recall after `elapsedDays` at stability `stability`. */
export function retrievability(elapsedDays, stability) {
  const s = Math.max(MIN_STABILITY, num(stability, MIN_STABILITY));
  const t = Math.max(0, num(elapsedDays, 0));
  return (1 + (FACTOR * t) / s) ** DECAY;
}

/** Difficulty after a review. Mean-reverts towards the Good first-rating. */
export function nextDifficulty(difficulty, grade) {
  const g = gradeOf(grade);
  const d = clamp(num(difficulty, initialDifficulty(3)), 1, 10);
  const delta = d - w[6] * (g - 3);
  return clamp(w[7] * initialDifficulty(4) + (1 - w[7]) * delta, 1, 10);
}

export function nextStability({ stability, difficulty, grade, elapsedDays }) {
  const g = gradeOf(grade);
  const s = clamp(num(stability, initialStability(3)), MIN_STABILITY, MAX_STABILITY);
  const d = clamp(num(difficulty, initialDifficulty(3)), 1, 10);
  const r = retrievability(elapsedDays, s);

  if (g === 1) {
    const lapsed = w[11] * d ** -w[12] * ((s + 1) ** w[13] - 1) * Math.exp(w[14] * (1 - r));
    return clamp(Math.min(lapsed, s), MIN_STABILITY, MAX_STABILITY);
  }

  const hardPenalty = g === 2 ? w[15] : 1;
  const easyBonus = g === 4 ? w[16] : 1;
  const grown =
    s *
    (1 +
      Math.exp(w[8]) *
        (11 - d) *
        s ** -w[9] *
        (Math.exp(w[10] * (1 - r)) - 1) *
        hardPenalty *
        easyBonus);
  return clamp(grown, MIN_STABILITY, MAX_STABILITY);
}

/** Days until retrievability falls to the target (default 90%). */
export function nextIntervalDays(stability, target = RATING_TARGET) {
  const s = clamp(num(stability, MIN_STABILITY), MIN_STABILITY, MAX_STABILITY);
  const retention = clamp(num(target, RATING_TARGET), 0.5, 0.99);
  const days = (s / FACTOR) * (retention ** (1 / DECAY) - 1);
  return clamp(days, 0.001, MAX_STABILITY);
}

/**
 * Apply a review to a card.
 *
 * @param {object} card   { stability, difficulty, lapses, reps, state, last_review }
 * @param {number} grade  1..4
 * @param {string} at     ISO timestamp of the review
 * @returns {object} the next card state
 */
export function schedule(card, grade, at = new Date().toISOString()) {
  const g = gradeOf(grade);
  const now = new Date(at);
  const when = Number.isNaN(now.getTime()) ? new Date() : now;
  const reps = Math.max(0, Math.trunc(num(card?.reps, 0)));
  const lapses = Math.max(0, Math.trunc(num(card?.lapses, 0)));
  const previous = card?.last_review ? new Date(card.last_review) : null;
  const elapsedDays =
    previous && !Number.isNaN(previous.getTime())
      ? Math.max(0, (when.getTime() - previous.getTime()) / 86_400_000)
      : 0;

  const isNew = reps === 0 || !card?.stability;
  const difficulty = isNew
    ? initialDifficulty(g)
    : nextDifficulty(card.difficulty, g);
  const stability = isNew
    ? initialStability(g)
    : nextStability({
        stability: card.stability,
        difficulty: card.difficulty,
        grade: g,
        elapsedDays,
      });

  const intervalDays = nextIntervalDays(stability);
  const nextLapses = g === 1 ? lapses + 1 : lapses;
  const state = g === 1 ? (reps === 0 ? "learning" : "relearning") : "review";
  const dueAt = new Date(when.getTime() + intervalDays * 86_400_000).toISOString();

  return {
    stability: round(stability, 4),
    difficulty: round(difficulty, 4),
    lapses: nextLapses,
    reps: reps + 1,
    state,
    lastReview: when.toISOString(),
    dueAt,
    intervalDays: round(intervalDays, 3),
    elapsedDays: round(elapsedDays, 3),
    retrievability: round(retrievability(elapsedDays, card?.stability || stability), 4),
    grade: g,
  };
}

/**
 * A wrong attempt is a lapse for history and difficulty, but it must not
 * change `due_at`, `stability`, `reps` or `learned` (the position stays in
 * the queue). This is intentionally not the same as FSRS grade 1.
 */
export function lapse(card, at = new Date().toISOString()) {
  const when = new Date(at);
  const current = clamp(num(card?.difficulty, initialDifficulty(3)), 1, 10);
  return {
    difficulty: round(nextDifficulty(current, 1), 4),
    lapses: Math.max(0, Math.trunc(num(card?.lapses, 0))) + 1,
    lastReview: (Number.isNaN(when.getTime()) ? new Date() : when).toISOString(),
    lastCorrect: 0,
  };
}

export function isMastered(stability) {
  return num(stability, 0) >= MASTERY_STABILITY_DAYS;
}

/**
 * Training rating (audit D010). Glicko-lite and deterministic: a saved move's
 * difficulty (1..10) is treated as a problem rating, and each review is one
 * game. Correct answers raise the rating, misses lower it, and the deviation
 * shrinks as the player accumulates evidence.
 */
export function updateTrainingRating(
  profile = {},
  { correct = false, difficulty = 5 } = {}
) {
  const rating = clamp(num(profile.rating, 1200), 100, 3000);
  const deviation = clamp(num(profile.deviation, 350), 30, 350);
  const volatility = clamp(num(profile.volatility, 0.06), 0.01, 0.2);

  const problemRating = 900 + clamp(num(difficulty, 5), 1, 10) * 100;
  const expected = 1 / (1 + 10 ** ((problemRating - rating) / 400));
  const score = correct ? 1 : 0;
  const k = clamp(deviation * 0.1, 8, 32);

  const nextRating = clamp(rating + k * (score - expected), 100, 3000);
  const surprise = Math.abs(score - expected);
  const nextDeviation = clamp(
    deviation * 0.97 + (surprise > 0.5 ? 2 : -1),
    30,
    350
  );
  const nextVolatility = clamp(
    volatility + (surprise - 0.25) * 0.002,
    0.01,
    0.2
  );

  return {
    rating: round(nextRating, 1),
    deviation: round(nextDeviation, 1),
    volatility: round(nextVolatility, 4),
  };
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
