import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { DailySummary, Repertoire, StreakSummary } from "../types";
import { Board } from "../components/Board";
import {
  BoardHeader,
  RepertoireRow,
  Row,
  Section,
  Sidebar,
  Splash,
  Stat,
} from "../components/ui";
import { useToast } from "../components/Toast";
import {
  coverageThreshold,
  getNotifications,
  haptic,
  notificationsSupported,
  showLocalNotification,
} from "../prefs";

/* ------------------------------------------------------------------- types --- */

interface ModelGame {
  id: number;
  white: string;
  black: string;
  event: string;
  year: string | null;
  result: string;
  resultLabel: string;
  players?: { white?: { elo?: number }; black?: { elo?: number } };
  progressState?: { percent: number; completed: boolean; reviewed: boolean };
  moveCount?: number;
}

interface DashboardData {
  repertoires: Repertoire[];
  tasks: { due: number; saved: number; mastered: number; streak: number };
  streak: StreakSummary;
  daily: DailySummary;
  modelGame: ModelGame | null;
}

interface ReviewRow {
  id: number;
  ply: number;
  san: string;
  playedSan: string;
  correct: boolean;
  lineId: number | null;
  lineName: string | null;
  daily: string;
  createdAt: string;
}

interface GapBest {
  san: string;
  name: string;
  oneIn: number | null;
  incidence: number | null;
}

interface GapResponse {
  available: boolean;
  position?: {
    prefixMoves: string[];
    heading?: { prompt: string };
    coverage?: number | null;
    incidence?: number | null;
    oneIn?: number | null;
    bestMissing?: GapBest | null;
  };
}

interface ReportRow {
  name: string;
  lineId: number;
  color: "white" | "black";
  reviews: number;
  correct: number;
  wrong: number;
  accuracy: number;
}

interface OpeningsReport {
  available: boolean;
  capturedAvailable: boolean;
  source: string | null;
  reason?: string;
  weak: ReportRow[];
  worst: ReportRow[];
}

interface TrimPreview {
  removedCount: number;
  remaining: number;
}

/* ------------------------------------------------------------------- page --- */

const ISSUES_URL = "https://github.com/Abhinav-Prabhakar/chessbook-clone/issues/new";

const tzOffset = () => new Date().getTimezoneOffset();

const formatDay = (value: string | null) => {
  if (!value) return "not yet";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function Dashboard() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [gap, setGap] = useState<GapResponse | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [report, setReport] = useState<OpeningsReport | null>(null);
  const [rare, setRare] = useState<TrimPreview | null>(null);
  const prefs = getNotifications();

  const target = useMemo(() => {
    if (!data) return null;
    return data.repertoires.find((r) => r.due > 0) ?? data.repertoires[0] ?? null;
  }, [data]);

  const load = useCallback(async () => {
    const offset = tzOffset();
    try {
      const dashboard = await api.get<DashboardData>(`/dashboard?tzOffset=${offset}`);
      setData(dashboard);

      const practiceTarget =
        dashboard.repertoires.find((r) => r.due > 0) ?? dashboard.repertoires[0] ?? null;

      const results = await Promise.allSettled([
        practiceTarget
          ? api.get<GapResponse>(`/repertoires/${practiceTarget.id}/gap`)
          : Promise.resolve(null),
        practiceTarget
          ? api.get<{ reviews: ReviewRow[] }>(
              `/practice/reviews?repertoire=${practiceTarget.id}&limit=100`
            )
          : Promise.resolve({ reviews: [] }),
        api.get<OpeningsReport>("/openings/report"),
        practiceTarget
          ? api.post<TrimPreview>(`/repertoires/${practiceTarget.id}/trim`, {
              mode: "rare",
              dryRun: true,
              threshold: coverageThreshold(),
            })
          : Promise.resolve(null),
      ]);

      setGap(results[0].status === "fulfilled" ? (results[0].value as GapResponse | null) : null);
      setReviews(
        results[1].status === "fulfilled"
          ? ((results[1].value as { reviews: ReviewRow[] }).reviews ?? [])
          : []
      );
      setReport(results[2].status === "fulfilled" ? (results[2].value as OpeningsReport) : null);
      setRare(results[3].status === "fulfilled" ? (results[3].value as TrimPreview | null) : null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Notification preferences are read here: the dashboard is the once-a-day
  // surface where a local reminder is allowed to fire.
  useEffect(() => {
    if (!data) return;
    if (prefs.dailyPractice && !data.daily.goalMet) {
      showLocalNotification(
        "Daily practice is not done yet",
        `${data.daily.remaining} more move${data.daily.remaining === 1 ? "" : "s"} to hit today's goal.`,
        "daily-practice"
      );
    }
    if (prefs.streak && data.daily.reviews === 0 && data.daily.streak.current > 0) {
      showLocalNotification(
        "Keep your streak alive",
        `${data.daily.streak.current}-day streak — one review keeps it going.`,
        "streak"
      );
    }
    if (prefs.modelGame && data.modelGame) {
      showLocalNotification(
        "Today's model game",
        `${data.modelGame.white} vs ${data.modelGame.black} — ${data.modelGame.resultLabel}.`,
        "model-game"
      );
    }
  }, [data, prefs.dailyPractice, prefs.streak, prefs.modelGame]);

  if (error) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <button type="button" className="cb-btn" onClick={() => location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return <Splash />;

  const { daily, streak } = data;
  const today = reviews.filter((review) => review.daily === daily.date);
  const shownReviews = today.slice(0, 5);
  const reportRows = report?.weak.length ? report.weak : (report?.worst ?? []);
  const reportTarget = (color: "white" | "black") =>
    data.repertoires.find((r) => r.color === color)?.id ?? null;
  const gapBest = gap?.position?.bestMissing ?? null;
  const prompt = gap?.position?.heading?.prompt ?? "Choose a move to prepare for";
  const goalPercent = daily.goal ? Math.min(100, (daily.reviews / daily.goal) * 100) : 0;
  const practiceHref = target
    ? target.due > 0
      ? `/practice/${target.id}?mode=due`
      : `/learn/${target.id}`
    : "/add?tab=new";
  const notificationsEnabled = prefs.dailyPractice || prefs.streak || prefs.modelGame;
  const notificationBlocked =
    notificationsEnabled &&
    (!notificationsSupported() || Notification.permission !== "granted");

  const back = () => {
    haptic();
    if (typeof window !== "undefined" && window.history.length > 1) navigate(-1);
    else navigate("/dashboard");
  };

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader />
          <Board fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" />
          <div className="cb-board-footer">
            <span>Start position</span>
            <a href="https://lichess.org/analysis" target="_blank" rel="noreferrer">
              Analyze <i className="fa fa-up-right-from-square" aria-hidden />
            </a>
          </div>
        </section>

        <Sidebar className="cb-sidebar-dashboard">
          <div className="cb-back-row">
            <button type="button" className="cb-back" onClick={back}>
              <i className="fa fa-arrow-left" aria-hidden /> Back
            </button>
          </div>

          <Section
            title="Repertoires"
            action={
              <Link to="/add?tab=manage" className="cb-link">
                Manage <i className="fa fa-gear" aria-hidden />
              </Link>
            }
          >
            {data.repertoires.length === 0 ? (
              <Row
                title="Add your first repertoire"
                to="/add?tab=new"
                right={<i className="fa fa-plus" aria-hidden />}
              />
            ) : (
              data.repertoires.map((repertoire) => (
                <RepertoireRow
                  key={repertoire.id}
                  repertoire={repertoire}
                  to={`/repertoire/${repertoire.id}`}
                />
              ))
            )}
            {data.repertoires.length > 0 && (
              <Row
                ghost
                title="Add another repertoire"
                to="/add?tab=new"
                right={<i className="fa fa-plus" aria-hidden />}
              />
            )}
          </Section>

          <div className="cb-stats-block">
            <div className="cb-stats-head">
              <span>Daily practice</span>
              <span className="cb-row-meta">
                {daily.goalMet ? "Goal met" : `${daily.remaining} to go`}
              </span>
            </div>
            <div className="cb-progress-line">
              <div className="cb-progress-copy">
                <strong>
                  {daily.reviews} / {daily.goal} reviews
                </strong>
                <span className="cb-row-meta">
                  {daily.date} <i className="fa fa-fire" aria-hidden /> {streak.current}-day streak
                </span>
              </div>
              <div className="cb-bar">
                <span style={{ width: `${goalPercent}%` }} />
              </div>
            </div>
            <div className="cb-stat-grid">
              <Stat value={daily.correct} label="Correct today" />
              <Stat value={daily.wrong} label="Wrong today" />
              <Stat
                value={`${streak.current}d`}
                label="Streak"
                hint={`Best ${streak.highest}d · last ${formatDay(streak.lastStreakDate)}`}
              />
            </div>
          </div>

          <Section
            title="Daily tasks"
            action={
              <span className="cb-row-meta">
                {streak.current > 0 ? `${streak.current} day streak` : "No streak"}{" "}
                <i className="fa fa-fire" aria-hidden />
              </span>
            }
          >
            <Row
              title="Practice moves"
              testId="practice-moves"
              to={practiceHref}
              meta={target && target.due === 0 ? "Nothing due — start the next pass" : undefined}
              right={
                <span className="cb-row-meta strong">
                  {target && target.due > 0 ? `${target.due} due` : `${data.tasks.due} due`}{" "}
                  <i className="fa fa-clock" aria-hidden />
                </span>
              }
            />
            <Row
              title="Go to your biggest gap"
              to={target ? `/gap/${target.id}` : "/add"}
              testId="biggest-gap"
              meta={
                gap?.available === false
                  ? "No captured candidate report for this repertoire"
                  : prompt
              }
              right={
                <span className="cb-row-meta strong">
                  {gapBest ? `${gapBest.san} · 1 in ${gapBest.oneIn ?? "—"}` : "Find gap"}{" "}
                  <i className="fa fa-bullseye" aria-hidden />
                </span>
              }
            />
            <Row
              title="Improve learnability"
              to={target ? `/repertoire/${target.id}?sheet=trim&mode=rare` : "/add"}
              testId="improve-learnability"
              meta="Trim sidelines rarer than your coverage goal"
              right={
                <span className="cb-row-meta strong">
                  {rare
                    ? `${rare.removedCount} candidate${rare.removedCount === 1 ? "" : "s"}`
                    : "Review"}{" "}
                  <i className="fa fa-filter" aria-hidden />
                </span>
              }
            />
            <Row
              title="Play through a model game"
              to="/model"
              meta={
                data.modelGame
                  ? `${data.modelGame.event} · ${data.modelGame.resultLabel}`
                  : "No model game captured"
              }
              right={
                <span className="cb-row-meta strong">
                  {data.modelGame
                    ? `${data.modelGame.white} vs. ${data.modelGame.black}`
                    : "Model game"}{" "}
                  <i
                    className="fa-solid fa-circle-star"
                    style={{ color: "var(--cb-blue)" }}
                    aria-hidden
                  />
                </span>
              }
            />
            {notificationBlocked && (
              <Row
                ghost
                title="Browser reminders are enabled but not permitted"
                to="/settings"
                right={<span className="cb-row-meta">Fix in Settings</span>}
              />
            )}
          </Section>

          <Section
            title="Today's reviews"
            action={<span className="cb-row-meta">{today.length} logged</span>}
          >
            {shownReviews.length === 0 ? (
              <Row
                ghost
                title="No reviews yet today"
                to={practiceHref}
                right={<span className="cb-row-meta">Start practice</span>}
              />
            ) : (
              shownReviews.map((review) => (
                <Row
                  key={review.id}
                  title={`${review.ply}. ${review.san}`}
                  meta={review.lineName ?? "Saved line"}
                  to={
                    target && review.lineId
                      ? `/repertoire/${target.id}?line=${review.lineId}`
                      : "/dashboard"
                  }
                  right={
                    <span className={`cb-row-meta ${review.correct ? "strong" : ""}`}>
                      {review.correct ? "Correct" : `Played ${review.playedSan}`}{" "}
                      <i
                        className={`fa ${review.correct ? "fa-check" : "fa-xmark"}`}
                        aria-hidden
                      />
                    </span>
                  }
                />
              ))
            )}
            {today.length > shownReviews.length && (
              <Row
                ghost
                title={`${today.length - shownReviews.length} more reviews today`}
                to={target ? `/repertoire/${target.id}` : "/dashboard"}
                right={<i className="fa fa-arrow-right" aria-hidden />}
              />
            )}
            <Row
              title="Browse full review history"
              meta="Correct and missed moves, with what you played"
              to={`/history/${target?.id ?? "white"}`}
              right={<i className="fa fa-arrow-right" aria-hidden />}
            />
          </Section>

          <Section
            title="Openings report"
            action={
              <span className="cb-row-meta">
                {report?.source === "local-reviews" ? "Local reviews" : "No report"}
              </span>
            }
          >
            {!report || reportRows.length === 0 ? (
              <Row
                ghost
                title={
                  daily.reviews > 0 ? "No wrong opening moves to report" : "No reviewed openings yet"
                }
                meta={
                  daily.reviews > 0
                    ? `Your ${daily.reviews} review${daily.reviews === 1 ? "" : "s"} today had no wrong moves.`
                    : report?.reason ||
                      "The report fills in from your own reviews. No online account is used."
                }
                to={target ? `/learn/${target.id}` : "/add"}
                right={<span className="cb-row-meta">Practice</span>}
              />
            ) : (
              reportRows.slice(0, 4).map((row) => {
                const repertoireId = reportTarget(row.color);
                return (
                  <Row
                    key={`${row.color}-${row.lineId}-${row.name}`}
                    title={row.name}
                    meta={`${row.wrong} wrong of ${row.reviews} reviews`}
                    to={
                      repertoireId
                        ? `/repertoire/${repertoireId}?line=${row.lineId}`
                        : "/dashboard"
                    }
                    right={
                      <span className="cb-row-meta strong">
                        {Math.round(row.accuracy)}% accurate
                      </span>
                    }
                  />
                );
              })
            )}
            {report && !report.capturedAvailable && (
              <Row
                ghost
                title="Imported opening report unavailable"
                meta="The reference capture contained an empty report; these rows are computed from this device's reviews."
              />
            )}
          </Section>

          <Section title="Review your own games">
            {today.length > 0 ? (
              <Row
                title="Open today's review history"
                to={target ? `/repertoire/${target.id}` : "/dashboard"}
                meta={`${today.length} moves reviewed today`}
                right={<i className="fa fa-arrow-right" aria-hidden />}
              />
            ) : null}
            <Row
              title="Import a PGN file"
              to="/add?tab=import"
              testId="import-pgn"
              meta="Local file only — no account, no OAuth"
              right={
                <span className="cb-row-meta strong">
                  Import <i className="fa fa-file-import" aria-hidden />
                </span>
              }
            />
            <Row
              ghost
              title="Export a repertoire"
              to={target ? `/repertoire/${target.id}` : "/add"}
              meta="PGN or JSON from this device"
              right={<span className="cb-row-meta">Export</span>}
            />
          </Section>

          <Section title="Feedback and help">
            <Row
              ghost
              title="Report an issue"
              meta="Opens the local build's GitHub issue tracker"
              onClick={() => {
                haptic();
                window.open(ISSUES_URL, "_blank", "noopener");
              }}
            />
            <Row
              ghost
              title="Copy this app's address"
              meta="Shares this local build, not a production account link"
              onClick={() => {
                haptic();
                navigator.clipboard?.writeText(window.location.origin).then(
                  () => toast("App address copied", "ok"),
                  () => toast("Could not copy the address", "bad")
                );
              }}
            />
          </Section>
        </Sidebar>
      </main>
    </div>
  );
}
