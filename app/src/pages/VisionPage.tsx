import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Color } from "../types";
import { Section, Splash, Stat } from "../components/ui";
import { PlayLayout } from "../components/play/PlayLayout";
import { SelectBoard, type SquareMark } from "../components/play/SelectBoard";

interface Kind {
  id: string;
  label: string;
  prompt: string;
}

interface IndexResponse {
  kinds: Kind[];
  profile: {
    rating: number;
    games: number;
    attempts: number;
    correct: number;
    streak: number;
    bestStreak: number;
  };
  sources: { positions: number; modelGames: number; repertoirePositions: number; available: boolean };
  lastResult: {
    kind: string;
    exact: boolean;
    score: number;
    difficulty: number;
    at: string;
  } | null;
  note: string;
}

interface Session {
  id: string;
  kind: string;
  difficulty: number;
  fen: string;
  prompt: string;
  targetColor: Color;
  count: number;
  source: { type: string; label: string; detail: string };
  instructions: string;
}

interface VisionResult {
  kind: string;
  difficulty: number;
  exact: boolean;
  score: number;
  answer: string[];
  selected: string[];
  correctSquares: string[];
  wrongSquares: string[];
  missedSquares: string[];
  targetColor: Color;
  source: { type: string; label: string; detail: string };
}

interface AnswerResponse {
  result: VisionResult;
  profile: IndexResponse["profile"];
}

const DIFFICULTIES = [
  { level: 1, label: "Warm-up" },
  { level: 2, label: "Easy" },
  { level: 3, label: "Standard" },
  { level: 4, label: "Hard" },
  { level: 5, label: "Sharp" },
];

export function VisionPage() {
  const [data, setData] = useState<IndexResponse | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("hanging");
  const [difficulty, setDifficulty] = useState(2);
  const [session, setSession] = useState<Session | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [profile, setProfile] = useState<IndexResponse["profile"] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<IndexResponse>("/play/vision")
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setProfile(response.profile);
      })
      .catch((err) => setError(err.message || "Vision drills could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, []);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setSelected([]);
    try {
      const response = await api.post<{ session: Session; profile: IndexResponse["profile"] }>(
        "/play/vision/session",
        { kind, difficulty }
      );
      setSession(response.session);
      setProfile(response.profile);
    } catch (err) {
      setError((err as Error).message || "No drill could be generated for that target.");
      setSession(null);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (square: string) => {
    if (result) return;
    setSelected((current) =>
      current.includes(square) ? current.filter((entry) => entry !== square) : [...current, square]
    );
  };

  const submit = async () => {
    if (!session || busy || result) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post<AnswerResponse>("/play/vision/answer", {
        sessionId: session.id,
        squares: selected,
      });
      setResult(response.result);
      setProfile(response.profile);
    } catch (err) {
      setError((err as Error).message || "The answer could not be scored.");
    } finally {
      setBusy(false);
    }
  };

  const marks = useMemo(() => {
    const out: Record<string, SquareMark> = {};
    if (!result) {
      for (const square of selected) out[square] = "selected";
      return out;
    }
    for (const square of result.correctSquares) out[square] = "correct";
    for (const square of result.wrongSquares) out[square] = "wrong";
    for (const square of result.missedSquares) out[square] = "missed";
    return out;
  }, [result, selected]);

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
  if (!data) return <Splash label="Loading vision drills…" />;

  const currentProfile = profile ?? data.profile;
  const activeKind = data.kinds.find((entry) => entry.id === kind);

  return (
    <PlayLayout
      title="Vision"
      subtitle="Real positions, one question at a time. Click the squares that answer the prompt."
      crumbs={[
        { label: "Vision" },
        ...(session ? [{ label: activeKind?.label ?? session.kind }] : []),
      ]}
      help="vision"
      board={
        session ? (
          <div>
            <SelectBoard
              fen={session.fen}
              orientation={session.targetColor}
              selected={selected}
              marks={marks}
              onToggle={toggle}
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
                {session.targetColor === "white" ? "White" : "Black"} to move ·{" "}
                {result ? `${result.correctSquares.length}/${result.answer.length} found` : `${selected.length} selected`}
              </span>
              <span>{result ? `Score ${result.score}%` : `${session.count} target${session.count === 1 ? "" : "s"}`}</span>
            </div>
          </div>
        ) : (
          <SelectBoard
            fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
            selected={[]}
          />
        )
      }
      boardFooter={
        <span>
          {result
            ? result.exact
              ? "Perfect — every target square found"
              : "Review the highlighted squares"
            : session
              ? session.prompt
              : "Choose a drill on the right"}
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
        <Stat value={currentProfile.streak} label="Streak" />
        <Stat value={currentProfile.attempts} label="Drills" />
      </div>

      {!session && (
        <>
          <Section title="What to spot">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 18px" }}>
              {data.kinds.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={`cb-btn small${kind === entry.id ? " primary" : " ghost"}`}
                  onClick={() => setKind(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p style={{ margin: "8px 18px 0", color: "var(--cb-text-3)", fontSize: 11 }}>
              {activeKind?.prompt}
            </p>
          </Section>

          <Section title="Difficulty">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 18px" }}>
              {DIFFICULTIES.map((entry) => (
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
          </Section>

          <div style={{ padding: "18px" }}>
            <button
              type="button"
              className="cb-btn primary wide"
              onClick={start}
              disabled={busy || !data.sources.available}
            >
              {busy ? "Finding a position…" : "Start vision drill"}
            </button>
            <p style={{ margin: "8px 0 0", color: "var(--cb-text-3)", fontSize: 11 }}>
              {data.sources.positions} real positions ({data.sources.modelGames} model-game,{" "}
              {data.sources.repertoirePositions} repertoire).
            </p>
          </div>

          {data.lastResult && (
            <Section title="Last drill">
              <div style={{ padding: "0 18px", color: "var(--cb-text-3)", fontSize: 12 }}>
                {data.kinds.find((entry) => entry.id === data.lastResult?.kind)?.label ?? data.lastResult.kind} ·
                difficulty {data.lastResult.difficulty} · {data.lastResult.score}%{" "}
                {data.lastResult.exact ? "· perfect" : ""}
              </div>
            </Section>
          )}
        </>
      )}

      {session && (
        <Section title={activeKind?.label ?? session.kind}>
          <div style={{ padding: "0 18px" }}>
            <p style={{ margin: 0, color: "var(--cb-text-2)", fontSize: 13 }}>{session.prompt}</p>
            <p style={{ margin: "6px 0 0", color: "var(--cb-text-3)", fontSize: 11 }}>
              {session.source.detail} {session.source.label}
            </p>
            {result ? (
              <>
                <div
                  className="cb-inline-note"
                  style={{
                    marginTop: 10,
                    background: result.exact ? "oklch(30% 0.03 150)" : "oklch(28% 0.04 25)",
                  }}
                >
                  <i className={`fa ${result.exact ? "fa-check" : "fa-crosshairs"}`} aria-hidden />
                  <span>
                    {result.exact ? "Perfect." : `Score ${result.score}%.`} Answer:{" "}
                    {result.answer.join(", ") || "none"}.
                  </span>
                </div>
                {result.wrongSquares.length > 0 && (
                  <p style={{ margin: "8px 0 0", color: "var(--cb-danger)", fontSize: 12 }}>
                    Wrong: {result.wrongSquares.join(", ")}
                  </p>
                )}
                {result.missedSquares.length > 0 && (
                  <p style={{ margin: "4px 0 0", color: "oklch(72% 0.12 60)", fontSize: 12 }}>
                    Missed: {result.missedSquares.join(", ")}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button type="button" className="cb-btn primary" onClick={start} disabled={busy}>
                    Next drill
                  </button>
                  <button
                    type="button"
                    className="cb-btn ghost"
                    onClick={() => {
                      setSession(null);
                      setSelected([]);
                      setResult(null);
                    }}
                  >
                    Change drill
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  className="cb-btn primary"
                  onClick={submit}
                  disabled={busy || selected.length === 0}
                >
                  {busy ? "Scoring…" : `Submit ${selected.length} square${selected.length === 1 ? "" : "s"}`}
                </button>
                <button
                  type="button"
                  className="cb-btn ghost"
                  onClick={() => setSelected([])}
                  disabled={selected.length === 0}
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title="Scoring">
        <p style={{ margin: "0 18px", color: "var(--cb-text-3)", fontSize: 11 }}>
          Each correct square earns credit, each wrong square costs credit, and missed targets cost
          credit. An exact set is a perfect drill and extends the streak. {data.note}
        </p>
      </Section>
    </PlayLayout>
  );
}
