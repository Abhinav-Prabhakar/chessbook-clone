import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Chess } from "chess.js";
import { api } from "../api";
import { Board } from "../components/Board";
import { Section, Splash, Stat } from "../components/ui";
import { PlayLayout } from "../components/play/PlayLayout";

interface Difficulty {
  level: number;
  hiddenMoves: number;
  speedMs: number;
  label: string;
}

interface Mode {
  id: "reconstruct" | "questions";
  label: string;
  detail: string;
}

interface IndexResponse {
  profile: { rating: number; games: number; attempts: number; correct: number };
  difficulties: Difficulty[];
  modes: Mode[];
  sources: { modelGames: number; repertoireLines: number; available: boolean };
  lastResult: {
    mode: string;
    score: number;
    correct: number;
    total: number;
    difficulty: number;
    at: string;
  } | null;
}

interface Session {
  id: string;
  mode: "reconstruct" | "questions";
  difficulty: number;
  difficultyLabel: string;
  hiddenMoves: number;
  speedMs: number;
  startFen: string;
  source: { type: string; label: string; detail: string };
  playback: { index: number; fen: string; from: string; to: string }[];
  questions: { prompt: string; options: string[] }[];
  instructions: string;
}

interface AnswerResult {
  mode: string;
  correct: number;
  total: number;
  score: number;
  prefix?: number;
  moves?: { index: number; expected: string; played: string | null; correct: boolean }[];
  expected?: string[];
  played?: string[];
  questions?: {
    prompt: string;
    options: string[];
    answer: number;
    submitted: number | null;
    correct: boolean;
  }[];
}

interface AnswerResponse {
  result: AnswerResult;
  profile: { rating: number; games: number; attempts: number; correct: number; streak: number };
}

export function VisualizationPage() {
  const [data, setData] = useState<IndexResponse | null>(null);
  const [error, setError] = useState("");
  const [difficulty, setDifficulty] = useState(3);
  const [mode, setMode] = useState<"reconstruct" | "questions">("reconstruct");
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<"setup" | "watching" | "answer" | "result">("setup");
  const [frame, setFrame] = useState(-1);
  const [replayFen, setReplayFen] = useState("");
  const [replaySan, setReplaySan] = useState<string[]>([]);
  const [replayLast, setReplayLast] = useState<{ from: string; to: string } | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [profile, setProfile] = useState<IndexResponse["profile"] | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<IndexResponse>("/play/visualization")
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setProfile(response.profile);
      })
      .catch((err) => setError(err.message || "Visualization could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  const beginWatching = (next: Session) => {
    setSession(next);
    setPhase("watching");
    setFrame(-1);
    setResult(null);
    setAnswers(next.questions.map(() => -1));
    setReplayFen(next.startFen);
    setReplaySan([]);
    setReplayLast(null);
    if (timer.current) window.clearInterval(timer.current);
    let index = -1;
    timer.current = window.setInterval(() => {
      index += 1;
      if (index >= next.playback.length) {
        if (timer.current) window.clearInterval(timer.current);
        timer.current = null;
        window.setTimeout(() => {
          setPhase("answer");
        }, 650);
        return;
      }
      setFrame(index);
    }, next.speedMs);
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post<{ session: Session; profile: IndexResponse["profile"] }>(
        "/play/visualization/session",
        { difficulty, mode }
      );
      beginWatching(response.session);
    } catch (err) {
      setError((err as Error).message || "A visualization drill could not be started.");
    } finally {
      setBusy(false);
    }
  };

  const finishWatching = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    if (session) setFrame(session.playback.length - 1);
    setPhase("answer");
  };

  const replayMove = (move: { san: string; from: string; to: string }) => {
    if (phase !== "answer" || !session) return;
    try {
      const chess = new Chess(replayFen);
      const played = chess.move(move.san);
      setReplayFen(chess.fen());
      setReplaySan((current) => [...current, played.san]);
      setReplayLast({ from: played.from, to: played.to });
    } catch {
      // The board already validates moves; ignore an unexpected replay error.
    }
  };

  const resetReplay = () => {
    if (!session) return;
    setReplayFen(session.startFen);
    setReplaySan([]);
    setReplayLast(null);
  };

  const submit = async () => {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      const body =
        session.mode === "questions"
          ? { sessionId: session.id, answers }
          : { sessionId: session.id, moves: replaySan };
      const response = await api.post<AnswerResponse>("/play/visualization/answer", body);
      setResult(response.result);
      setProfile(response.profile);
      setPhase("result");
    } catch (err) {
      setError((err as Error).message || "The answer could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  const shownFen = useMemo(() => {
    if (!session) return "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    if (phase === "watching") return frame < 0 ? session.startFen : session.playback[frame]?.fen ?? session.startFen;
    if (phase === "answer" && session.mode === "reconstruct") return replayFen || session.startFen;
    return session.startFen;
  }, [session, phase, frame, replayFen]);

  const shownLast = useMemo(() => {
    if (!session) return null;
    if (phase === "watching") {
      const current = session.playback[frame];
      return current ? { from: current.from, to: current.to } : null;
    }
    return replayLast;
  }, [session, phase, frame, replayLast]);

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
  if (!data) return <Splash label="Loading visualization training…" />;

  const currentProfile = profile ?? data.profile;

  return (
    <PlayLayout
      title="Visualization"
      subtitle="Watch the hidden moves, then reconstruct them or answer questions about the position."
      crumbs={[
        { label: "Visualization" },
        ...(session ? [{ label: `${session.difficultyLabel} · ${session.hiddenMoves} moves` }] : []),
      ]}
      help="visualization"
      board={
        <div>
          <Board
            fen={shownFen}
            orientation="white"
            interactive={phase === "answer" && session?.mode === "reconstruct"}
            lastMove={shownLast}
            onMove={replayMove}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              marginTop: 8,
              color: "var(--cb-text-3)",
              fontSize: 12,
            }}
          >
            <span>
              {phase === "watching"
                ? `Watching move ${Math.max(1, frame + 1)} / ${session?.hiddenMoves ?? 0}`
                : phase === "answer" && session?.mode === "reconstruct"
                  ? `Replay ${replaySan.length} / ${session?.hiddenMoves ?? 0} moves`
                  : "Hidden-move playback"}
            </span>
            <span>{session?.source?.label ?? "Real captured game"}</span>
          </div>
        </div>
      }
      boardFooter={
        <span>
          {phase === "watching"
            ? "Watch carefully — the move list is not shown."
            : phase === "answer"
              ? session?.instructions
              : phase === "result"
                ? `Score ${result?.score ?? 0}%`
                : "Pick a difficulty and start"}
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
        <Stat value={Math.round(currentProfile.rating)} label="Rating" />
        <Stat value={currentProfile.games} label="Drills" />
        <Stat value={currentProfile.correct} label="Perfect" />
      </div>

      {phase === "setup" && (
        <>
          <Section title="Difficulty">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 18px" }}>
              {data.difficulties.map((entry) => (
                <button
                  type="button"
                  key={entry.level}
                  className={`cb-btn small${difficulty === entry.level ? " primary" : " ghost"}`}
                  onClick={() => setDifficulty(entry.level)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p style={{ margin: "8px 18px 0", color: "var(--cb-text-3)", fontSize: 11 }}>
              {data.difficulties.find((entry) => entry.level === difficulty)?.hiddenMoves} hidden
              moves at{" "}
              {data.difficulties.find((entry) => entry.level === difficulty)?.speedMs}ms per move.
            </p>
          </Section>

          <Section title="Mode">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 18px" }}>
              {data.modes.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={`cb-btn small${mode === entry.id ? " primary" : " ghost"}`}
                  onClick={() => setMode(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p style={{ margin: "8px 18px 0", color: "var(--cb-text-3)", fontSize: 11 }}>
              {data.modes.find((entry) => entry.id === mode)?.detail}
            </p>
          </Section>

          <div style={{ padding: "18px" }}>
            <button
              type="button"
              className="cb-btn primary wide"
              onClick={start}
              disabled={busy || !data.sources.available}
            >
              {busy ? "Building drill…" : "Start drill"}
            </button>
            <p style={{ margin: "8px 0 0", color: "var(--cb-text-3)", fontSize: 11 }}>
              Positions come from {data.sources.modelGames} captured model game(s) and{" "}
              {data.sources.repertoireLines} saved repertoire line(s).
            </p>
          </div>

          {data.lastResult && (
            <Section title="Last drill">
              <div style={{ padding: "0 18px", color: "var(--cb-text-3)", fontSize: 12 }}>
                {data.lastResult.mode === "questions" ? "Position questions" : "Reconstruct"} ·
                difficulty {data.lastResult.difficulty} · {data.lastResult.correct}/
                {data.lastResult.total} · {data.lastResult.score}%
              </div>
            </Section>
          )}
        </>
      )}

      {phase === "watching" && session && (
        <Section title="Watch the moves">
          <div style={{ padding: "0 18px" }}>
            <p style={{ margin: 0, color: "var(--cb-text-2)", fontSize: 13 }}>
              {session.instructions}
            </p>
            <p style={{ margin: "6px 0 0", color: "var(--cb-text-3)", fontSize: 11 }}>
              {session.source.detail}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="cb-btn ghost" onClick={finishWatching}>
                I&apos;m ready
              </button>
            </div>
          </div>
        </Section>
      )}

      {phase === "answer" && session && session.mode === "reconstruct" && (
        <Section title="Reconstruct the moves">
          <div style={{ padding: "0 18px" }}>
            <p style={{ margin: 0, color: "var(--cb-text-2)", fontSize: 13 }}>
              Play the {session.hiddenMoves} moves from the start position.
            </p>
            <p style={{ margin: "6px 0 0", color: "var(--cb-text-3)", fontSize: 11 }}>
              Replayed: {replaySan.length ? replaySan.join(" ") : "—"}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="cb-btn primary" onClick={submit} disabled={busy}>
                {busy ? "Scoring…" : "Submit reconstruction"}
              </button>
              <button type="button" className="cb-btn ghost" onClick={resetReplay} disabled={!replaySan.length}>
                Reset
              </button>
            </div>
          </div>
        </Section>
      )}

      {phase === "answer" && session && session.mode === "questions" && (
        <Section title="Position questions">
          <div style={{ padding: "0 18px", display: "grid", gap: 14 }}>
            {session.questions.map((question, questionIndex) => (
              <div key={question.prompt}>
                <p style={{ margin: "0 0 6px", color: "var(--cb-text-2)", fontSize: 13 }}>
                  {questionIndex + 1}. {question.prompt}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {question.options.map((option, optionIndex) => (
                    <button
                      type="button"
                      key={option}
                      className={`cb-btn small${
                        answers[questionIndex] === optionIndex ? " primary" : " ghost"
                      }`}
                      onClick={() =>
                        setAnswers((current) => {
                          const next = [...current];
                          next[questionIndex] = optionIndex;
                          return next;
                        })
                      }
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <button type="button" className="cb-btn primary" onClick={submit} disabled={busy}>
                {busy ? "Scoring…" : "Submit answers"}
              </button>
            </div>
          </div>
        </Section>
      )}

      {phase === "result" && result && (
        <Section title="Result">
          <div className="cb-stat-grid" style={{ padding: "0 18px" }}>
            <Stat value={`${result.score}%`} label="Score" />
            <Stat value={`${result.correct}/${result.total}`} label="Correct" />
            <Stat value={session?.difficultyLabel ?? "—"} label="Difficulty" />
          </div>
          {result.moves && (
            <div className="cb-move-list" style={{ marginTop: 12 }}>
              {result.moves.map((move) => (
                <span
                  key={move.index}
                  className="cb-move-pill past"
                  style={{ color: move.correct ? "var(--cb-green)" : "var(--cb-danger)" }}
                  title={`Expected ${move.expected}${move.played ? ` · played ${move.played}` : ""}`}
                >
                  {move.index + 1}. {move.expected}
                  {move.correct ? " ✓" : ` ✗${move.played ? ` (${move.played})` : ""}`}
                </span>
              ))}
            </div>
          )}
          {result.questions && (
            <div style={{ padding: "12px 18px 0", display: "grid", gap: 10 }}>
              {result.questions.map((question, index) => (
                <div key={question.prompt} style={{ fontSize: 12 }}>
                  <p style={{ margin: 0, color: "var(--cb-text-2)" }}>
                    {index + 1}. {question.prompt}
                  </p>
                  <p
                    style={{
                      margin: "2px 0 0",
                      color: question.correct ? "var(--cb-green)" : "var(--cb-danger)",
                    }}
                  >
                    {question.correct ? "Correct" : "Incorrect"} ·{" "}
                    {question.options[question.answer]}
                    {!question.correct && question.submitted != null
                      ? ` (you chose ${question.options[question.submitted]})`
                      : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, padding: "16px 18px 0" }}>
            <button type="button" className="cb-btn primary" onClick={start} disabled={busy}>
              Play again
            </button>
            <button
              type="button"
              className="cb-btn ghost"
              onClick={() => {
                setPhase("setup");
                setResult(null);
                setSession(null);
              }}
            >
              Change settings
            </button>
          </div>
        </Section>
      )}
    </PlayLayout>
  );
}
