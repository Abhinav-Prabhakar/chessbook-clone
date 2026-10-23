import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { Repertoire } from "../types";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`cb-logo ${className}`} aria-label="Chessbook home">
      <img src="/homepage_imgs/chessbook.svg" alt="Chessbook" />
    </Link>
  );
}

export function TopBar() {
  return (
    <header className="cb-topbar">
      <Logo />
      <div className="cb-top-actions">
        <span className="cb-plan-pill">PRO</span>
        <Link to="/settings" className="cb-top-link">
          Account
        </Link>
      </div>
    </header>
  );
}

export function Splash({ label = "Loading your repertoire…" }: { label?: string }) {
  return (
    <div className="cb-splash" role="status" aria-live="polite">
      <Logo />
      <div className="cb-spinner" />
      <p>{label}</p>
    </div>
  );
}

export function Sidebar({
  children,
  settings = true,
  backTo,
  backLabel = "Back",
  className = "",
}: {
  children: ReactNode;
  settings?: boolean;
  backTo?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <aside className={`cb-sidebar ${className}`}>
      {settings && (
        <div className="cb-sidebar-settings">
          <Link to="/settings" className="cb-settings-link">
            Settings <i className="fa fa-gear" aria-hidden />
          </Link>
        </div>
      )}
      {backTo && (
        <div className="cb-back-row">
          <Link to={backTo} className="cb-back">
            <i className="fa fa-arrow-left" aria-hidden /> {backLabel}
          </Link>
        </div>
      )}
      {children}
    </aside>
  );
}

export function Section({
  title,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`cb-section ${className}`}>
      {(title || action) && (
        <div className="cb-section-head">
          <span>{title}</span>
          {action}
        </div>
      )}
      <div className="cb-rows">{children}</div>
    </section>
  );
}

export function Row({
  title,
  meta,
  right,
  onClick,
  to,
  large = false,
  ghost = false,
  focus = false,
  className = "",
  testId,
  disabled,
}: {
  title: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  to?: string;
  large?: boolean;
  ghost?: boolean;
  focus?: boolean;
  className?: string;
  testId?: string;
  disabled?: boolean;
}) {
  const classes = [
    "cb-row",
    large ? "large" : "",
    ghost ? "ghost" : "",
    focus ? "focus" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <span className="cb-row-main">
        <span className="cb-row-title">{title}</span>
        {meta && <span className="cb-row-meta">{meta}</span>}
      </span>
      {right && <span className="cb-row-right">{right}</span>}
    </>
  );
  if (to) {
    return (
      <Link className={classes} to={to} data-testid={testId}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      data-testid={testId}
      disabled={disabled}
    >
      {content}
    </button>
  );
}

export function ProgressRing({
  value,
  size = 14,
  className = "",
}: {
  value: number;
  size?: number;
  className?: string;
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <svg
      className={`cb-progress-ring ${className}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden
    >
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="transparent"
        stroke="oklch(42% 0.0112 243)"
        strokeWidth="16"
      />
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="transparent"
        stroke="oklch(73.5% 0.1736 141)"
        strokeWidth="16"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 50 50)"
      />
    </svg>
  );
}

export function RepertoireRow({
  repertoire,
  to,
}: {
  repertoire: Repertoire;
  to: string;
}) {
  const notStarted = repertoire.learned === 0;
  return (
    <Row
      large
      to={to}
      testId={`repertoire-${repertoire.color}`}
      title={
        <span className="cb-rep-title">
          <span
            className={`cb-color-dot ${repertoire.color}`}
            aria-hidden
          />
          <span className="cb-display">{repertoire.name}</span>
        </span>
      }
      right={
        <span className="cb-rep-progress">
          <span className={`cb-row-meta ${notStarted ? "" : "strong"}`}>
            {notStarted ? "Not started" : `${repertoire.completion}% complete`}
          </span>
          <ProgressRing value={repertoire.completion} />
        </span>
      }
    />
  );
}

export function Breadcrumb({
  items,
}: {
  items: { label: string; to?: string }[];
}) {
  return (
    <nav className="cb-breadcrumb" aria-label="Breadcrumb">
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="cb-crumb">
          {item.to ? <Link to={item.to}>{item.label}</Link> : <span>{item.label}</span>}
          {i < items.length - 1 && <span className="cb-crumb-sep">›</span>}
        </span>
      ))}
    </nav>
  );
}

export function Stat({
  value,
  label,
  hint,
}: {
  value: ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <div className="cb-stat">
      <div className="cb-stat-value">{value}</div>
      <div className="cb-stat-label">{label}</div>
      {hint && <div className="cb-stat-hint">{hint}</div>}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  return (
    <div
      className="cb-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cb-modal">
        <div className="cb-modal-head">
          <h2>{title}</h2>
          <button type="button" className="cb-icon-btn" onClick={onClose} aria-label="Close">
            <i className="fa fa-xmark" aria-hidden />
          </button>
        </div>
        <div className="cb-modal-body">{children}</div>
        {footer && <div className="cb-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon = "fa-chess-board",
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="cb-empty">
      <i className={`fa ${icon}`} aria-hidden />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function formatDue(iso: string | null): string {
  if (!iso) return "Not scheduled";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "Due now";
  const hours = Math.ceil(diff / 3600000);
  if (hours < 24) return `Due in ${hours}h`;
  return `Due in ${Math.ceil(hours / 24)}d`;
}
