import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { BoardHeader, Sidebar } from "../ui";

const PLAY_TABS = [
  { to: "/training-games", label: "Training games", icon: "fa-chess-knight" },
  { to: "/blunder-puzzles", label: "Blunder puzzles", icon: "fa-bolt" },
  { to: "/intuition-builder", label: "Intuition", icon: "fa-brain" },
  { to: "/visualization", label: "Visualization", icon: "fa-eye" },
  { to: "/vision", label: "Vision", icon: "fa-crosshairs" },
];

/** Shared three-column shell for the play pillars. */
export function PlayLayout({
  title,
  subtitle,
  board,
  boardFooter,
  crumbs = [],
  backTo = "/dashboard",
  backLabel = "Back",
  help = "training-games",
  children,
  sidebarClass = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  board: ReactNode;
  boardFooter?: ReactNode;
  crumbs?: { label: string; to?: string }[];
  backTo?: string;
  backLabel?: string;
  help?: string;
  children: ReactNode;
  sidebarClass?: string;
}) {
  const { pathname } = useLocation();
  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader items={crumbs} />
          {board}
          {boardFooter ? <div className="cb-board-footer visible">{boardFooter}</div> : null}
        </section>
        <Sidebar className={sidebarClass} backTo={backTo} backLabel={backLabel}>
          <div className="cb-page-head">
            <h1 className="cb-page-title">{title}</h1>
            {subtitle ? <p className="cb-page-sub">{subtitle}</p> : null}
          </div>
          <nav className="cb-tabs" aria-label="Play and puzzles">
            {PLAY_TABS.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                className={`cb-tab${pathname === tab.to ? " active" : ""}`}
              >
                <i className={`fa ${tab.icon}`} aria-hidden /> {tab.label}
              </Link>
            ))}
          </nav>
          {children}
          <p style={{ margin: "22px 18px 0", fontSize: 11, color: "var(--cb-text-3)" }}>
            <Link to={`/help#${help}`} className="cb-link">
              <i className="fa fa-circle-question" aria-hidden /> How this drill works
            </Link>
            <span style={{ margin: "0 6px" }}>·</span>
            <Link to="/help#drills" className="cb-link">
              All help
            </Link>
          </p>
        </Sidebar>
      </main>
    </div>
  );
}
