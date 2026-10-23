import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Settings, User } from "./types";
import { applySettingsPrefs } from "./prefs";

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  guest: () => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const hydratePreferences = useCallback(async () => {
    try {
      const data = await api.get<{ settings: Settings }>("/settings");
      applySettingsPrefs(data.settings);
    } catch {
      // Settings are optional for rendering; the server remains authoritative.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: User | null }>("/auth/me");
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

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("cb:unauthorized", onUnauthorized);
    return () => window.removeEventListener("cb:unauthorized", onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: User }>("/auth/login", { email, password });
    await hydratePreferences();
    setUser(data.user);
    return data.user;
  }, [hydratePreferences]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const data = await api.post<{ user: User }>("/auth/register", { name, email, password });
    await hydratePreferences();
    setUser(data.user);
    return data.user;
  }, [hydratePreferences]);

  const guest = useCallback(async () => {
    const data = await api.post<{ user: User }>("/auth/guest");
    await hydratePreferences();
    setUser(data.user);
    return data.user;
  }, [hydratePreferences]);

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, guest, logout, refresh, setUser }),
    [user, loading, login, register, guest, logout, refresh]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
