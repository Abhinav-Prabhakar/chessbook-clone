import { useEffect, useState } from "react";
import {
  flushOfflineQueue,
  offlineSnapshot,
  onOfflineChange,
  type OfflineSnapshot,
} from "../api";

/**
 * Global offline / pending-write banner (audit D211).
 *
 * Reads are served from the service-worker cache, so the app remains usable
 * offline. Writes cannot be acknowledged without the local API, so `api.ts`
 * queues them in localStorage with their existing idempotency keys and this
 * banner reports the queue and offers a manual retry when the API is back.
 */
export function OfflineBanner() {
  const [state, setState] = useState<OfflineSnapshot>(() => offlineSnapshot());

  useEffect(() => {
    const sync = (snapshot: OfflineSnapshot) => setState({ ...snapshot });
    const unsubscribe = onOfflineChange(sync);
    const onOnline = () => {
      setState(offlineSnapshot());
      void flushOfflineQueue();
    };
    const onOffline = () => setState(offlineSnapshot());
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // A page that starts online still flushes anything left by a previous load.
    void flushOfflineQueue().then(({ pending }) => {
      setState({ ...offlineSnapshot(), pending });
    });
    return () => {
      unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (state.online && state.pending === 0) return null;

  const message = !state.online
    ? state.pending > 0
      ? `Offline — ${state.pending} change${state.pending === 1 ? "" : "s"} queued. Cached screens stay readable; changes sync when you reconnect.`
      : "Offline — showing cached screens. Changes you make will be queued and synced when you reconnect."
    : state.syncing
      ? `Syncing ${state.pending} queued change${state.pending === 1 ? "" : "s"}…`
      : `${state.pending} change${state.pending === 1 ? "" : "s"} waiting to sync${
          state.error ? ` · ${state.error}` : ""
        }.`;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 16,
        transform: "translateX(-50%)",
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        gap: 12,
        maxWidth: "min(560px, calc(100vw - 32px))",
        padding: "10px 14px",
        borderRadius: 8,
        border: "1px solid var(--cb-border-soft, #2a2f33)",
        background: "var(--cb-bg-raised, #1b1f22)",
        color: "var(--cb-text, #f5f5f5)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        fontSize: 12,
        lineHeight: "18px",
      }}
    >
      <i
        className={`fa ${state.online ? "fa-rotate" : "fa-cloud-arrow-down"}`}
        aria-hidden
        style={{ color: state.online ? "var(--cb-orange, #e8a33d)" : "var(--cb-text-3, #8b9599)" }}
      />
      <span style={{ flex: 1 }}>{message}</span>
      {state.online && state.pending > 0 && !state.syncing && (
        <button
          type="button"
          className="cb-btn small"
          onClick={() => {
            void flushOfflineQueue();
          }}
        >
          Retry now
        </button>
      )}
    </div>
  );
}

export default OfflineBanner;
