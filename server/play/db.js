import { db } from "../db.js";

/**
 * Self-contained schema for the play pillars (training games, puzzles,
 * intuition, visualization, vision). It uses its own tables and never touches
 * `server/schema.js` or `PRAGMA user_version`, so it can coexist with the
 * training-engine migrations (audit D198/D200).
 */
export function ensurePlaySchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS play_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      time_control TEXT NOT NULL,
      initial_ms INTEGER NOT NULL,
      increment_ms INTEGER NOT NULL,
      player_color TEXT NOT NULL CHECK (player_color IN ('white', 'black')),
      start_fen TEXT NOT NULL,
      fen TEXT NOT NULL,
      moves_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      result TEXT,
      result_reason TEXT,
      white_ms INTEGER NOT NULL,
      black_ms INTEGER NOT NULL,
      turn_started_at TEXT NOT NULL,
      review_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS play_drills (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      feature TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      result_json TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS play_profiles (
      user_id INTEGER NOT NULL,
      feature TEXT NOT NULL,
      rating REAL NOT NULL,
      games INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, feature)
    );

    CREATE TABLE IF NOT EXISTS play_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      feature TEXT NOT NULL,
      item_key TEXT,
      correct INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_play_games_user ON play_games(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_play_drills_user ON play_drills(user_id, feature, status);
    CREATE INDEX IF NOT EXISTS idx_play_attempts_user ON play_attempts(user_id, feature, created_at);
  `);
}

ensurePlaySchema();

export const PLAY_FEATURES = ["training", "puzzles", "intuition", "visualization", "vision"];

const DEFAULT_RATINGS = {
  training: 1200,
  puzzles: 1200,
  intuition: 1000,
  visualization: 1000,
  vision: 1000,
};

export const nowIso = () => new Date().toISOString();

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parsed(value, fallback) {
  if (!value) return fallback;
  try {
    const data = JSON.parse(value);
    return data ?? fallback;
  } catch {
    return fallback;
  }
}

export function ensureProfile(userId, feature) {
  const existing = db
    .prepare("SELECT * FROM play_profiles WHERE user_id = ? AND feature = ?")
    .get(userId, feature);
  if (existing) return existing;
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO play_profiles
       (user_id, feature, rating, games, attempts, correct, total, streak, best_streak, data_json, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, '{}', ?, ?)`
  ).run(userId, feature, DEFAULT_RATINGS[feature] ?? 1000, stamp, stamp);
  return db
    .prepare("SELECT * FROM play_profiles WHERE user_id = ? AND feature = ?")
    .get(userId, feature);
}

export function profileFor(userId, feature) {
  const row = ensureProfile(userId, feature);
  return {
    feature: row.feature,
    rating: Math.round(Number(row.rating) * 10) / 10,
    games: Number(row.games),
    attempts: Number(row.attempts),
    correct: Number(row.correct),
    total: Number(row.total),
    streak: Number(row.streak),
    bestStreak: Number(row.best_streak),
    data: parsed(row.data_json, {}),
    updatedAt: row.updated_at,
  };
}

export function allProfiles(userId) {
  const out = {};
  for (const feature of PLAY_FEATURES) out[feature] = profileFor(userId, feature);
  return out;
}

/** Elo/Glicko-lite rating update against a problem rating. */
export function updatedRating(rating, opponentRating, score, k = 28) {
  const expected = 1 / (1 + 10 ** ((Number(opponentRating) - Number(rating)) / 400));
  const next = Number(rating) + k * (clamp(Number(score) || 0, 0, 1) - expected);
  return Math.round(clamp(next, 400, 3000) * 10) / 10;
}

/**
 * Persist a feature result. `score` is 0..1 (per item), `perfect` controls the
 * streak (a partially solved drill does not extend it).
 */
export function recordProfileResult(
  userId,
  feature,
  {
    score = 0,
    opponentRating = null,
    k = 28,
    perfect = null,
    gamesDelta = 0,
    data = null,
    attempt = null,
  } = {}
) {
  const profile = profileFor(userId, feature);
  const numericScore = clamp(Number(score) || 0, 0, 1);
  const rating =
    opponentRating == null
      ? profile.rating
      : updatedRating(profile.rating, opponentRating, numericScore, k);
  const isPerfect = perfect == null ? numericScore >= 1 : Boolean(perfect);
  const streak = isPerfect ? profile.streak + 1 : 0;
  const bestStreak = Math.max(profile.bestStreak, streak);
  const merged = { ...profile.data, ...(data || {}) };
  const stamp = nowIso();
  db.prepare(
    `UPDATE play_profiles
       SET rating = ?, games = games + ?, attempts = attempts + 1, correct = correct + ?,
           total = total + 1, streak = ?, best_streak = ?, data_json = ?, updated_at = ?
     WHERE user_id = ? AND feature = ?`
  ).run(
    rating,
    gamesDelta,
    isPerfect ? 1 : 0,
    streak,
    bestStreak,
    JSON.stringify(merged),
    stamp,
    userId,
    feature
  );
  if (attempt) {
    recordAttempt(userId, feature, { ...attempt, correct: isPerfect, score: Math.round(numericScore * 100) });
  }
  return profileFor(userId, feature);
}

export function recordAttempt(userId, feature, { itemKey = null, correct = false, score = 0, detail = null } = {}) {
  db.prepare(
    `INSERT INTO play_attempts (user_id, feature, item_key, correct, score, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    feature,
    itemKey,
    correct ? 1 : 0,
    Math.round(Number(score) || 0),
    detail ? JSON.stringify(detail) : null,
    nowIso()
  );
}

export function recentAttempts(userId, feature, limit = 10) {
  return db
    .prepare(
      `SELECT id, item_key AS itemKey, correct, score, detail_json AS detailJson, created_at AS createdAt
       FROM play_attempts WHERE user_id = ? AND feature = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(userId, feature, limit)
    .map((row) => ({
      id: row.id,
      itemKey: row.itemKey,
      correct: Boolean(row.correct),
      score: row.score,
      detail: parsed(row.detailJson, null),
      createdAt: row.createdAt,
    }));
}

export function solvedKeys(userId, feature) {
  return new Set(
    db
      .prepare(
        `SELECT DISTINCT item_key FROM play_attempts
         WHERE user_id = ? AND feature = ? AND correct = 1 AND item_key IS NOT NULL`
      )
      .all(userId, feature)
      .map((row) => row.item_key)
  );
}

export function createDrill({ id, userId, feature, kind, payload }) {
  db.prepare(
    `INSERT INTO play_drills (id, user_id, feature, kind, payload_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?)`
  ).run(id, userId, feature, kind, JSON.stringify(payload), nowIso());
  return id;
}

export function getDrill(id, userId, feature = null) {
  const row = db
    .prepare("SELECT * FROM play_drills WHERE id = ? AND user_id = ?")
    .get(id, userId);
  if (!row) return null;
  if (feature && row.feature !== feature) return null;
  return {
    id: row.id,
    userId: row.user_id,
    feature: row.feature,
    kind: row.kind,
    status: row.status,
    payload: parsed(row.payload_json, {}),
    result: parsed(row.result_json, null),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function finishDrill(id, userId, result) {
  db.prepare(
    `UPDATE play_drills SET status = 'answered', result_json = ?, completed_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(JSON.stringify(result), nowIso(), id, userId);
}

export { db };
