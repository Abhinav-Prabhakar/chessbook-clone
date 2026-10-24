import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { Chess } from "chess.js";
import { api } from "../api";
import { EmptyState, Logo, SkeletonRows } from "../components/ui";
import { useToast } from "../components/Toast";
import { afterMoves, START_FEN } from "../chess";
import type { Color } from "../types";

/* ------------------------------------------------------------------ types --- */

export interface GuideSummary {
  id: number;
  slug: string;
  eco: string;
  name: string;
  side: Color;
  family: string;
  moves: string[];
  pgn: string;
  epd: string | null;
  coverage: number | null;
  coveragePercent: number | null;
  course: { id: string; slug: string; name: string } | null;
  source: string;
}

export interface CourseSummary {
  id: string;
  slug: string;
  name: string;
  side: Color;
  authorName: string | null;
  authorTitle: string | null;
  avatarImage: string | null;
  description: string | null;
  descriptionShort: string | null;
  official: boolean;
  featured: boolean;
  moveCount: number | null;
  coverage: number | null;
  coveragePercent: number | null;
  source: string;
}

interface GuidesResponse {
  guides: GuideSummary[];
  white: GuideSummary[];
  black: GuideSummary[];
  total: number;
  available: boolean;
  source: string;
}

interface CoursesResponse {
  courses: CourseSummary[];
  total: number;
  available: boolean;
  source: string;
}

interface ReportRow {
  name: string;
  lineId: number;
  color: Color;
  reviews: number;
  correct: number;
  wrong: number;
  accuracy: number | null;
  source: string;
}

interface OpeningsReport {
  available: boolean;
  capturedAvailable: boolean;
  source: string | null;
  reason?: string;
  weak: ReportRow[];
  worst: ReportRow[];
}

/* ------------------------------------------------------------------ shared --- */

/**
 * Scoped styles for the public content surfaces (openings, coaches, blog,
 * repertoires, welcome, help). They live here so every one of those pages can
 * share the same production-like shell without touching the app stylesheet.
 */
export const CONTENT_CSS = `
.cb-cs-page{min-height:100vh;display:flex;flex-direction:column;background:var(--cb-bg);color:var(--cb-text)}
.cb-cs-nav{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:24px;width:100%;max-width:1180px;margin:0 auto;padding:26px 24px}
.cb-cs-nav .cb-logo img{height:26px}
.cb-cs-nav-links{display:flex;align-items:center;flex-wrap:wrap;gap:24px;font-size:13px;color:var(--cb-text-3)}
.cb-cs-nav-links a{color:inherit;text-decoration:none;transition:color 140ms ease}
.cb-cs-nav-links a:hover,.cb-cs-nav-links a.active{color:var(--cb-text)}
.cb-cs-nav-actions{display:flex;align-items:center;gap:10px;flex:0 0 auto}
.cb-cs-main{width:100%;max-width:1180px;margin:0 auto;padding:12px 24px 90px;flex:1}
.cb-cs-main.narrow{max-width:860px}
.cb-cs-crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:2px 0 24px;color:var(--cb-text-dim);font-size:12px}
.cb-cs-crumbs a{color:var(--cb-text-dim);text-decoration:none}
.cb-cs-crumbs a:hover{color:var(--cb-text-2)}
.cb-cs-crumbs .sep{opacity:.7}
.cb-cs-title{margin:0 0 14px;font-family:var(--cb-font-display);font-size:clamp(36px,4.4vw,56px);font-weight:500;line-height:1.02;letter-spacing:-.02em}
.cb-cs-title.small{font-size:clamp(28px,3vw,38px)}
.cb-cs-lede{max-width:790px;margin:0 0 34px;color:var(--cb-text-3);font-size:15px;line-height:1.66}
.cb-cs-lede strong{color:var(--cb-text-2);font-weight:600}
.cb-cs-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 26px}
.cb-cs-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--cb-border-soft);border-radius:8px;background:var(--cb-bg-raised)}
.cb-cs-tab{padding:7px 12px;border:0;border-radius:5px;background:transparent;color:var(--cb-text-3);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.cb-cs-tab:hover{color:var(--cb-text-2)}
.cb-cs-tab.active{background:var(--cb-button);color:var(--cb-text)}
.cb-cs-search{flex:1 1 200px;min-width:180px;max-width:340px}
.cb-cs-search .cb-input{width:100%}
.cb-cs-check{display:inline-flex;align-items:center;gap:7px;color:var(--cb-text-3);font-size:12px;cursor:pointer;user-select:none}
.cb-cs-check input{accent-color:var(--cb-green)}
.cb-cs-section-title{margin:34px 0 4px;font-family:var(--cb-font-display);font-size:22px;font-weight:500}
.cb-cs-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 30px}
.cb-cs-guide{display:flex;align-items:center;gap:14px;padding:13px 10px;border-bottom:1px solid var(--cb-border-soft);border-radius:5px;text-decoration:none;color:inherit;transition:background 140ms ease}
.cb-cs-guide:hover{background:var(--cb-bg-raised)}
.cb-cs-guide-main{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px}
.cb-cs-guide-name{display:flex;align-items:baseline;gap:10px;font-family:var(--cb-font-display);font-size:19px;font-weight:500;line-height:1.22}
.cb-cs-eco{color:var(--cb-text-dim);font-family:var(--cb-font-mono);font-size:10px;letter-spacing:.04em;white-space:nowrap}
.cb-cs-guide-moves{color:var(--cb-text-3);font-size:12px;line-height:1.45;overflow-wrap:anywhere}
.cb-cs-guide-board{flex:0 0 auto}
.cb-cs-mini{border-radius:4px;overflow:hidden;box-shadow:0 3px 14px rgba(0,0,0,.28);background:#6f8065}
.cb-cs-mini-grid{display:grid;width:100%}
.cb-cs-sq{position:relative;aspect-ratio:1/1;line-height:0}
.cb-cs-sq.light{background:#b9c2ac}
.cb-cs-sq.dark{background:#6d8066}
.cb-cs-sq img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.cb-cs-empty{margin-top:12px}
.cb-cs-note{display:flex;gap:10px;align-items:flex-start;margin:18px 0;padding:12px 14px;border:1px solid var(--cb-border-soft);border-radius:7px;background:var(--cb-bg-raised);color:var(--cb-text-3);font-size:12px;line-height:1.55}
.cb-cs-note .fa{color:var(--cb-orange);margin-top:2px}
.cb-cs-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.cb-cs-card{display:flex;flex-direction:column;gap:12px;padding:20px;border:1px solid var(--cb-border-soft);border-radius:8px;background:var(--cb-bg-raised)}
.cb-cs-card-head{display:flex;align-items:center;gap:12px;min-width:0}
.cb-cs-card-title{margin:0;font-family:var(--cb-font-display);font-size:22px;font-weight:500;line-height:1.15}
.cb-cs-card-sub{margin:3px 0 0;color:var(--cb-text-3);font-size:12px}
.cb-cs-card p{margin:0;color:var(--cb-text-3);font-size:13px;line-height:1.58}
.cb-cs-card .clamp{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.cb-cs-card-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:auto;padding-top:4px}
.cb-cs-avatar{display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:42px;height:42px;border-radius:999px;background:var(--cb-button);color:var(--cb-text-2);font-family:var(--cb-font-display);font-size:16px;font-weight:500;letter-spacing:.02em}
.cb-cs-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;background:oklch(73.5% .1736 141 / .13);color:var(--cb-green);font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.cb-cs-meta{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--cb-text-dim);font-size:11px}
.cb-cs-meta a{color:var(--cb-blue);text-decoration:none}
.cb-cs-callout{display:flex;align-items:center;justify-content:space-between;gap:24px;margin:36px 0 0;padding:26px;border:1px solid var(--cb-border-soft);border-radius:9px;background:var(--cb-bg-raised)}
.cb-cs-callout h2{margin:0 0 8px;font-family:var(--cb-font-display);font-size:28px;font-weight:500}
.cb-cs-callout p{max-width:640px;margin:0;color:var(--cb-text-3);font-size:13px;line-height:1.6}
.cb-cs-callout .cb-btn{flex:0 0 auto}
.cb-cs-columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:26px;margin:44px 0 0;padding-top:30px;border-top:1px solid var(--cb-border-soft)}
.cb-cs-columns h3{margin:0 0 8px;font-family:var(--cb-font-display);font-size:18px;font-weight:500}
.cb-cs-columns p{margin:0;color:var(--cb-text-3);font-size:12px;line-height:1.6}
.cb-cs-posts{max-width:790px}
.cb-cs-post{display:block;padding:22px 0;border-bottom:1px solid var(--cb-border-soft);text-decoration:none;color:inherit}
.cb-cs-post:hover h2{color:var(--cb-green)}
.cb-cs-post h2{margin:0 0 4px;font-family:var(--cb-font-display);font-size:26px;font-weight:500;line-height:1.18;transition:color 140ms ease}
.cb-cs-post time{display:block;margin:0 0 8px;color:var(--cb-text-dim);font-size:12px}
.cb-cs-post p{margin:0 0 8px;color:var(--cb-text-3);font-size:13px;line-height:1.6}
.cb-cs-read{color:var(--cb-blue);font-size:12px;font-weight:600}
.cb-cs-prose{max-width:780px;color:var(--cb-text-3);font-size:15px;line-height:1.72}
.cb-cs-prose p{margin:0 0 18px}
.cb-cs-prose h2{margin:34px 0 10px;color:var(--cb-text);font-family:var(--cb-font-display);font-size:24px;font-weight:500}
.cb-cs-prose a{color:var(--cb-blue)}
.cb-cs-prose em{font-style:italic}
.cb-cs-detail{display:grid;grid-template-columns:minmax(0,360px) minmax(0,1fr);align-items:start;gap:42px;margin-top:8px}
.cb-cs-detail-side{position:sticky;top:20px;display:flex;flex-direction:column;gap:18px}
.cb-cs-detail-side .cb-cs-mini{width:100%!important;max-width:320px}
.cb-cs-detail-actions{display:flex;flex-direction:column;gap:9px}
.cb-cs-detail-actions .cb-btn{width:100%}
.cb-cs-movegroup{display:flex;gap:16px;align-items:flex-start;padding:18px 0;border-bottom:1px solid var(--cb-border-soft)}
.cb-cs-movegroup:first-child{padding-top:0}
.cb-cs-movegroup .cb-cs-mini{flex:0 0 92px;width:92px!important}
.cb-cs-movegroup-copy{min-width:0;flex:1}
.cb-cs-moves{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px;font-family:var(--cb-font-mono);font-size:12px;color:var(--cb-text-2)}
.cb-cs-moves b{color:var(--cb-text);font-weight:600}
.cb-cs-move-note{margin:0 0 6px;color:var(--cb-text-3);font-size:12px;line-height:1.55}
.cb-cs-move-note strong{color:var(--cb-text-2);font-weight:600}
.cb-cs-plans{margin:26px 0 0}
.cb-cs-plan{margin:0 0 10px;padding:12px 14px;border-left:2px solid var(--cb-green);background:var(--cb-bg-raised);color:var(--cb-text-2);font-size:13px;line-height:1.55}
.cb-cs-steps{display:flex;flex-wrap:wrap;gap:14px;margin:0 0 30px;padding:0;list-style:none}
.cb-cs-step{display:flex;align-items:center;gap:8px;color:var(--cb-text-dim);font-size:12px}
.cb-cs-step .num{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:1px solid var(--cb-border);border-radius:999px;font-family:var(--cb-font-mono);font-size:10px}
.cb-cs-step.active{color:var(--cb-text)}
.cb-cs-step.active .num{border-color:var(--cb-green);background:oklch(73.5% .1736 141 / .16);color:var(--cb-green)}
.cb-cs-step.done{color:var(--cb-text-3)}
.cb-cs-step.done .num{border-color:var(--cb-green);color:var(--cb-green)}
.cb-cs-form{display:flex;flex-direction:column;gap:16px;max-width:520px;padding:22px;border:1px solid var(--cb-border-soft);border-radius:8px;background:var(--cb-bg-raised)}
.cb-cs-form .cb-field{display:flex;flex-direction:column;gap:6px}
.cb-cs-form .cb-field label{color:var(--cb-text-3);font-size:12px;font-weight:600}
.cb-cs-form .cb-input,.cb-cs-form .cb-select,.cb-cs-form .cb-textarea{width:100%}
.cb-cs-form .cb-textarea{min-height:110px;resize:vertical}
.cb-cs-form-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cb-cs-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:4px}
.cb-cs-error{margin:12px 0 0;color:var(--cb-danger);font-size:12px}
.cb-cs-choice{display:flex;flex-wrap:wrap;gap:8px}
.cb-cs-choice button{padding:9px 12px;border:1px solid var(--cb-border);border-radius:6px;background:var(--cb-bg-raised);color:var(--cb-text-2);font-size:12px;cursor:pointer}
.cb-cs-choice button:hover{border-color:var(--cb-button-hover)}
.cb-cs-choice button.active{border-color:var(--cb-green);background:oklch(73.5% .1736 141 / .12);color:var(--cb-text)}
.cb-cs-movechoices{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px}
.cb-cs-movechoice{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--cb-border);border-radius:6px;background:var(--cb-bg-raised);color:var(--cb-text);font-size:12px;cursor:pointer;text-align:left}
.cb-cs-movechoice:hover{border-color:var(--cb-green)}
.cb-cs-movechoice.active{border-color:var(--cb-green);background:oklch(73.5% .1736 141 / .12)}
.cb-cs-movechoice b{font-family:var(--cb-font-mono);font-size:13px}
.cb-cs-movechoice span{color:var(--cb-text-dim);font-size:10px}
.cb-cs-apps{display:flex;flex-direction:column;gap:10px}
.cb-cs-app{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:14px;padding:14px 16px;border:1px solid var(--cb-border-soft);border-radius:7px;background:var(--cb-bg-raised)}
.cb-cs-app-main{min-width:0;flex:1 1 320px}
.cb-cs-app-main strong{display:block;font-size:13px}
.cb-cs-app-main p{margin:4px 0 0;color:var(--cb-text-3);font-size:12px;line-height:1.5}
.cb-cs-app-actions{display:flex;flex-wrap:wrap;gap:8px}
.cb-cs-status{padding:2px 7px;border-radius:999px;font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.cb-cs-status.pending{background:oklch(75% .1494 76 / .14);color:var(--cb-orange)}
.cb-cs-status.approved{background:oklch(73.5% .1736 141 / .14);color:var(--cb-green)}
.cb-cs-status.rejected{background:oklch(70% .1648 22 / .14);color:var(--cb-danger)}
.cb-cs-faq{max-width:780px;margin-top:8px}
.cb-cs-faq details{padding:14px 0;border-bottom:1px solid var(--cb-border-soft)}
.cb-cs-faq summary{cursor:pointer;color:var(--cb-text);font-size:14px;font-weight:600}
.cb-cs-faq p{margin:10px 0 0;color:var(--cb-text-3);font-size:13px;line-height:1.65}
.cb-cs-footer{margin-top:auto;padding:34px 24px;border-top:1px solid var(--cb-border-soft);background:var(--cb-bg-deep);text-align:center}
.cb-cs-footer p{margin:0 0 14px;color:var(--cb-text-dim);font-size:12px}
.cb-cs-footer p a{color:var(--cb-text-3)}
.cb-cs-footer-links{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 20px;font-size:11px}
.cb-cs-footer-links a{color:var(--cb-text-3);text-decoration:none}
.cb-cs-footer-links a:hover{color:var(--cb-text)}
@media(max-width:900px){
  .cb-cs-detail{grid-template-columns:1fr}
  .cb-cs-detail-side{position:static}
  .cb-cs-cards,.cb-cs-grid{grid-template-columns:1fr}
  .cb-cs-columns{grid-template-columns:1fr;gap:18px}
  .cb-cs-callout{flex-direction:column;align-items:flex-start}
}
@media(max-width:640px){
  .cb-cs-nav{padding:18px;flex-wrap:wrap}
  .cb-cs-nav-links{gap:14px;font-size:12px;order:3;width:100%}
  .cb-cs-main{padding:8px 18px 64px}
  .cb-cs-title{font-size:36px}
  .cb-cs-guide-board{width:64px!important}
  .cb-cs-form-row{grid-template-columns:1fr}
  .cb-cs-movegroup .cb-cs-mini{flex-basis:70px;width:70px!important}
}
`;

/* --------------------------------------------------------------- utilities --- */

export function ContentLayout({
  crumbs = [],
  children,
  narrow = false,
  minimal = false,
}: {
  crumbs?: { label: string; to?: string }[];
  children: React.ReactNode;
  narrow?: boolean;
  minimal?: boolean;
}) {
  return (
    <div className="cb-cs-page">
      <style>{CONTENT_CSS}</style>
      <header className="cb-cs-nav">
        <Logo />
        {!minimal && (
          <nav className="cb-cs-nav-links" aria-label="Chessbook sections">
            <Link to="/openings?tab=pre-made">Pre-made repertoires</Link>
            <NavLink to="/openings" end>
              Openings
            </NavLink>
            <NavLink to="/coaches">Coaches</NavLink>
            <NavLink to="/blog">Blog</NavLink>
            <NavLink to="/help">Help</NavLink>
          </nav>
        )}
        <div className="cb-cs-nav-actions">
          <Link className="cb-btn small" to="/dashboard">
            Open app
          </Link>
        </div>
      </header>
      <main className={`cb-cs-main${narrow ? " narrow" : ""}`}>
        {crumbs.length > 0 && (
          <nav className="cb-cs-crumbs" aria-label="Breadcrumb">
            <Link to="/">Chessbook</Link>
            {crumbs.map((crumb) => (
              <span key={`${crumb.label}-${crumb.to ?? ""}`} className="cb-cs-crumb">
                <span className="sep">›</span>
                {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span>{crumb.label}</span>}
              </span>
            ))}
          </nav>
        )}
        {children}
      </main>
      {!minimal && (
        <footer className="cb-cs-footer">
          <p>
            Questions? Feedback? Ideas? <Link to="/help">Read the help page</Link>.
          </p>
          <nav className="cb-cs-footer-links" aria-label="Footer">
            <Link to="/openings?tab=pre-made">Pre-made repertoires</Link>
            <Link to="/openings">Openings</Link>
            <Link to="/coaches">Coaches</Link>
            <Link to="/blog">Blog</Link>
            <Link to="/help">Help</Link>
            <Link to="/legal/privacy">Privacy Policy</Link>
            <Link to="/legal/fulfillment">Fulfillment Policy</Link>
            <a href="mailto:marcus@chessbook.com">Contact us</a>
          </nav>
        </footer>
      )}
    </div>
  );
}

/**
 * Compact, non-interactive position diagram used by the opening guides. It
 * renders the same monochrome piece set as the trainer board.
 */
export function MiniBoard({
  fen,
  orientation = "white",
  size = 104,
  label,
}: {
  fen: string;
  orientation?: Color;
  size?: number;
  label?: string;
}) {
  const board = useMemo(() => {
    try {
      return new Chess(fen).board();
    } catch {
      return null;
    }
  }, [fen]);

  if (!board) return null;
  const ranks =
    orientation === "white"
      ? board
      : [...board].reverse().map((rank) => [...rank].reverse());

  return (
    <div
      className="cb-cs-mini"
      style={{ width: size }}
      role="img"
      aria-label={label ?? "Chess position preview"}
    >
      <div className="cb-cs-mini-grid" style={{ gridTemplateColumns: "repeat(8, minmax(0, 1fr))" }}>
        {ranks.flatMap((rank, rankIndex) =>
          rank.map((piece, fileIndex) => (
            <span
              key={`${rankIndex}-${fileIndex}`}
              className={`cb-cs-sq ${(rankIndex + fileIndex) % 2 === 0 ? "light" : "dark"}`}
            >
              {piece && (
                <img
                  src={`/pieces/chessbook_monochrome/${piece.color}${piece.type.toUpperCase()}.svg`}
                  alt=""
                  loading="lazy"
                />
              )}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/* -------------------------------------------------------------------- page --- */

export function OpeningsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [guides, setGuides] = useState<GuideSummary[] | null>(null);
  const [guidesError, setGuidesError] = useState("");
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [coursesError, setCoursesError] = useState("");
  const [report, setReport] = useState<OpeningsReport | null>(null);
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [showBoards, setShowBoards] = useState(true);
  const [cloning, setCloning] = useState<string | null>(null);

  const tab = params.get("tab") === "pre-made" ? "pre-made" : "guides";
  const sideParam = params.get("side");
  const side: "all" | Color =
    sideParam === "white" || sideParam === "black" ? sideParam : "all";

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    let alive = true;
    api
      .get<GuidesResponse>("/openings/guides")
      .then((response) => {
        if (!alive) return;
        setGuides(response.guides);
        setGuidesError(response.available ? "" : "The captured opening-guide catalogue is empty.");
      })
      .catch((error: Error) => {
        if (!alive) return;
        setGuides([]);
        setGuidesError(error.message);
      });
    api
      .get<CoursesResponse>("/courses?limit=100")
      .then((response) => {
        if (!alive) return;
        setCourses(response.courses);
        setCoursesError(response.available ? "" : "The captured pre-made catalogue is empty.");
      })
      .catch((error: Error) => {
        if (!alive) return;
        setCourses([]);
        setCoursesError(error.message);
      });
    api
      .get<OpeningsReport>("/openings/report")
      .then((response) => {
        if (alive) setReport(response);
      })
      .catch(() => {
        if (alive) {
          setReport({
            available: false,
            capturedAvailable: false,
            source: null,
            reason: "The local openings report could not be loaded.",
            weak: [],
            worst: [],
          });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const guideFens = useMemo(() => {
    const map = new Map<string, string>();
    for (const guide of guides ?? []) {
      try {
        map.set(guide.slug, afterMoves(START_FEN, guide.moves).fen);
      } catch {
        // A malformed captured line simply has no diagram.
      }
    }
    return map;
  }, [guides]);

  const needle = query.trim().toLowerCase();
  const matchingGuides = useMemo(
    () =>
      (guides ?? []).filter((guide) => {
        if (side !== "all" && guide.side !== side) return false;
        if (!needle) return true;
        return (
          guide.name.toLowerCase().includes(needle) ||
          guide.eco.toLowerCase().includes(needle) ||
          guide.pgn.toLowerCase().includes(needle)
        );
      }),
    [guides, needle, side]
  );

  const matchingCourses = useMemo(
    () =>
      (courses ?? []).filter((course) => {
        if (side !== "all" && course.side !== side) return false;
        if (!needle) return true;
        return (
          course.name.toLowerCase().includes(needle) ||
          (course.description ?? "").toLowerCase().includes(needle)
        );
      }),
    [courses, needle, side]
  );

  const cloneCourse = async (course: CourseSummary) => {
    if (
      !window.confirm(
        `Clone “${course.name}” into a new ${course.side} repertoire? A clone copies the captured opening line where one exists.`
      )
    ) {
      return;
    }
    setCloning(course.slug);
    try {
      const response = await api.post<{ repertoire: { id: number; name: string }; note: string }>(
        `/courses/${course.slug}/clone`,
        {}
      );
      toast(`${response.repertoire.name} created`, "ok");
      navigate(`/repertoire/${response.repertoire.id}`);
    } catch (error: any) {
      toast(error.message, "bad");
    } finally {
      setCloning(null);
    }
  };

  const guideSections: { key: string; title: string; list: GuideSummary[] }[] =
    side === "all"
      ? [
          { key: "white", title: "Openings for White", list: matchingGuides.filter((g) => g.side === "white") },
          { key: "black", title: "Openings for Black", list: matchingGuides.filter((g) => g.side === "black") },
        ]
      : [
          {
            key: side,
            title: side === "white" ? "Openings for White" : "Openings for Black",
            list: matchingGuides,
          },
        ];

  return (
    <ContentLayout crumbs={[{ label: tab === "pre-made" ? "Pre-made repertoires" : "Openings" }]}>
      <h1 className="cb-cs-title">
        {tab === "pre-made" ? "Pre-made repertoires" : "Chess opening guides"}
      </h1>
      <p className="cb-cs-lede">
        {tab === "pre-made"
          ? "Complete repertoires captured from Chessbook's pre-made catalogue. Every course keeps its real author name, side, move count and coverage; clone one into your own repertoire library to start building."
          : "One guide per opening: the line club players actually play, two moves at a time with a diagram, Chessbook's note on every move, and the plans both sides follow from the position the line reaches. Most played first."}
      </p>

      <div className="cb-cs-toolbar">
        <div className="cb-cs-tabs" role="tablist" aria-label="Openings sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "guides"}
            className={`cb-cs-tab${tab === "guides" ? " active" : ""}`}
            onClick={() => setParam("tab", null)}
          >
            Opening guides
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "pre-made"}
            className={`cb-cs-tab${tab === "pre-made" ? " active" : ""}`}
            onClick={() => setParam("tab", "pre-made")}
          >
            Pre-made repertoires
          </button>
        </div>
        <label className="cb-cs-search">
          <span className="cb-sr-only">Search {tab === "guides" ? "opening guides" : "repertoires"}</span>
          <input
            className="cb-input"
            type="search"
            placeholder={tab === "guides" ? "Search openings or ECO codes" : "Search pre-made repertoires"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="cb-cs-tabs" role="group" aria-label="Colour">
          {(["all", "white", "black"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`cb-cs-tab${side === value ? " active" : ""}`}
              onClick={() => setParam("side", value === "all" ? null : value)}
            >
              {value === "all" ? "All" : value === "white" ? "White" : "Black"}
            </button>
          ))}
        </div>
        {tab === "guides" && (
          <label className="cb-cs-check">
            <input
              type="checkbox"
              checked={showBoards}
              onChange={(event) => setShowBoards(event.target.checked)}
            />
            Board previews
          </label>
        )}
      </div>

      {tab === "guides" ? (
        guides === null ? (
          <SkeletonRows rows={8} />
        ) : guidesError || matchingGuides.length === 0 ? (
          <EmptyState
            icon="fa-book-open"
            title={guidesError ? "Opening guides unavailable" : "No guides match that search"}
            action={
              guidesError ? undefined : (
                <button type="button" className="cb-btn" onClick={() => setQuery("")}>
                  Clear search
                </button>
              )
            }
          >
            {guidesError ||
              "The captured catalogue has no guide for that name, ECO code or move sequence."}
          </EmptyState>
        ) : (
          <>
            {guideSections.map((section) =>
              section.list.length === 0 ? null : (
                <section key={section.key}>
                  <h2 className="cb-cs-section-title">{section.title}</h2>
                  <div className="cb-cs-grid">
                    {section.list.map((guide) => {
                      const fen = guideFens.get(guide.slug);
                      return (
                        <Link className="cb-cs-guide" to={`/openings/${guide.slug}`} key={guide.slug}>
                          <span className="cb-cs-guide-main">
                            <span className="cb-cs-guide-name">
                              <span>{guide.name}</span>
                              <span className="cb-cs-eco">{guide.eco}</span>
                            </span>
                            <span className="cb-cs-guide-moves">
                              {guide.pgn}
                              {guide.coveragePercent != null
                                ? ` · ${guide.coveragePercent}% coverage`
                                : ""}
                            </span>
                          </span>
                          {showBoards && fen && (
                            <span className="cb-cs-guide-board">
                              <MiniBoard
                                fen={fen}
                                size={78}
                                label={`Position after ${guide.pgn}`}
                              />
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              )
            )}
            <p className="cb-cs-note">
              <i className="fa fa-circle-info" aria-hidden />
              <span>
                {matchingGuides.length} guide{matchingGuides.length === 1 ? "" : "s"} from the
                captured Chessbook catalogue. Some lines end before a full opening is named because
                that is where the production guide ends.
              </span>
            </p>
          </>
        )
      ) : courses === null ? (
        <SkeletonRows rows={6} />
      ) : coursesError || matchingCourses.length === 0 ? (
        <EmptyState
          icon="fa-layer-group"
          title={coursesError ? "Pre-made repertoires unavailable" : "No repertoires match that search"}
          action={
            coursesError ? undefined : (
              <button type="button" className="cb-btn" onClick={() => setQuery("")}>
                Clear search
              </button>
            )
          }
        >
          {coursesError ||
            "The captured catalogue has no pre-made repertoire for that name or colour."}
        </EmptyState>
      ) : (
        <>
          <div className="cb-cs-cards">
            {matchingCourses.map((course) => (
              <article className="cb-cs-card" key={course.slug}>
                <div className="cb-cs-card-head">
                  <span className="cb-cs-avatar" aria-hidden>
                    {initials(course.name)}
                  </span>
                  <div>
                    <h2 className="cb-cs-card-title">{course.name}</h2>
                    <p className="cb-cs-card-sub">
                      {course.side === "white" ? "For White" : "For Black"}
                      {course.authorName ? ` · ${course.authorName}` : ""}
                    </p>
                  </div>
                </div>
                <p className="clamp">
                  {course.descriptionShort || course.description || "No description was captured for this course."}
                </p>
                <div className="cb-cs-meta">
                  <span>{course.moveCount ?? "—"} moves</span>
                  <span>
                    {course.coveragePercent == null
                      ? "Coverage unavailable"
                      : `${course.coveragePercent}% coverage`}
                  </span>
                  {course.official && <span className="cb-cs-badge">Official</span>}
                </div>
                <div className="cb-cs-card-actions">
                  <button
                    type="button"
                    className="cb-btn primary small"
                    onClick={() => void cloneCourse(course)}
                    disabled={cloning === course.slug}
                  >
                    {cloning === course.slug ? "Cloning…" : "Clone repertoire"}
                  </button>
                  {course.coveragePercent != null && (
                    <button
                      type="button"
                      className="cb-link"
                      onClick={() => setParam("tab", null)}
                    >
                      Browse matching guides
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          <p className="cb-cs-note">
            <i className="fa fa-circle-info" aria-hidden />
            <span>
              Course metadata is captured from Chessbook. The captured course tree has no chapter
              moves, so a clone seeds the matching opening-guide line when one exists and states
              that in the builder.
            </span>
          </p>
        </>
      )}
      <section style={{ marginTop: 44 }}>
        <h2 className="cb-cs-section-title" style={{ marginTop: 0 }}>
          Your openings report
        </h2>
        {report === null ? (
          <SkeletonRows rows={2} />
        ) : report.weak.length === 0 ? (
          <p className="cb-cs-note">
            <i className="fa fa-circle-info" aria-hidden />
            <span>
              {report.reason ||
                "No reviewed lines in this local profile yet, so there is nothing to rank."}{" "}
              The captured production openings report was an empty array, so no weak or worst
              openings are invented here. The report fills in from your real review history as you
              practise.
            </span>
          </p>
        ) : (
          <div className="cb-cs-grid">
            {(report.worst.length ? report.worst : report.weak).slice(0, 8).map((row) => (
              <Link
                className="cb-cs-guide"
                to={`/repertoire/${row.color}`}
                key={`${row.color}-${row.lineId}`}
              >
                <span className="cb-cs-guide-main">
                  <span className="cb-cs-guide-name">
                    <span>{row.name}</span>
                    <span className="cb-cs-eco">{row.color === "white" ? "White" : "Black"}</span>
                  </span>
                  <span className="cb-cs-guide-moves">
                    {row.reviews} review{row.reviews === 1 ? "" : "s"} ·{" "}
                    {row.accuracy == null ? "accuracy unavailable" : `${row.accuracy}% accuracy`} ·{" "}
                    {row.wrong} wrong
                  </span>
                </span>
                <i className="fa fa-angle-right cb-row-chevron" aria-hidden />
              </Link>
            ))}
          </div>
        )}
      </section>

    </ContentLayout>
  );
}
