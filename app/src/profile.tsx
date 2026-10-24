import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "./api";
import type { User } from "./types";
import {
  applyClientPrefs,
  applySettingsPrefs,
  getClientPrefs,
  type ClientPrefs,
  type ServerSettings,
} from "./prefs";

export interface StreakInfo {
  current: number;
  highest: number;
  lastStreakDate: string | null;
  today: string;
}

export interface DailyInfo {
  date: string;
  reviews: number;
  correct: number;
  wrong: number;
  goal: number;
  goalMet: boolean;
  remaining: number;
  streak: StreakInfo;
}

interface ProfileValue {
  user: User | null;
  /** The single server settings row (board + review-relevant values). */
  settings: ServerSettings | null;
  /** Today's review counters, derived from the real review log. */
  daily: DailyInfo | null;
  streak: StreakInfo | null;
  /** Client-only preferences (rating, coverage, review style, …). */
  prefs: ClientPrefs;
  loading: boolean;
  refresh: () => Promise<void>;
  saveSettings: (patch: Partial<ServerSettings>) => Promise<ServerSettings>;
  setUser: (user: User | null) => void;
}

const ProfileContext = createContext<ProfileValue | null>(null);

const tzOffset = () => new Date().getTimezoneOffset();

/**
 * Local-first profile hydration. There is no session or credential exchange:
 * the API resolves every request to the single profile stored on this machine.
 *
 * This provider is also the one place that hydrates preferences: the server
 * settings row is mirrored for the board/sounds and the client preferences are
 * applied globally (animation / recommended-moves density).
 */
export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [daily, setDaily] = useState<DailyInfo | null>(null);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [prefs, setPrefs] = useState<ClientPrefs>(() => getClientPrefs());
  const [loading, setLoading] = useState(true);
  /** StrictMode mounts this provider twice in development; share one refresh. */
  const refreshing = useRef<Promise<void> | null>(null);

  const hydratePreferences = useCallback(async () => {
    try {
      const data = await api.get<{ settings: ServerSettings }>("/settings");
      setSettings(data.settings);
      applySettingsPrefs(data.settings);
    } catch {
      // Settings are optional for rendering; the local database remains the
      // source of truth once the profile is available.
    }
    setPrefs(getClientPrefs());
    applyClientPrefs();
  }, []);

  const refresh = useCallback(async () => {
    // React StrictMode runs mount effects twice. The second call reuses the
    // in-flight hydration instead of issuing a second `/me` + `/settings` pair.
    if (refreshing.current) return refreshing.current;
    const task = (async () => {
      const offset = tzOffset();
      try {
        const data = await api.get<{ user: User | null }>(`/me?tzOffset=${offset}`);
        if (data.user) await hydratePreferences();
        setUser(data.user ?? null);
      } catch {
        setUser(null);
      }
      try {
        const response = await api.get<{ daily: DailyInfo }>(`/practice/daily?tzOffset=${offset}`);
        setDaily(response.daily);
        setStreak(response.daily.streak);
      } catch {
        setDaily(null);
        setStreak(null);
      }
      setLoading(false);
    })();
    refreshing.current = task.finally(() => {
      refreshing.current = null;
    });
    return refreshing.current;
  }, [hydratePreferences]);

  const saveSettings = useCallback(async (patch: Partial<ServerSettings>) => {
    const previous = settings;
    if (previous) {
      const optimistic = { ...previous, ...patch } as ServerSettings;
      setSettings(optimistic);
      applySettingsPrefs(optimistic);
    }
    try {
      const response = await api.patch<{ settings: ServerSettings }>("/settings", patch);
      setSettings(response.settings);
      applySettingsPrefs(response.settings);
      return response.settings;
    } catch (error) {
      if (previous) {
        setSettings(previous);
        applySettingsPrefs(previous);
      }
      throw error;
    }
  }, [settings]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Keep the exposed client preferences in sync with the settings page.
  useEffect(() => {
    const sync = () => setPrefs(getClientPrefs());
    window.addEventListener("cb:prefs", sync);
    return () => window.removeEventListener("cb:prefs", sync);
  }, []);

  const value = useMemo(
    () => ({
      user,
      settings,
      daily,
      streak,
      prefs,
      loading,
      refresh,
      saveSettings,
      setUser,
    }),
    [user, settings, daily, streak, prefs, loading, refresh, saveSettings]
  );
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
}
