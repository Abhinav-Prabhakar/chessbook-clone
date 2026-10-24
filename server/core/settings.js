import { db } from "./db.js";

export const BOARD_THEMES = ["green", "blue", "brown", "gray", "purple"];
export const PIECE_SETS = ["chessbook_monochrome", "cburnett", "merida", "chessnut", "shapes"];
export const RATING_SYSTEMS = ["lichess", "chesscom", "fide"];
export const COVERAGE_GOALS = [20, 50, 100, 200, 500];
export const ANIMATIONS = ["off", "fast", "normal", "slow"];
export const TIME_CONTROLS = ["bullet", "blitz", "rapid", "classical"];
export const REVIEW_STYLES = ["selective", "every", "once"];
export const PAUSE_BEHAVIORS = ["never", "always", "when-wrong", "when-annotation"];
export const SESSION_SIZES = [10, 20, 50];

export const DEFAULTS = {
  rating: 1500,
  ratingSystem: "chesscom",
  timeControl: "blitz",
  coverageGoal: 100,
  boardTheme: "green",
  pieceSet: "chessbook_monochrome",
  coordinates: true,
  legalMoves: true,
  sound: true,
  animation: "normal",
  dailyGoal: 10,
  reviewStyle: "selective",
  reviewPauseBehavior: "never",
  skipFirstPractice: false,
  onboarded: false,
  modelSide: "repertoire",
};

const VALIDATORS = {
  rating: (v) => Number.isFinite(Number(v)) && Number(v) >= 400 && Number(v) <= 3200,
  ratingSystem: (v) => RATING_SYSTEMS.includes(v),
  timeControl: (v) => TIME_CONTROLS.includes(v),
  coverageGoal: (v) => COVERAGE_GOALS.includes(Number(v)),
  boardTheme: (v) => BOARD_THEMES.includes(v),
  pieceSet: (v) => PIECE_SETS.includes(v),
  coordinates: (v) => typeof v === "boolean",
  legalMoves: (v) => typeof v === "boolean",
  sound: (v) => typeof v === "boolean",
  animation: (v) => ANIMATIONS.includes(v),
  dailyGoal: (v) => SESSION_SIZES.includes(Number(v)),
  reviewStyle: (v) => REVIEW_STYLES.includes(v),
  reviewPauseBehavior: (v) => PAUSE_BEHAVIORS.includes(v),
  skipFirstPractice: (v) => typeof v === "boolean",
  onboarded: (v) => typeof v === "boolean",
  modelSide: (v) => ["repertoire", "white", "black"].includes(v),
};

const NUMERIC = new Set(["rating", "coverageGoal", "dailyGoal"]);

export function readSettings() {
  const out = { ...DEFAULTS };
  for (const row of db.prepare("SELECT key, value FROM settings").all()) {
    if (!(row.key in DEFAULTS)) continue;
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      // keep default
    }
  }
  // Values saved by older versions fall back to the defaults.
  for (const [key, valid] of Object.entries(VALIDATORS)) {
    if (!valid(NUMERIC.has(key) ? Number(out[key]) : out[key])) out[key] = DEFAULTS[key];
  }
  return out;
}

export function writeSettings(patch = {}) {
  const errors = [];
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  for (const [key, raw] of Object.entries(patch)) {
    if (!(key in VALIDATORS)) {
      errors.push(`Unknown setting: ${key}`);
      continue;
    }
    const value = NUMERIC.has(key) ? Number(raw) : raw;
    if (!VALIDATORS[key](value)) {
      errors.push(`Invalid value for ${key}`);
      continue;
    }
    upsert.run(key, JSON.stringify(value));
  }
  return { settings: readSettings(), errors };
}

/** Convert the user's rating to an approximate Lichess blitz/rapid rating. */
export function lichessEquivalent({ rating, ratingSystem, timeControl } = readSettings()) {
  const r = Number(rating) || 1500;
  let value = r;
  if (ratingSystem === "chesscom") {
    // Chess.com ratings sit below Lichess, most of all at lower levels and in
    // rapid; the gap is smaller in bullet and blitz.
    value = timeControl === "rapid" || timeControl === "classical" ? r * 0.72 + 620 : r * 0.75 + 520;
  } else if (ratingSystem === "fide") {
    value = r * 0.8 + 450;
  }
  return Math.round(value);
}

export const BANDS = ["<1200", "1200-1599", "1600-1799", "1800-1999", "2000-2399", "2400+"];

export function bandFor(lichessRating) {
  const r = Number(lichessRating) || 1700;
  if (r < 1200) return "<1200";
  if (r < 1600) return "1200-1599";
  if (r < 1800) return "1600-1799";
  if (r < 2000) return "1800-1999";
  if (r < 2400) return "2000-2399";
  return "2400+";
}

export function userBand(settings = readSettings()) {
  return bandFor(lichessEquivalent(settings));
}
