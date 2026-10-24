import { useEffect, useMemo, useState } from "react";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 100) / 10);
  if (total >= 60) {
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
  }
  return total.toFixed(1);
}

/**
 * Client-side countdown for the authoritative server clock. `ms` is the
 * remaining time reported by the server and `syncedAt` is when this client
 * received that snapshot; only the side to move loses time.
 */
export function ChessClock({
  ms,
  active,
  syncedAt,
  label,
  onExpire,
}: {
  ms: number;
  active: boolean;
  syncedAt: number;
  label: string;
  onExpire?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [active]);
  const remaining = useMemo(() => {
    const elapsed = active ? Math.max(0, now - syncedAt) : 0;
    return Math.max(0, ms - elapsed);
  }, [active, ms, now, syncedAt]);
  useEffect(() => {
    if (active && remaining <= 0) onExpire?.();
    // Only fire once per expiry; the parent guards duplicate calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, remaining <= 0]);
  const low = remaining <= 20_000;
  return (
    <div
      className={`cb-clock${active ? " active" : ""}`}
      aria-label={`${label} clock`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 6,
        border: `1px solid ${active ? "var(--cb-green)" : "var(--cb-border-soft)"}`,
        background: active ? "var(--cb-button)" : "transparent",
        color: low ? "var(--cb-danger)" : "var(--cb-text)",
        fontVariantNumeric: "tabular-nums",
        fontFamily: "var(--cb-font-display)",
        fontSize: 20,
        lineHeight: 1,
      }}
    >
      <span style={{ fontSize: 11, color: "var(--cb-text-3)", fontFamily: "var(--cb-font-ui)" }}>
        {label}
      </span>
      <span>{formatClock(remaining)}</span>
    </div>
  );
}

export { formatClock };
