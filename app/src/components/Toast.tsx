import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type Kind = "ok" | "bad" | "info";
interface ToastItem {
  id: number;
  message: string;
  kind: Kind;
}

const ToastContext = createContext<{
  toast: (message: string, kind?: Kind) => void;
} | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);

  const toast = useCallback((message: string, kind: Kind = "ok") => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, message, kind }]);
    const timer = window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 2800);
    timers.current.push(timer);
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="cb-toasts" aria-live="polite" aria-atomic="true">
        {items.map((item) => (
          <div key={item.id} className={`cb-toast ${item.kind}`} role="status">
            <span className="cb-toast-dot" />
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
