const KEY = "chessbook-clone-v1";

const defaults = {
  loggedIn: true,
  user: { email: "local@chessbook.local", name: "Player", plan: "pro", rating: "1800-2000" },
  onboarded: true,
  buildPath: ["e4", "e5"],
  settings: {
    platform: "Chess.com", timeControl: "Blitz", rating: 1800,
    coverage: "1 in 200 games", lichess: true, chesscom: true,
    modelSource: "Online and master games", earlyAccess: "None enabled",
    practice: "Individual moves", dailyGoal: "50 moves", pause: "Never",
    appearance: "Chessbook", animation: "Fast", sound: true, haptics: true,
  },
  stats: { reviewed: 0, correct: 0, wrong: 0 },
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(defaults);
    return { ...structuredClone(defaults), ...JSON.parse(raw) };
  } catch (e) { return structuredClone(defaults); }
}

export const state = load();
export function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
export function resetState() { localStorage.removeItem(KEY); location.reload(); }
export function setState(patch) { Object.assign(state, patch); save(); }
export function updateSettings(patch) { Object.assign(state.settings, patch); save(); }
