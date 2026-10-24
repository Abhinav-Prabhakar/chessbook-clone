import { useId } from "react";
import { Link, useLocation } from "react-router-dom";
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
        <Link to="/settings" className="cb-top-link">
          Settings
        </Link>
      </div>
    </header>
  );
}

/**
 * Inline shimmer placeholder. Production never blocks the whole viewport with a
 * spinner: it paints the page shell (clipped board + sheet on mobile) and lets
 * the rows resolve in place. The exported API stays compatible with the old
 * full-screen `Splash` so pages can keep calling `<Splash label="…" />`.
 */
export function SkeletonRows({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`cb-skeleton-rows ${className}`} aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div className="cb-skeleton-row" key={index} />
      ))}
    </div>
  );
}

export function Splash({ label = "Loading your repertoire…" }: { label?: string }) {
  return (
    <div className="cb-skeleton-page" role="status" aria-live="polite" aria-busy="true">
      <span className="cb-sr-only">{label}</span>
      <div className="cb-skeleton-board-clip" aria-hidden>
        <div className="cb-skeleton-board" />
      </div>
      <div className="cb-skeleton-panel" aria-hidden>
        <div className="cb-skeleton-line w-30" />
        <div className="cb-skeleton-line title" />
        <div className="cb-skeleton-line w-50" />
        <SkeletonRows rows={5} />
        <div className="cb-skeleton-line w-70" />
        <SkeletonRows rows={3} />
      </div>
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
  const { pathname } = useLocation();
  return (
    <aside className={`cb-sidebar ${className}`}>
      {settings && (
        <div
          className={`cb-sidebar-settings ${pathname === "/settings" ? "is-current" : ""}`}
        >
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

export function BoardHeader({
  items = [],
}: {
  items?: { label: string; to?: string }[];
}) {
  if (items.length === 0) {
    return <div className="cb-board-header cb-board-header-empty" aria-hidden />;
  }
  return (
    <nav className="cb-board-header" aria-label="Breadcrumb">
      <Link to="/" className="cb-board-mark" aria-label="Chessbook home">
        <img src="/chessbook-mark.svg" alt="" />
      </Link>
      {items.map((item, index) => (
        <span
          className={`cb-board-crumb${
            /% complete$/i.test(item.label) ? " cb-board-crumb-status" : ""
          }`}
          key={`${item.label}-${index}`}
        >
          <i className="fa fa-angle-right cb-board-sep" aria-hidden />
          {item.to ? (
            <Link to={item.to} className="cb-board-crumb-link">
              {item.label}
            </Link>
          ) : (
            <span className="cb-board-crumb-current">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function BoardArrows({
  arrows = [],
  orientation = "white",
  className = "",
}: {
  arrows?: { from: string; to: string; color?: string; width?: number }[];
  orientation?: "white" | "black";
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (arrows.length === 0) return null;
  const point = (square: string) => {
    const file = "abcdefgh".indexOf(square[0]);
    const rank = Number(square[1]);
    const x = orientation === "white" ? file : 7 - file;
    const y = orientation === "white" ? 8 - rank : rank - 1;
    return { x: x + 0.5, y: y + 0.5 };
  };
  return (
    <svg
      className={`cb-board-arrows ${className}`}
      viewBox="0 0 8 8"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        {arrows.map((arrow, index) => (
          <marker
            key={`head-${index}`}
            id={`cb-arrow-head-${uid}-${index}`}
            markerWidth="3"
            markerHeight="3"
            refX="2.4"
            refY="1.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L3,1.5 L0,3 Z" fill={arrow.color ?? "var(--cb-green)"} />
          </marker>
        ))}
      </defs>
      {arrows.map((arrow, index) => {
        const from = point(arrow.from);
        const to = point(arrow.to);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy) || 1;
        const inset = 0.24;
        const endX = to.x - (dx / length) * inset;
        const endY = to.y - (dy / length) * inset;
        return (
          <line
            key={`${arrow.from}-${arrow.to}-${index}`}
            x1={from.x}
            y1={from.y}
            x2={endX}
            y2={endY}
            stroke={arrow.color ?? "var(--cb-green)"}
            strokeWidth={arrow.width ?? 0.16}
            strokeLinecap="round"
            opacity="0.85"
            markerEnd={`url(#cb-arrow-head-${uid}-${index})`}
          />
        );
      })}
    </svg>
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
  chevron = false,
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
  chevron?: boolean;
}) {
  const classes = [
    "cb-row",
    large ? "large" : "",
    ghost ? "ghost" : "",
    focus ? "focus" : "",
    chevron ? "cb-row-has-chevron" : "",
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
      {(right || chevron) && (
        <span className="cb-row-right">
          {right}
          {chevron && <i className="fa fa-angle-right cb-row-chevron" aria-hidden />}
        </span>
      )}
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

/**
 * Settings-row affordance shared by the settings surface: the current value is
 * shown on the right and the row advertises that it opens a list of choices.
 */
export function SettingRow({
  title,
  value,
  onClick,
  to,
  testId,
  disabled,
}: {
  title: ReactNode;
  value: ReactNode;
  onClick?: () => void;
  to?: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <Row
      className="cb-settings-row"
      title={title}
      right={<span className="cb-setting-value">{value}</span>}
      onClick={onClick}
      to={to}
      testId={testId}
      disabled={disabled}
      chevron
    />
  );
}

export function OptionSheet({
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  title: string;
  options: { value: string; label: string; hint?: string }[];
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="cb-option-list" role="listbox" aria-label={title}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={active}
              className={`cb-option ${active ? "active" : ""}`}
              onClick={() => {
                onSelect(option.value);
                onClose();
              }}
            >
              <span className="cb-option-copy">
                <strong>{option.label}</strong>
                {option.hint && <span>{option.hint}</span>}
              </span>
              {active && <i className="fa fa-check cb-option-check" aria-hidden />}
            </button>
          );
        })}
      </div>
    </Modal>
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
  subtitle,
  children,
  onClose,
  footer,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
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
      <div className={`cb-modal ${className}`}>
        <div className="cb-modal-head">
          <div className="cb-modal-heading">
            <h2>{title}</h2>
            {subtitle && <div className="cb-modal-subtitle">{subtitle}</div>}
          </div>
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
