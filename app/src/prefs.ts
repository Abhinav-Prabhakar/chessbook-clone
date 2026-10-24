import type { Settings } from "./types";

/**
 * Client preferences — one persisted object for everything the local server
 * does not store (audit D197).
 *
 * Server-backed settings live in SQLite and are mirrored into localStorage for
 * synchronous reads by the board/sounds (`cb_board_theme`, `cb_sound`, …).
 * Everything else lives in `cb_prefs_v1` here, is read through the getters
 * below, and is applied where it can have an effect:
 *
 *  - board theme / coordinates / legal moves / sound  → server + Board
 *  - piece animation                                  → global CSS rule
 *  - recommended-moves size                           → global CSS rule
 *  - haptics                                          → navigator.vibrate()
 *  - rating / coverage goal / practice + review style → Repertoire/Add/Dashboard
 *    and the practice pages (which read these getters)
 *  - notifications                                    → browser Notification API
 *
 * The legacy `cb_rating`, `cb_cover`, `cb_pause`, … keys are migrated on first
 * read so an existing install keeps its choices.
 */

export type BoardTheme = Settings["boardTheme"];
export type Platform = "Chess.com" | "Lichess" | "FIDE" | "USCF";
export type TimeControl = "Bullet" | "Blitz" | "Rapid" | "Classical";
export type PracticeMode = "individual" | "whole-lines";
export type ReviewStyle = "cards" | "complete-once" | "complete-every" | "entire-line";
export type AnimationSpeed = "off" | "fast" | "normal";
export type RecommendedMovesSize = "compact" | "comfortable" | "large";
export type SoundName = "move" | "capture" | "check" | "correct" | "wrong" | "notify";

export type ServerSettings = Settings & { modelSource?: "historical" | "masters" | "online" };

export interface RatingPref {
  system: Platform;
  timeControl: TimeControl;
  value: number;
}

export interface NotificationPrefs {
  dailyPractice: boolean;
  streak: boolean;
  modelGame: boolean;
  mistakes: boolean;
}

export interface ClientPrefs {
  rating: RatingPref;
  /** "Cover positions seen in 1 in N games". */
  coverageGoal: number;
  practiceMode: PracticeMode;
  reviewStyle: ReviewStyle;
  pauseAfterMove: 0 | 1 | 2;
  pauseOnFail: boolean;
  pauseOnLowScore: boolean;
  pauseWhenNote: boolean;
  animation: AnimationSpeed;
  haptics: boolean;
  /** 0–100. */
  soundVolume: number;
  soundEffects: Record<SoundName, boolean>;
  recommendedMovesSize: RecommendedMovesSize;
  notifications: NotificationPrefs;
  /** The only bundled set; kept as a field so the sheet can be explicit. */
  pieceSet: "chessbook_monochrome";
}

export const PLATFORMS: Platform[] = ["Chess.com", "Lichess", "FIDE", "USCF"];
export const TIME_CONTROLS: TimeControl[] = ["Bullet", "Blitz", "Rapid", "Classical"];
export const COVERAGE_OPTIONS = [25, 50, 100, 200, 500];
export const DAILY_GOAL_OPTIONS = [10, 20, 30, 40, 50, 75, 100];
export const PAUSE_OPTIONS: { value: 0 | 1 | 2; label: string }[] = [
  { value: 0, label: "Never" },
  { value: 1, label: "1 second" },
  { value: 2, label: "2 seconds" },
];
export const ANIMATION_OPTIONS: { value: AnimationSpeed; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "fast", label: "Fast" },
  { value: "normal", label: "Normal" },
];
export const RECOMMENDED_SIZE_OPTIONS: { value: RecommendedMovesSize; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "large", label: "Large" },
];
export const SOUND_LABELS: { name: SoundName; label: string }[] = [
  { name: "move", label: "Move" },
  { name: "capture", label: "Capture" },
  { name: "check", label: "Check" },
  { name: "correct", label: "Correct" },
  { name: "wrong", label: "Wrong" },
  { name: "notify", label: "Notification" },
];

const PREFS_KEY = "cb_prefs_v1";
const STYLE_ID = "cb-client-prefs";

export const DEFAULT_CLIENT_PREFS: ClientPrefs = {
  rating: { system: "Chess.com", timeControl: "Blitz", value: 1800 },
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
  soundEffects: {
    move: true,
    capture: true,
    check: true,
    correct: true,
    wrong: true,
    notify: true,
  },
  recommendedMovesSize: "comfortable",
  notifications: { dailyPractice: false, streak: false, modelGame: false, mistakes: true },
  pieceSet: "chessbook_monochrome",
};

const read = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences are an enhancement; the server remains the source of truth.
  }
};

const bool = (key: string, fallback = true) => read(key, fallback ? "1" : "0") === "1";

let cache: ClientPrefs | null = null;
const listeners = new Set<(prefs: ClientPrefs) => void>();

function migrateLegacy(): Partial<ClientPrefs> {
  const patch: Partial<ClientPrefs> = {};
  const rating = read("cb_rating", "");
  if (rating) {
    const match = rating.match(/(\d{3,4})\s*-\s*(\d{3,4})/);
    const system = (PLATFORMS.find((p) => rating.includes(p)) ?? "Chess.com") as Platform;
    if (match) {
      patch.rating = {
        system,
        timeControl: DEFAULT_CLIENT_PREFS.rating.timeControl,
        value: Number(match[1]) + 100,
      };
    }
  }
  const cover = read("cb_cover", "");
  const coverMatch = cover.match(/(\d+)/);
  if (coverMatch) patch.coverageGoal = Number(coverMatch[1]);
  const pause = read("cb_pause", "");
  if (pause.startsWith("1")) patch.pauseAfterMove = 1;
  else if (pause.startsWith("2")) patch.pauseAfterMove = 2;
  const animation = read("cb_animation", "");
  if (animation === "Off") patch.animation = "off";
  else if (animation === "Fast") patch.animation = "fast";
  const haptics = read("cb_haptics", "");
  if (haptics) patch.haptics = haptics === "Enabled";
  const practice = read("cb_practice_mode", "");
  if (practice === "Whole lines") patch.practiceMode = "whole-lines";
  return patch;
}

function normalise(raw: unknown): ClientPrefs {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<ClientPrefs>;
  const rating = { ...DEFAULT_CLIENT_PREFS.rating, ...(value.rating ?? {}) };
  return {
    ...DEFAULT_CLIENT_PREFS,
    ...value,
    rating,
    soundEffects: { ...DEFAULT_CLIENT_PREFS.soundEffects, ...(value.soundEffects ?? {}) },
    notifications: { ...DEFAULT_CLIENT_PREFS.notifications, ...(value.notifications ?? {}) },
    coverageGoal: COVERAGE_OPTIONS.includes(Number(value.coverageGoal))
      ? Number(value.coverageGoal)
      : DEFAULT_CLIENT_PREFS.coverageGoal,
    pauseAfterMove: ([0, 1, 2] as const).includes(value.pauseAfterMove as 0 | 1 | 2)
      ? (value.pauseAfterMove as 0 | 1 | 2)
      : 0,
    soundVolume: Math.max(0, Math.min(100, Number(value.soundVolume ?? 70))),
    pieceSet: "chessbook_monochrome",
  };
}

export function getClientPrefs(): ClientPrefs {
  if (cache) return cache;
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
  } catch {
    stored = null;
  }
  cache = normalise({ ...migrateLegacy(), ...(stored ?? {}) });
  return cache;
}

export function saveClientPrefs(patch: Partial<ClientPrefs>): ClientPrefs {
  cache = normalise({ ...getClientPrefs(), ...patch });
  write(PREFS_KEY, JSON.stringify(cache));
  applyClientPrefs(cache);
  listeners.forEach((listener) => listener(cache!));
  return cache;
}

export function resetClientPrefs(): ClientPrefs {
  ["cb_rating", "cb_cover", "cb_pause", "cb_animation", "cb_haptics", "cb_practice_mode"].forEach(
    (key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  );
  cache = { ...DEFAULT_CLIENT_PREFS, soundEffects: { ...DEFAULT_CLIENT_PREFS.soundEffects } };
  write(PREFS_KEY, JSON.stringify(cache));
  applyClientPrefs(cache);
  listeners.forEach((listener) => listener(cache!));
  return cache;
}

export function subscribeClientPrefs(listener: (prefs: ClientPrefs) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Applies the preferences that can be expressed as CSS. Piece animation and
 * the recommended-moves density are owned by CSS, so a single injected rule
 * makes the settings effective everywhere without duplicating them per page.
 */
export function applyClientPrefs(prefs: ClientPrefs = getClientPrefs()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.cbAnimation = prefs.animation;
  root.dataset.cbRecSize = prefs.recommendedMovesSize;
  root.dataset.cbHaptics = prefs.haptics ? "on" : "off";

  const animation =
    prefs.animation === "off"
      ? ".cb-piece.cb-piece-move{animation:none!important}"
      : prefs.animation === "fast"
        ? ".cb-piece.cb-piece-move{animation-duration:100ms!important}"
        : ".cb-piece.cb-piece-move{animation-duration:180ms!important}";

  const recSize = [
    'html[data-cb-rec-size="compact"] .cb-candidate-main{padding-top:8px;padding-bottom:8px}',
    'html[data-cb-rec-size="compact"] .cb-candidate-copy>strong{font-size:11px;line-height:18px}',
    'html[data-cb-rec-size="large"] .cb-candidate-main{padding-top:16px;padding-bottom:16px}',
    'html[data-cb-rec-size="large"] .cb-candidate-copy>strong{font-size:13px;line-height:22px}',
    'html[data-cb-rec-size="large"] .cb-candidate-move strong{font-size:16px}',
  ].join("\n");

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `${animation}\n${recSize}`;

  try {
    window.dispatchEvent(new CustomEvent("cb:prefs", { detail: prefs }));
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------ server mirror --- */

export function getBoardTheme(): BoardTheme {
  const value = read("cb_board_theme", "green");
  return value === "blue" || value === "brown" ? value : "green";
}

export function getCoordinates() {
  return bool("cb_coordinates");
}

export function getLegalMoves() {
  return bool("cb_legal_moves");
}

export function getSound() {
  return bool("cb_sound");
}

export function getShowHints() {
  return bool("cb_show_hints");
}

export function getDailyGoal() {
  return Number(read("cb_daily_goal", "10")) || 10;
}

/** Mirrors the server settings into the synchronous keys the board/sounds read. */
export function applySettingsPrefs(settings: ServerSettings) {
  write("cb_board_theme", settings.boardTheme);
  write("cb_coordinates", settings.coordinates ? "1" : "0");
  write("cb_legal_moves", settings.legalMoves ? "1" : "0");
  write("cb_sound", settings.sound ? "1" : "0");
  write("cb_show_hints", settings.showHints ? "1" : "0");
  write("cb_daily_goal", String(settings.dailyGoal));
  applyClientPrefs();
}

/* ------------------------------------------------------------------ getters --- */

export function getRating(): RatingPref {
  return getClientPrefs().rating;
}

export function getRatingBand(value = getRating().value): string {
  const low = Math.max(400, Math.floor(value / 200) * 200);
  return `${low}-${low + 200}`;
}

export function getCoverageGoal() {
  return getClientPrefs().coverageGoal;
}

/** "1 in N games" → the rarity threshold the trim endpoint expects (0–1). */
export function coverageThreshold(goal = getCoverageGoal()) {
  return 1 / Math.max(1, goal);
}

/** "1 in N games" → the probability mass the past-goal trim must keep (0–1). */
export function coverageFraction(goal = getCoverageGoal()) {
  return 1 - coverageThreshold(goal);
}

export function getPracticeMode(): PracticeMode {
  return getClientPrefs().practiceMode;
}

export function getReviewStyle(): ReviewStyle {
  return getClientPrefs().reviewStyle;
}

/**
 * One-call contract for the practice UI (owned by the practice screen):
 *
 *   const { mode, reviewStyle, pauseAfterMove, pause } = getPracticePreferences();
 *
 * `pauseAfterMove` is seconds (0 = never); `pause.onFail` / `.whenNote` /
 * `.onLowScore` are the review-style pause switches.
 */
export function getPracticePreferences() {
  const prefs = getClientPrefs();
  return {
    mode: prefs.practiceMode,
    reviewStyle: prefs.reviewStyle,
    pauseAfterMove: prefs.pauseAfterMove,
    pause: {
      onFail: prefs.pauseOnFail,
      whenNote: prefs.pauseWhenNote,
      onLowScore: prefs.pauseOnLowScore,
    },
  };
}

export function getPauseAfterMove() {
  return getClientPrefs().pauseAfterMove;
}

export function getPausePreferences() {
  const prefs = getClientPrefs();
  return {
    onFail: prefs.pauseOnFail,
    onLowScore: prefs.pauseOnLowScore,
    whenNote: prefs.pauseWhenNote,
  };
}

export function getAnimation(): AnimationSpeed {
  return getClientPrefs().animation;
}

export function getHaptics() {
  return getClientPrefs().haptics;
}

export function getSoundVolume() {
  return getClientPrefs().soundVolume / 100;
}

export function getSoundEffect(name: SoundName) {
  return getClientPrefs().soundEffects[name];
}

export function getRecommendedMovesSize(): RecommendedMovesSize {
  return getClientPrefs().recommendedMovesSize;
}

export function getNotifications(): NotificationPrefs {
  return getClientPrefs().notifications;
}

/* ------------------------------------------------------------------ effects --- */

/** Fires the device vibration API when haptics are enabled. */
export function haptic(pattern: number | number[] = 12) {
  if (!getHaptics()) return false;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      return navigator.vibrate(pattern);
    }
  } catch {
    // unsupported
  }
  return false;
}

/** Plays a short preview at the configured volume. */
export function previewSound(name: SoundName) {
  const files: Record<SoundName, string> = {
    move: "/sounds/Move.mp3",
    capture: "/sounds/Capture.mp3",
    check: "/sounds/Check.mp3",
    correct: "/sounds/GenericNotify.mp3",
    wrong: "/sounds/Error.mp3",
    notify: "/sounds/GenericNotify.mp3",
  };
  try {
    const audio = new Audio(files[name]);
    audio.volume = getSoundVolume();
    void audio.play().catch(() => {});
  } catch {
    // Audio is an enhancement.
  }
}

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** One browser notification per tag per local day. */
export function showLocalNotification(title: string, body: string, tag: string) {
  if (!notificationsSupported() || Notification.permission !== "granted") return false;
  const key = `cb_notified_${tag}_${new Date().toDateString()}`;
  try {
    if (localStorage.getItem(key) === "1") return false;
    localStorage.setItem(key, "1");
  } catch {
    // Still show the notification once if storage is unavailable.
  }
  try {
    new Notification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
}
