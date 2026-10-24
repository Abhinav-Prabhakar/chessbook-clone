/**
 * Server-side preferences and the rating/coverage profile (D135/D197).
 *
 * `settings` is the single source of truth for every preference that changes
 * behaviour. The client keeps a localStorage mirror only so the board/sounds
 * can read values synchronously; writes always go through `PATCH /settings`.
 */

export const PLATFORMS = ["Chess.com", "Lichess", "FIDE", "USCF"];
export const TIME_CONTROLS = ["Bullet", "Blitz", "Rapid", "Classical"];
export const BOARD_THEMES = ["green", "blue", "brown", "lichess-green", "chesscom-green"];
export const REVIEW_STYLES = ["cards", "complete-once", "complete-every", "entire-line"];
export const PRACTICE_MODES = ["individual", "whole-lines"];
export const ANIMATIONS = ["off", "fast", "normal"];
export const RECOMMENDED_SIZES = ["compact", "comfortable", "large"];
export const PIECE_SETS = [
  {
    id: "chessbook_monochrome",
    name: "Chessbook Monochrome",
    label: "Chessbook Monochrome",
    available: true,
    source: "pieces/chessbook_monochrome",
    attribution: "Bundled with this local Chessbook build",
    license: "Project assets",
  },
  {
    id: "cburnett",
    name: "Cburnett",
    label: "Cburnett",
    available: true,
    source: "pieces/cburnett",
    attribution: "Colin M.L. Burnett",
    license: "GPLv2+",
  },
  {
    id: "merida",
    name: "Merida",
    label: "Merida",
    available: true,
    source: "pieces/merida",
    attribution: "Armando Hernandez Marroquin",
    license: "GPLv2+",
  },
  {
    id: "chessnut",
    name: "Chessnut",
    label: "Chessnut",
    available: true,
    source: "pieces/chessnut",
    attribution: "Alexis Luengas",
    license: "Apache 2.0",
  },
  {
    id: "shapes",
    name: "Shapes",
    label: "Shapes",
    available: true,
    source: "pieces/shapes",
    attribution: "flugsio (chess_shapes)",
    license: "CC BY-SA 4.0",
  },
];
export const COVERAGE_OPTIONS = [25, 50, 100, 200, 500];

export const DEFAULT_PREFERENCES = {
  boardTheme: "green",
  coordinates: true,
  legalMoves: true,
  sound: true,
  showHints: true,
  dailyGoal: 50,
  modelSource: "historical",
  ratingSystem: "Chess.com",
  timeControl: "Blitz",
  singleElo: 1800,
  eloRange: "1800-2000",
  coverageGoal: 50,
  practiceMode: "individual",
  reviewStyle: "cards",
  pauseAfterMove: 0,
  pauseOnFail: true,
  pauseOnLowScore: false,
  pauseWhenNote: false,
  animation: "normal",
  haptics: true,
  pieceSet: "chessbook_monochrome",
  soundVolume: 70,
  soundEffects: {
    move: true,
    capture: true,
    check: true,
    correct: true,
    wrong: true,
    notify: true,
  },
  recommendedMovesSize: "comfortable",
  notifications: {
    dailyPractice: false,
    streak: false,
    modelGame: false,
    mistakes: true,
  },
};

const bool = (value) => Number(value) === 1;

function json(value, fallback) {
  if (value && typeof value === "object") return { ...fallback, ...value };
  try {
    const parsed = JSON.parse(value || "null");
    return parsed && typeof parsed === "object" ? { ...fallback, ...parsed } : fallback;
  } catch {
    return fallback;
  }
}

export function bandFromValue(value) {
  const numeric = Math.max(400, Math.min(3500, Number(value) || 1800));
  const low = Math.max(400, Math.floor(numeric / 200) * 200);
  return `${low}-${low + 200}`;
}

export function parseBand(value) {
  const match = String(value || "").match(/(\d{3,4})\s*-\s*(\d{3,4})/);
  if (!match) return null;
  const low = Number(match[1]);
  const high = Number(match[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
  return { low, high, label: `${low}-${high}` };
}

export function readSettings(db, userId) {
  const row = db.prepare("SELECT * FROM settings WHERE user_id = ?").get(userId);
  if (!row) return { ...DEFAULT_PREFERENCES };
  return {
    boardTheme: BOARD_THEMES.includes(row.board_theme) ? row.board_theme : "green",
    coordinates: bool(row.coordinates),
    legalMoves: bool(row.legal_moves),
    sound: bool(row.sound),
    showHints: bool(row.show_hints),
    dailyGoal: Number(row.daily_goal || 50),
    modelSource: ["historical", "online", "masters"].includes(row.model_source)
      ? row.model_source
      : "historical",
    ratingSystem: PLATFORMS.includes(row.rating_system) ? row.rating_system : "Chess.com",
    timeControl: TIME_CONTROLS.includes(row.time_control) ? row.time_control : "Blitz",
    singleElo: Number(row.single_elo || 1800),
    eloRange: parseBand(row.elo_range)?.label ?? bandFromValue(row.single_elo),
    coverageGoal: COVERAGE_OPTIONS.includes(Number(row.coverage_goal))
      ? Number(row.coverage_goal)
      : 50,
    practiceMode: PRACTICE_MODES.includes(row.practice_mode) ? row.practice_mode : "individual",
    reviewStyle: REVIEW_STYLES.includes(row.review_style) ? row.review_style : "cards",
    pauseAfterMove: [0, 1, 2].includes(Number(row.pause_after_move))
      ? Number(row.pause_after_move)
      : 0,
    pauseOnFail: bool(row.pause_on_fail),
    pauseOnLowScore: bool(row.pause_on_low_score),
    pauseWhenNote: bool(row.pause_when_note),
    animation: ANIMATIONS.includes(row.animation) ? row.animation : "normal",
    haptics: bool(row.haptics),
    pieceSet: PIECE_SETS.some((set) => set.id === row.piece_set)
      ? row.piece_set
      : "chessbook_monochrome",
    soundVolume: Math.max(0, Math.min(100, Number(row.sound_volume ?? 70))),
    soundEffects: json(row.sound_effects, DEFAULT_PREFERENCES.soundEffects),
    recommendedMovesSize: RECOMMENDED_SIZES.includes(row.recommended_moves_size)
      ? row.recommended_moves_size
      : "comfortable",
    notifications: json(row.notifications, DEFAULT_PREFERENCES.notifications),
  };
}

/**
 * Merge a PATCH body into the stored settings. Unknown keys are ignored and
 * invalid values keep the previous value, so a partial client cannot corrupt
 * the profile.
 */
export function updateSettings(db, userId, body = {}) {
  const current = readSettings(db, userId);
  const next = { ...current };
  const pick = (key, allowed, fallback = current[key]) =>
    allowed.includes(body[key]) ? body[key] : fallback;

  next.boardTheme = pick("boardTheme", BOARD_THEMES);
  next.modelSource = pick("modelSource", ["historical", "online", "masters"]);
  next.ratingSystem = pick("ratingSystem", PLATFORMS);
  next.timeControl = pick("timeControl", TIME_CONTROLS);
  next.practiceMode = pick("practiceMode", PRACTICE_MODES);
  next.reviewStyle = pick(
    "reviewStyle",
    REVIEW_STYLES
  );
  next.animation = pick("animation", ANIMATIONS);
  next.recommendedMovesSize = pick("recommendedMovesSize", RECOMMENDED_SIZES);
  if (body.pieceSet != null) {
    const set = PIECE_SETS.find((entry) => entry.id === body.pieceSet && entry.available);
    if (set) next.pieceSet = set.id;
  }

  for (const key of [
    "coordinates",
    "legalMoves",
    "sound",
    "showHints",
    "pauseOnFail",
    "pauseOnLowScore",
    "pauseWhenNote",
    "haptics",
  ]) {
    if (body[key] != null) next[key] = Boolean(body[key]);
  }

  if (body.dailyGoal != null) {
    next.dailyGoal = Math.max(1, Math.min(500, Math.round(Number(body.dailyGoal) || 50)));
  }
  if (body.singleElo != null) {
    next.singleElo = Math.max(400, Math.min(3500, Math.round(Number(body.singleElo) || 1800)));
    if (body.eloRange == null) next.eloRange = bandFromValue(next.singleElo);
  }
  if (body.eloRange != null) {
    const band = parseBand(body.eloRange);
    if (band) next.eloRange = band.label;
  }
  if (body.coverageGoal != null) {
    const goal = Math.round(Number(body.coverageGoal));
    next.coverageGoal = COVERAGE_OPTIONS.includes(goal) ? goal : current.coverageGoal;
  }
  if (body.pauseAfterMove != null) {
    const seconds = Number(body.pauseAfterMove);
    if ([0, 1, 2].includes(seconds)) next.pauseAfterMove = seconds;
  }
  if (body.soundVolume != null) {
    next.soundVolume = Math.max(0, Math.min(100, Math.round(Number(body.soundVolume) || 0)));
  }
  if (body.soundEffects && typeof body.soundEffects === "object") {
    next.soundEffects = json({ ...current.soundEffects, ...body.soundEffects }, current.soundEffects);
  }
  if (body.notifications && typeof body.notifications === "object") {
    next.notifications = json(
      { ...current.notifications, ...body.notifications },
      current.notifications
    );
  }

  db.prepare(
    `UPDATE settings SET
       board_theme = ?, coordinates = ?, legal_moves = ?, sound = ?, show_hints = ?,
       daily_goal = ?, model_source = ?, rating_system = ?, time_control = ?,
       single_elo = ?, elo_range = ?, coverage_goal = ?, practice_mode = ?,
       review_style = ?, pause_after_move = ?, pause_on_fail = ?, pause_on_low_score = ?,
       pause_when_note = ?, animation = ?, haptics = ?, piece_set = ?,
       sound_volume = ?, sound_effects = ?, recommended_moves_size = ?, notifications = ?
     WHERE user_id = ?`
  ).run(
    next.boardTheme,
    next.coordinates ? 1 : 0,
    next.legalMoves ? 1 : 0,
    next.sound ? 1 : 0,
    next.showHints ? 1 : 0,
    next.dailyGoal,
    next.modelSource,
    next.ratingSystem,
    next.timeControl,
    next.singleElo,
    next.eloRange,
    next.coverageGoal,
    next.practiceMode,
    next.reviewStyle,
    next.pauseAfterMove,
    next.pauseOnFail ? 1 : 0,
    next.pauseOnLowScore ? 1 : 0,
    next.pauseWhenNote ? 1 : 0,
    next.animation,
    next.haptics ? 1 : 0,
    next.pieceSet,
    next.soundVolume,
    JSON.stringify(next.soundEffects),
    next.recommendedMovesSize,
    JSON.stringify(next.notifications),
    userId
  );

  // Mirror the profile rating onto `users` for `/me` clients that never read
  // `settings` (D196). `settings` stays canonical.
  db.prepare(
    `UPDATE users SET rating_system = ?, single_elo = ?, elo_range = ?, coverage_goal = ?
     WHERE id = ?`
  ).run(next.ratingSystem, next.singleElo, next.eloRange, next.coverageGoal, userId);

  return next;
}

/** Extra metadata the Settings screen uses to render honest sheet options. */
export function settingsMeta() {
  return {
    platforms: PLATFORMS,
    timeControls: TIME_CONTROLS,
    boardThemes: BOARD_THEMES,
    reviewStyles: REVIEW_STYLES,
    practiceModes: PRACTICE_MODES,
    animations: ANIMATIONS,
    recommendedSizes: RECOMMENDED_SIZES,
    coverageOptions: COVERAGE_OPTIONS,
    pieceSets: PIECE_SETS,
    availablePieceSets: PIECE_SETS,
  };
}

/** The captured band is the only band with real statistics in this build. */
export function bandMatch(db, settings) {
  const captured = db
    .prepare("SELECT * FROM capture_profile WHERE key IN ('ratingRange','eloRange','ratingSystem','singleElo')")
    .all();
  const values = Object.fromEntries(captured.map((row) => [row.key, row.value]));
  const parsed = parseBand(settings?.eloRange);
  const capturedBands = [values.ratingRange, values.eloRange].filter(Boolean);
  const matches = Boolean(parsed && capturedBands.includes(parsed.label));
  return {
    available: capturedBands.length > 0,
    capturedBands,
    capturedSystem: values.ratingSystem ?? null,
    userBand: parsed?.label ?? null,
    userSystem: settings?.ratingSystem ?? null,
    matches,
    source: capturedBands.length ? "recon/live4/network.json#2 (/api/user)" : null,
  };
}
