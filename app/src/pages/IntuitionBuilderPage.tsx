import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Color } from "../types";
import { Board } from "../components/Board";
import { Section, Splash, Stat } from "../components/ui";
import { PlayLayout } from "../components/play/PlayLayout";

interface Styles {
  aggressive: number;
  solid: number;
  sharp: number;
  learnable: number;
}

interface Summary {
  styles: Styles;
  styleSource: string;
  answers: number;
  sessions: number;
  label: string;
  secondary: string | null;
  ranked: string[];
  clarity: number;
  summary: string;
}

interface Position {
  epd: string;
  fen: string;
  side: Color;
  path: string[];
  moveNumber: number;
  label: string;
  prompt: string;
}

interface Session {
  id: string;
  total: number;
  index: number;
  complete: boolean;
  position: Position | null;
}

interface IndexResponse {
  positions: { epd: string; side: Color; path: string[]; candidateCount: number; complete: boolean }[];
  available: boolean;
  profile: { rating: number; games: number; attempts: number };
  summary: Summary;
  source: { type: string; note: string };
}

interface AnswerResponse {
  answer: {
    san: string;
    from: string;
    to: string;
    captured: boolean;
    stylePoints: Styles;
    styleSource: string;
    chosen: {
      san: string;
      probability: number | null;
      incidence: number | null;
      oneIn: number | null;
      eval: number | null;
      annotation: string | null;
    } | null;
  };
  top: {
    san: string;
    probability: number | null;
    incidence: number | null;
    oneIn: number | null;
    eval: number | null;
    masters: number | null;
    peerResults: { white: number | null; draw: number | null; black: number | null } | null;
    annotation: string | null;
  }[];
  session: Session;
  profile: { rating: number; games: number; attempts: number };
  summary: Summary;
  complete: boolean;
  result: (Summary & { answers: unknown[] }) | null;
}

const STYLE_LABEL: Record<keyof Styles, string> = {
  aggressive: "Aggressive",
  solid: "Solid",
  sharp: "Sharp",
  learnable: "Learnable",
};

const STYLE_COLOR: Record<keyof Styles, string> = {
  aggressive: "oklch(68% 0.17 35)",
  solid: "oklch(70% 0.11 220)",
  sharp: "oklch(72% 0.16 320)",
  learnable: "var(--cb-green)",
};

function StyleBars({ styles }: { styles: Styles }) {
  return (
    <div style={{ display: "grid", gap: 8, padding: "0 18px" }}>
      {(Object.keys(STYLE_LABEL) as (keyof Styles)[]).map((key) => (
        <div key={key}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: "var(--cb-text-3)",
              marginBottom: 4,
            }}
          >
            <span>{STYLE_LABEL[key]}</span>
            <strong>{styles[key]}%</strong>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              overflow: "hidden",
              background: "var(--cb-border-soft)",
            }}
          >
            <span
              style={{
                display: "block",
                height: "100%",
                width: `${Math.max(0, Math.min(100, styles[key]))}%`,
                background: STYLE_COLOR[key],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function IntuitionBuilderPage() {
  const [data, setData] = useState<IndexResponse | null>(null);
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [answeredPosition, setAnsweredPosition] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<IndexResponse>("/play/intuition-builder")
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setSummary(response.summary);
      })
      .catch((err) => setError(err.message || "The intuition builder could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, []);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      const response = await api.post<{
        session: Session;
        profile: { rating: number; games: number; attempts: number };
        summary: Summary;
      }>("/play/intuition-builder/session", { count: 4 });
      setSession(response.session);
      setSummary(response.summary);
    } catch (err) {
      setError((err as Error).message || "A session could not be started.");
    } finally {
      setBusy(false);
    }
  };

  const play = async (move: { san: string; from: string; to: string }) => {
    if (!session || answer || busy || session.complete) return;
    setBusy(true);
    setError("");
    const activePosition = session.position;
    try {
      const response = await api.post<AnswerResponse>("/play/intuition-builder/answer", {
        sessionId: session.id,
        index: session.index,
        san: move.san,
      });
      setAnswer(response);
      setAnsweredPosition(activePosition);
      setSession(response.session);
      setSummary(response.summary);
    } catch (err) {
      setError((err as Error).message || "That move could not be scored.");
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setAnswer(null);
    setAnsweredPosition(null);
    setError("");
  };

  if (error && !data) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <Link className="cb-btn" to="/dashboard">
          Back to dashboard
        </Link>
      </div>
    );
  }
  if (!data) return <Splash label="Loading the intuition builder…" />;

  const styles = summary?.styles ?? data.summary.styles;
  const position = answer
    ? answeredPosition
    : session?.complete
      ? null
      : session?.position ?? null;
  const finished = Boolean(session?.complete);

  return (
    <PlayLayout
      title="Intuition builder"
      subtitle="Play the move you like. Your style rating comes from the moves you actually choose."
      crumbs={[
        { label: "Intuition builder" },
        ...(session ? [{ label: `${Math.min(session.index + 1, session.total)} / ${session.total}` }] : []),
      ]}
      help="intuition-builder"
      board={
        position ? (
          <div>
            <Board
              fen={position.fen}
              orientation={position.side}
              interactive={!answer && !busy}
              onMove={play}
            />
            <div className="cb-board-footer visible" style={{ marginTop: 8 }}>
              <span>{position.prompt}</span>
            </div>
          </div>
        ) : (
          <Board fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" />
        )
      }
      boardFooter={
        <span>
          {finished
            ? "Session complete — your style is on the right"
            : session
              ? `Position ${session.index + 1} of ${session.total}`
              : "Start a short session"}
        </span>
      }
    >
      {error && (
        <div className="cb-inline-note" role="alert" style={{ margin: "12px 18px 0" }}>
          <i className="fa fa-triangle-exclamation" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <div className="cb-stat-grid" style={{ padding: "16px 18px 0" }}>
        <Stat value={styles.aggressive} label="Aggressive" />
        <Stat value={styles.solid} label="Solid" />
        <Stat value={styles.sharp} label="Sharp" />
        <Stat value={styles.learnable} label="Learnable" />
      </div>

      {!session && (
        <>
          <Section title="How it works">
            <div style={{ padding: "0 18px" }}>
              <div className="cb-inline-note">
                <i className="fa fa-brain" aria-hidden />
                <span>
                  You get {Math.min(4, data.positions.length)} real positions with captured
                  candidate data. Play the move you would actually choose; the captured play rate,
                  eval, master/peer splits and annotations decide the style points.
                </span>
              </div>
              <p style={{ margin: "10px 0 0", color: "var(--cb-text-3)", fontSize: 11 }}>
                {data.positions.length} captured positions available.
              </p>
              <button
                type="button"
                className="cb-btn primary wide"
                style={{ marginTop: 12 }}
                onClick={start}
                disabled={busy || !data.available}
              >
                {busy ? "Starting…" : "Start intuition session"}
              </button>
            </div>
          </Section>
          <Section title="Your style so far">
            <StyleBars styles={styles} />
            <p style={{ margin: "10px 18px 0", color: "var(--cb-text-3)", fontSize: 12 }}>
              {summary?.summary}
            </p>
            <p style={{ margin: "4px 18px 0", color: "var(--cb-text-3)", fontSize: 11 }}>
              {summary?.answers ?? 0} answers across {summary?.sessions ?? 0} sessions · style
              clarity {summary?.clarity ?? 0}%
            </p>
          </Section>
        </>
      )}

      {session && position && !answer && (
        <Section title={position.label}>
          <div style={{ padding: "0 18px" }}>
            <p style={{ margin: 0, color: "var(--cb-text-2)", fontSize: 13 }}>{position.prompt}</p>
            <p style={{ margin: "6px 0 0", color: "var(--cb-text-3)", fontSize: 11 }}>
              {position.path.length ? position.path.join(" ") : "Start position"} ·{" "}
              {position.side} to move
            </p>
          </div>
        </Section>
      )}

      {answer && (
        <Section title={answer.answer.captured ? "Your move" : "Your move (outside the capture)"}>
          <div style={{ padding: "0 18px", display: "grid", gap: 10 }}>
            <div
              className="cb-inline-note"
              style={{ background: "oklch(26% 0.02 150)" }}
            >
              <i className="fa fa-chess-pawn" aria-hidden />
              <span>
                You played <strong>{answer.answer.san}</strong>.
                {answer.answer.captured && answer.answer.chosen
                  ? ` Captured play rate ${
                      answer.answer.chosen.oneIn ? `1 in ${answer.answer.chosen.oneIn}` : "n/a"
                    }${answer.answer.chosen.eval != null ? `, eval ${answer.answer.chosen.eval}cp` : ""}.`
                  : " This move is not in the captured candidate list, so a local heuristic scored it."}
              </span>
            </div>
            {answer.answer.chosen?.annotation && (
              <p style={{ margin: 0, color: "var(--cb-text-3)", fontSize: 12 }}>
                {answer.answer.chosen.annotation}
              </p>
            )}
            <StyleBars styles={answer.answer.stylePoints} />
            <p style={{ margin: 0, color: "var(--cb-text-3)", fontSize: 11 }}>
              Style source: {answer.answer.styleSource === "captured-candidate" ? "captured candidate list" : "local heuristic"}.
            </p>
          </div>
          {answer.top.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="cb-section-head" style={{ padding: "0 18px 6px" }}>
                <span>What players actually choose here</span>
              </div>
              <div style={{ padding: "0 18px", display: "grid", gap: 4 }}>
                {answer.top.map((candidate) => (
                  <div
                    key={candidate.san}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      fontSize: 12,
                      color: candidate.san === answer.answer.san ? "var(--cb-green)" : "var(--cb-text-2)",
                    }}
                  >
                    <span>
                      {candidate.san}
                      {candidate.annotation ? ` · ${candidate.annotation}` : ""}
                    </span>
                    <span style={{ color: "var(--cb-text-3)", whiteSpace: "nowrap" }}>
                      {candidate.oneIn ? `1 in ${candidate.oneIn}` : "n/a"}
                      {candidate.eval != null ? ` · ${candidate.eval}cp` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ padding: "14px 18px 0" }}>
            {answer.complete ? (
              <button type="button" className="cb-btn primary wide" onClick={start} disabled={busy}>
                Play another session
              </button>
            ) : (
              <button type="button" className="cb-btn primary wide" onClick={next}>
                Next position
              </button>
            )}
          </div>
        </Section>
      )}

      {finished && summary && (
        <Section title="Your revealed style">
          <p style={{ margin: "0 18px", color: "var(--cb-text-2)", fontSize: 15 }}>
            <strong>{summary.label}</strong>
            {summary.secondary ? ` with ${summary.secondary.toLowerCase()} leanings` : ""}
          </p>
          <p style={{ margin: "6px 18px 0", color: "var(--cb-text-3)", fontSize: 12 }}>
            {summary.summary}
          </p>
          <div style={{ marginTop: 10 }}>
            <StyleBars styles={summary.styles} />
          </div>
          <p style={{ margin: "10px 18px 0", color: "var(--cb-text-3)", fontSize: 11 }}>
            Persisted locally · {summary.answers} answers across {summary.sessions} sessions.
          </p>
        </Section>
      )}
    </PlayLayout>
  );
}
