import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import type { Settings } from "./types";
import { setSoundEnabled } from "./sounds";

export const DEFAULT_SETTINGS: Settings = {
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

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  band: string | null;
  update: (patch: Partial<Settings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsState>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  band: null,
  update: async () => {},
});

const CACHE_KEY = "cb_settings";

function cachedSettings(): Settings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Start from the last known settings so the board renders with the right
  // theme immediately; the server copy replaces it a moment later.
  const [settings, setSettings] = useState<Settings>(cachedSettings);
  const [loaded, setLoaded] = useState(false);
  const [band, setBand] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ settings: Settings; band: string }>("/settings")
      .then((data) => {
        setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
        setBand(data.band);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    setSoundEnabled(settings.sound);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    const data = await api.patch<{ settings: Settings; band: string }>("/settings", patch);
    setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
    setBand(data.band);
  }, []);

  const value = useMemo(() => ({ settings, loaded, band, update }), [settings, loaded, band, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);

export function animationMs(animation: Settings["animation"]) {
  return animation === "off" ? 0 : animation === "fast" ? 120 : animation === "slow" ? 320 : 200;
}
