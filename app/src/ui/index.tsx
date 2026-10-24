import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "./Icon";

export { Icon };

export function PageHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-row">
        <h1 className="page-title">{title}</h1>
        {right && <div className="page-head-right">{right}</div>}
      </div>
      {sub && <p className="page-sub">{sub}</p>}
    </header>
  );
}

export function Back({ to, label = "Back" }: { to?: string; label?: string }) {
  const navigate = useNavigate();
  return (
    <div className="back-row">
      {to ? (
        <Link to={to} className="back">
          <Icon name="arrow-left" /> {label}
        </Link>
      ) : (
        <button type="button" className="back" onClick={() => navigate(-1)}>
          <Icon name="arrow-left" /> {label}
        </button>
      )}
    </div>
  );
}

export function Section({
  title,
  right,
  children,
  className = "",
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section ${className}`}>
      {(title || right) && (
        <div className="section-head">
          <span>{title}</span>
          {right && <span className="section-right">{right}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

interface RowProps {
  title: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "large" | "plain" | "accent" | "danger";
  className?: string;
  chevron?: boolean;
}

export function Row({ title, meta, right, to, onClick, disabled, variant = "default", className = "", chevron }: RowProps) {
  const body = (
    <>
      <span className="row-main">
        <span className="row-title">{title}</span>
        {meta && <span className="row-meta">{meta}</span>}
      </span>
      {(right || chevron) && (
        <span className="row-right">
          {right}
          {chevron && <Icon name="chevron-right" className="row-chevron" />}
        </span>
      )}
    </>
  );
  const cls = `row row-${variant} ${className}`;
  if (to && !disabled) {
    return (
      <Link to={to} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  );
}

export function Progress({ value, tone = "green" }: { value: number; tone?: "green" | "blue" | "orange" }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-fill ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** White / draw / black result bar, as on the real explorer. */
export function ResultBar({ white, draw, black }: { white: number; draw: number; black: number }) {
  return (
    <div className="result-bar" title={`White ${white}% · Draw ${draw}% · Black ${black}%`}>
      <span className="rb-white" style={{ width: `${white}%` }}>
        {white >= 18 ? white : ""}
      </span>
      <span className="rb-draw" style={{ width: `${draw}%` }} />
      <span className="rb-black" style={{ width: `${black}%` }}>
        {black >= 18 ? black : ""}
      </span>
    </div>
  );
}

export function EvalChip({ value, mate }: { value: number | null | undefined; mate?: number | null }) {
  if (mate != null) {
    return <span className={`eval-chip ${mate > 0 ? "plus" : "minus"}`}>{`#${mate > 0 ? "" : "-"}${Math.abs(mate)}`}</span>;
  }
  if (value == null) return <span className="eval-chip none">…</span>;
  const text = `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}`;
  return <span className={`eval-chip ${value >= 0 ? "plus" : "minus"}`}>{text}</span>;
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i} style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="error-note">
      <span>{error}</span>
      {retry && (
        <button type="button" className="link-button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button type={type} className={`btn btn-${variant} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- modal --- */

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- toast --- */

interface ToastItem {
  id: number;
  text: string;
  tone: "info" | "error";
}

const ToastContext = createContext<(text: string, tone?: "info" | "error") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const id = useRef(0);
  const push = useCallback((text: string, tone: "info" | "error" = "info") => {
    const next = { id: ++id.current, text, tone };
    setItems((list) => [...list.slice(-2), next]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== next.id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ------------------------------------------------------------- helpers --- */

export function pct(value: number | null | undefined, digits = 0) {
  if (value == null) return "–";
  const n = value * 100;
  if (n > 0 && n < 1 && digits === 0) return "<1%";
  return `${n.toFixed(digits)}%`;
}

export function compact(n: number | null | undefined) {
  if (n == null) return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function moveLabel(plyIndex: number, san: string) {
  const n = Math.floor(plyIndex / 2) + 1;
  return plyIndex % 2 === 0 ? `${n}. ${san}` : `${n}… ${san}`;
}

export function relativeDue(iso: string | null) {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "now";
  const hours = ms / 3_600_000;
  if (hours < 1) return `in ${Math.max(1, Math.round(ms / 60000))} min`;
  if (hours < 24) return `in ${Math.round(hours)} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}
