import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

const memory = new Map<string, unknown>();

/**
 * Load JSON from the API. The last response for the same path is shown
 * immediately while a fresh copy loads, so navigating back never flashes
 * an empty screen.
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(() => (path ? ((memory.get(path) as T) ?? null) : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const current = useRef(path);

  const load = useCallback(async () => {
    if (!path) return;
    current.current = path;
    setLoading(true);
    setError(null);
    try {
      const value = await api.get<T>(path);
      if (current.current !== path) return;
      memory.set(path, value);
      setData(value);
    } catch (e) {
      if (current.current !== path) return;
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (path && memory.has(path)) setData(memory.get(path) as T);
    void load();
  }, [path, load]);

  return { data, error, loading, reload: load, setData };
}

export function forget(prefix: string) {
  for (const key of memory.keys()) if (key.startsWith(prefix)) memory.delete(key);
}

export function forgetAll() {
  memory.clear();
}
