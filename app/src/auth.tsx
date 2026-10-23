import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "./api";
import type { Settings, User } from "./types";
import { applySettingsPrefs } from "./prefs";

interface AuthValue {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Local-first profile hydration. There is no session or credential exchange:
 * the API resolves every request to the single profile stored on this machine.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const hydratePreferences = useCallback(async () => {
    try {
      const data = await api.get<{ settings: Settings }>("/settings");
      applySettingsPrefs(data.settings);
    } catch {
      // Settings are optional for rendering; the local database remains the
      // source of truth once the profile is available.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: User | null }>("/me");
      if (data.user) await hydratePreferences();
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [hydratePreferences]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, loading, refresh, setUser }),
    [user, loading, refresh]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
