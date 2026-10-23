import type { Settings } from "./types";

export type BoardTheme = Settings["boardTheme"];

const read = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

const bool = (key: string, fallback = true) => read(key, fallback ? "1" : "0") === "1";

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

export function applySettingsPrefs(settings: Settings) {
  try {
    localStorage.setItem("cb_board_theme", settings.boardTheme);
    localStorage.setItem("cb_coordinates", settings.coordinates ? "1" : "0");
    localStorage.setItem("cb_legal_moves", settings.legalMoves ? "1" : "0");
    localStorage.setItem("cb_sound", settings.sound ? "1" : "0");
    localStorage.setItem("cb_show_hints", settings.showHints ? "1" : "0");
    localStorage.setItem("cb_daily_goal", String(settings.dailyGoal));
  } catch {
    // Preferences are an enhancement; the server remains the source of truth.
  }
}
