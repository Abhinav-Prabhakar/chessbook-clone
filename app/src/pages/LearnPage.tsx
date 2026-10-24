import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type {
  DailySummary,
  Line,
  PracticeMode,
  PracticeSession,
  Repertoire,
} from "../types";
import { Board } from "../components/Board";
import {
  BoardHeader,
  Modal,
  Row,
  Section,
  Sidebar,
  Splash,
  Stat,
} from "../components/ui";
import { START_FEN } from "../chess";

interface Data {
  repertoire: Repertoire;
  queue: Line[];
  due: number;
  weak: number;
  all: number;
  common?: number;
  commonMoves?: {
    epd: string;
    fen: string;
    via: { san: string; incidence: number; oneIn: number; source: string | null };
  }[];
  commonSource?: string;
  reviewStyle?: string;
  practiceMode?: string;
}

interface LinesResponse {
  repertoire: Repertoire;
  lines: Line[];
}

const MODE_LABELS: Record<string, string> = {
  due: "Due review",
  weak: "Mistakes",
  all: "All moves",
  early: "Early review",
  specific: "Specific opening",
  line: "Specific opening",
  common: "Next common moves",
};

function tzOffset() {
  return new Date().getTimezoneOffset();
}

export function LearnPage() {
  const { key = "white" } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [latest, setLatest] = useState<PracticeSession | null>(null);
  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [error, setError] = useState("");
  const [showSpecific, setShowSpecific] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    setLatest(null);
    Promise.allSettled([
      api.get<Data>(`/repertoires/${key}/learn`),
      api.get<LinesResponse>(`/repertoires/${key}`),
      api.get<{ sessions: PracticeSession[] }>(
        `/practice/sessions?repertoire=${key}&status=all`
      ),
      api.get<{ daily: DailySummary }>(`/practice/daily?tzOffset=${tzOffset()}`),
    ]).then((results) => {
      if (cancelled) return;
      const [learnResult, linesResult, latestResult, dailyResult] = results;
      if (learnResult.status === "fulfilled") {
        setData(learnResult.value);
      } else {
        setError(learnResult.reason?.message || "The training queue could not be loaded.");
      }
      if (linesResult.status === "fulfilled") {
        setLines(linesResult.value.lines ?? []);
      }
      if (latestResult.status === "fulfilled") {
        setLatest(
          latestResult.value.sessions?.find((item) => item.status !== "complete") ?? null
        );
      }
      if (dailyResult.status === "fulfilled") {
        setDaily(dailyResult.value.daily ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (error) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <Link className="cb-btn" to={`/repertoire/${key}`}>
          Back to repertoire
        </Link>
      </div>
    );
  }
  if (!data) return <Splash label="Loading your training queue…" />;

  const { repertoire, queue } = data;
  const savedLines = lines.filter((line) => line.saved);
  const dueCount = repertoire.due ?? 0;
  const duePositions = repertoire.duePositions ?? dueCount;
  const weakCount = data.weak ?? 0;
  const moveCount = repertoire.moveCount ?? repertoire.lineCount ?? 0;
  const earlyCount = repertoire.learned ?? 0;
  const worked = queue[0] ?? null;
  const mastery = Number(repertoire.mastery ?? 0);

  /**
   * "Practice: Whole lines" is applied by the server when the session is
   * created (`practiceMode` in the settings row), so the Learn row always
   * asks for the real mode and the server expands it to complete lines
   * (D140). No client-side line guessing.
   */
  const start = (mode: PracticeMode) => {
    if (mode === "specific" || mode === "line") {
      setShowSpecific(true);
      return;
    }
    navigate(`/practice/${key}?mode=${mode}`);
  };

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader
            items={[
              { label: repertoire.name, to: `/repertoire/${key}` },
              { label: "Learn" },
            ]}
          />
          <Board
            fen={worked?.fen ?? START_FEN}
            orientation={repertoire.color}
            lastMove={null}
          />
          <div className="cb-board-footer cb-board-footer-line visible">
            <span className="cb-board-opening">
              {worked ? worked.name : "Nothing due — pick a review mode"}
            </span>
            <a
              href={`https://lichess.org/analysis/standard/${encodeURIComponent(
                (worked?.fen ?? START_FEN).split(" ")[0]
              )}?color=${repertoire.color}`}
              target="_blank"
              rel="noreferrer"
            >
              Analyze <i className="fa fa-up-right-from-square" aria-hidden />
            </a>
          </div>
        </section>

        <Sidebar backTo={`/repertoire/${key}`} backLabel="Back">
          <div className="cb-page-head">
            <h1 className="cb-page-title">What do you want to practice?</h1>
          </div>

          <div className="cb-progress-line">
            <div className="cb-progress-copy">
              <strong>{mastery.toFixed(1)}% mastered</strong>
            </div>
            <div className="cb-bar mastery">
              <span style={{ width: `${Math.max(0, Math.min(100, mastery))}%` }} />
            </div>
          </div>

          {daily && (
            <div
              style={{
                margin: "12px 18px 0",
                color: "var(--cb-text-3)",
                fontSize: 11,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <span>
                  Daily goal {daily.reviews}/{daily.goal}
                  {daily.goalMet ? " · met" : ""}
                </span>
                <span>
                  {daily.streak.current}-day streak
                  {daily.correct + daily.wrong > 0
                    ? ` · ${Math.round(
                        (daily.correct / Math.max(1, daily.correct + daily.wrong)) * 100
                      )}% today`
                    : ""}
                </span>
              </div>
              <div
                style={{
                  height: 4,
                  borderRadius: 2,
                  overflow: "hidden",
                  background: "var(--cb-border-soft)",
                }}
              >
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${
                      daily.goal > 0
                        ? Math.min(100, (daily.reviews / daily.goal) * 100)
                        : 0
                    }%`,
                    background: daily.goalMet ? "var(--cb-green)" : "var(--cb-blue)",
                  }}
                />
              </div>
            </div>
          )}

          {latest && (
            <div style={{ marginTop: 18 }}>
              <Section title="Where you left off">
                <Row
                  large
                  testId="resume-session"
                  title="Resume practice"
                  meta={`${MODE_LABELS[latest.mode] ?? "Review"} · ${latest.remaining} left`}
                  right={<i className="fa fa-arrow-right" aria-hidden />}
                  to={`/practice/${key}?session=${latest.id}`}
                />
              </Section>
            </div>
          )}

          <div className="cb-learn-options">
            <Row
              title="Everything that's due for review"
              right={
                <span className="cb-row-meta strong">
                  {dueCount} due <i className="fa fa-clock" aria-hidden />
                </span>
              }
              meta={
                dueCount > 0 && duePositions !== dueCount
                  ? `${duePositions} positions`
                  : undefined
              }
              onClick={() => start("due")}
              disabled={dueCount === 0}
            />
            <Row
              title="Next common moves"
              right={
                <span className="cb-row-meta">
                  {data.common ?? 0} positions{" "}
                  <i className="fa fa-shuffle" aria-hidden />
                </span>
              }
              meta="Likely opponent moves from captured incidence at your rating band"
              onClick={() => start("common")}
              disabled={(data.common ?? 0) === 0}
            />
            <Row
              title="Just the moves I often get wrong"
              right={
                <span className="cb-row-meta strong">
                  {weakCount} due <i className="fa fa-clock" aria-hidden />
                </span>
              }
              onClick={() => start("weak")}
              disabled={weakCount === 0}
            />
            <Row
              title="All moves, even if they're not due"
              right={<span className="cb-row-meta">{moveCount} moves</span>}
              onClick={() => start("all")}
              disabled={moveCount === 0}
            />
            <Row
              title="Review moves before they're due"
              right={<span className="cb-row-meta">{earlyCount} scheduled</span>}
              onClick={() => start("early")}
              disabled={earlyCount === 0}
            />
            <Row
              title="A specific opening…"
              onClick={() => start("specific")}
              disabled={savedLines.length === 0}
            />
            <Row
              title="Review history"
              meta="Every reviewed move, with what you played"
              to={`/history/${key}`}
              right={<i className="fa fa-arrow-right" aria-hidden />}
            />
          </div>

          {dueCount === 0 && (
            <div
              className="cb-inline-note"
              role="status"
              style={{ margin: "12px 18px 0" }}
            >
              <i className="fa fa-circle-check" aria-hidden />
              <span>
                Nothing is due right now. You can review early or walk through every saved
                move.
              </span>
            </div>
          )}

          <p
            style={{
              margin: "14px 18px 0",
              color: "var(--cb-text-3)",
              fontSize: 11,
            }}
          >
            Practice style:{" "}
            {(data.practiceMode ?? "individual") === "whole-lines"
              ? "Whole lines"
              : "Individual moves"}
            {" · Review style: "}
            {{
              cards: "Cards",
              "complete-once": "Complete lines (once)",
              "complete-every": "Complete lines (every time)",
              "entire-line": "Entire line",
            }[data.reviewStyle ?? "cards"] ?? "Cards"}{" "}
            ·{" "}
            <Link to="/settings" style={{ color: "inherit" }}>
              change in Settings
            </Link>
          </p>

          <div style={{ marginTop: 18 }}>
            <Section title="Review state">
              <div className="cb-stat-grid" style={{ padding: 0 }}>
                <Stat value={repertoire.fresh ?? 0} label="Fresh" />
                <Stat value={repertoire.learnedPositions ?? 0} label="Learned" />
                <Stat value={repertoire.masteredPositions ?? 0} label="Mastered" />
                <Stat value={duePositions} label="Due" />
              </div>
            </Section>
          </div>
          <p
            style={{
              margin: "10px 18px 0",
              color: "var(--cb-text-3)",
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            Scheduling is per move (FSRS). A move is mastered once its stability reaches 21
            days; finishing every move once completes the repertoire without mastering it.
          </p>
        </Sidebar>
      </main>

      {showSpecific && (
        <Modal
          title="Pick an opening to practice"
          onClose={() => setShowSpecific(false)}
        >
          <div className="cb-openings-scroll" style={{ maxHeight: 420 }}>
            {savedLines.length === 0 && (
              <p style={{ padding: "0 4px", color: "var(--cb-text-3)", fontSize: 12 }}>
                No saved openings yet. Add moves in build mode first.
              </p>
            )}
            {savedLines.map((line) => (
              <button
                type="button"
                key={line.id}
                className="cb-opening-row"
                onClick={() => {
                  setShowSpecific(false);
                  navigate(`/practice/${key}?mode=specific&line=${line.id}`);
                }}
              >
                <span className="cb-opening-main">
                  <strong>{line.name}</strong>
                  <span>
                    {line.moves.length} moves · {line.moves.join(" ")}
                  </span>
                </span>
                <span className="cb-row-meta strong">
                  {Number(line.mastered ?? 0).toFixed(1)}%
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
