import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Color } from "../types";
import { Board } from "../components/Board";
import { Section, Splash, Stat } from "../components/ui";
import { PlayLayout } from "../components/play/PlayLayout";

interface Puzzle {
  key: string;
  source: "model-game" | "repertoire-mistake";
  kind: string;
  sourceLabel: string;
  sourceDetail: string;
  fen: string;
  side: Color;
  moveNumber: number | null;
  cpLoss: number | null;
  evalBefore: number | null;
  evalAfter: number | null;
  difficulty: number;
  solved: boolean;
  attempts: number;
  lineName: string | null;
  repertoireName: string | null;
}

interface Profile {
  rating: number;
  attempts: number;
  correct: number;
  streak: number;
  bestStreak: number;
}

interface ListResponse {
  puzzles: Puzzle[];
  counts: {
    total: number;
    modelGame: number;
    repertoireMistakes: number;
    solved: number;
  };
  profile: Profile;
  recentAttempts: { id: number; itemKey: string; correct: boolean; score: number; createdAt: string }[];
  engine: { name: string; note: string };
}

interface AttemptResponse {
  correct: boolean;
  result: "solved" | "wrong" | "gave-up";
  best: { san: string; from: string | null; to: string | null; uci: string | null };
  alternatives: string[];
  played: {
    san: string;
    from: string;
    to: string;
    cpLoss: number | null;
    classification: string | null;
  } | null;
  cpLoss: number | null;
  classification: string | null;
  explanation: string;
  source: {
    type: string;
    label: string;
    detail: string;
    playedInGame?: string | null;
    evalBefore?: number | null;
    evalAfter?: number | null;
  };
  key: string;
  puzzle: Puzzle;
  profile: Profile;
}

const SOURCE_LABEL: Record<string, string> = {
  "model-game": "Captured model game",
  "repertoire-mistake": "Your repertoire mistake",
};

export function BlunderPuzzlesPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<Puzzle | null>(null);
  const [attempt, setAttempt] = useState<AttemptResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await api.get<ListResponse>("/play/blunder-puzzles");
    setData(response);
    setCurrent((existing) => {
      if (existing) {
        const refreshed = response.puzzles.find((puzzle) => puzzle.key === existing.key);
        if (refreshed) return refreshed;
      }
      return response.puzzles.find((puzzle) => !puzzle.solved) ?? response.puzzles[0] ?? null;
    });
    return response;
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message || "Puzzles could not be loaded."));
  }, [load]);

  const nextPuzzle = (response: ListResponse, excludeKey?: string) => {
    const candidates = response.puzzles.filter((puzzle) => puzzle.key !== excludeKey);
    const pool = candidates.filter((puzzle) => !puzzle.solved);
    const chosen = (pool.length ? pool : candidates)[0];
    setCurrent(chosen ?? response.puzzles[0] ?? null);
    setAttempt(null);
    setError("");
  };

  const attemptMove = async (move: { san: string; from: string; to: string }) => {
    if (!current || attempt || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post<AttemptResponse>("/play/blunder-puzzles/attempt", {
        key: current.key,
        san: move.san,
      });
      setAttempt(response);
      setData((existing) =>
        existing
          ? {
              ...existing,
              profile: response.profile,
              counts: {
                ...existing.counts,
                solved: existing.counts.solved + (response.correct && !current.solved ? 1 : 0),
              },
              puzzles: existing.puzzles.map((puzzle) =>
                puzzle.key === response.key
                  ? { ...puzzle, solved: puzzle.solved || response.correct, attempts: puzzle.attempts + 1 }
                  : puzzle
              ),
            }
          : existing
      );
    } catch (err) {
      setError((err as Error).message || "That move was not accepted.");
    } finally {
      setBusy(false);
    }
  };

  const giveUp = async () => {
    if (!current || attempt || busy) return;
    setBusy(true);
    try {
      const response = await api.post<AttemptResponse>("/play/blunder-puzzles/attempt", {
        key: current.key,
        giveUp: true,
      });
      setAttempt(response);
      setData((existing) =>
        existing
          ? {
              ...existing,
              profile: response.profile,
              puzzles: existing.puzzles.map((puzzle) =>
                puzzle.key === response.key
                  ? { ...puzzle, attempts: puzzle.attempts + 1 }
                  : puzzle
              ),
            }
          : existing
      );
    } catch (err) {
      setError((err as Error).message || "Could not reveal the answer.");
    } finally {
      setBusy(false);
    }
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
  if (!data) return <Splash label="Loading blunder puzzles…" />;

  const profile = data.profile;
  const arrows =
    attempt?.best?.from && attempt?.best?.to
      ? [{ from: attempt.best.from, to: attempt.best.to, kind: "hint" as const }]
      : [];
  const wrongMove =
    attempt && !attempt.correct && attempt.played
      ? { from: attempt.played.from, to: attempt.played.to }
      : null;

  return (
    <PlayLayout
      title="Blunder puzzles"
      subtitle="Real positions, real eval swings. Find the move that keeps the position."
      crumbs={[
        { label: "Blunder puzzles" },
        ...(current ? [{ label: SOURCE_LABEL[current.source] ?? current.source }] : []),
      ]}
      help="blunder-puzzles"
      board={
        current ? (
          <div>
            <Board
              fen={current.fen}
              orientation={current.side}
              interactive={!attempt && !busy}
              lastMove={null}
              wrongMove={wrongMove}
              arrows={arrows}
              onMove={attemptMove}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                marginTop: 8,
                color: "var(--cb-text-3)",
                fontSize: 12,
              }}
            >
              <span>
                {current.side === "white" ? "White" : "Black"} to move
                {current.moveNumber ? ` · move ${current.moveNumber}` : ""}
              </span>
              <span>{current.difficulty} puzzle rating</span>
            </div>
          </div>
        ) : (
          <Board fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" />
        )
      }
      boardFooter={
        <span>
          {attempt
            ? attempt.correct
              ? "Solved — best move found"
              : "Not the best move — the answer is shown"
            : "Guess the best move"}
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
        <Stat value={Math.round(profile.rating)} label="Puzzle rating" />
        <Stat value={profile.streak} label="Streak" />
        <Stat value={`${profile.correct}/${profile.attempts}`} label="Solved" />
      </div>

      {current ? (
        <>
          <Section title={current.sourceLabel}>
            <div style={{ padding: "0 18px", display: "grid", gap: 8 }}>
              <div className="cb-inline-note">
                <i
                  className={`fa ${
                    current.source === "model-game" ? "fa-book-open" : "fa-repeat"
                  }`}
                  aria-hidden
                />
                <span>
                  {current.sourceDetail}
                  {current.cpLoss != null ? ` Captured swing: ${current.cpLoss}cp.` : ""}
                </span>
              </div>
              {attempt ? (
                <div
                  className="cb-inline-note"
                  role="status"
                  style={{
                    background: attempt.correct
                      ? "oklch(30% 0.03 150)"
                      : "oklch(28% 0.04 25)",
                  }}
                >
                  <i
                    className={`fa ${attempt.correct ? "fa-check" : "fa-xmark"}`}
                    aria-hidden
                  />
                  <span>
                    <strong>
                      {attempt.correct ? "Correct" : attempt.result === "gave-up" ? "Answer" : "Best move"}
                    </strong>{" "}
                    — {attempt.explanation}
                    {attempt.played ? ` You played ${attempt.played.san}.` : ""}
                    {attempt.cpLoss != null ? ` (${attempt.cpLoss}cp lost)` : ""}
                  </span>
                </div>
              ) : (
                <p style={{ margin: 0, color: "var(--cb-text-3)", fontSize: 12 }}>
                  Play the move you think is best. You can give up and see the answer, but that
                  resets the streak.
                </p>
              )}
              {attempt && attempt.alternatives.length > 1 && (
                <p style={{ margin: 0, color: "var(--cb-text-3)", fontSize: 11 }}>
                  Also accepted: {attempt.alternatives.join(", ")}
                </p>
              )}
              {attempt?.source?.playedInGame && (
                <p style={{ margin: 0, color: "var(--cb-text-3)", fontSize: 11 }}>
                  In the captured game, {attempt.source.playedInGame} was played here
                  {attempt.source.evalBefore != null && attempt.source.evalAfter != null
                    ? ` (${attempt.source.evalBefore}cp → ${attempt.source.evalAfter}cp)`
                    : ""}
                  .
                </p>
              )}
            </div>
          </Section>

          <div style={{ display: "flex", gap: 8, padding: "18px" }}>
            {!attempt ? (
              <button type="button" className="cb-btn ghost" onClick={giveUp} disabled={busy}>
                {busy ? "Checking…" : "I don't know — show me"}
              </button>
            ) : (
              <button
                type="button"
                className="cb-btn primary"
                onClick={() => nextPuzzle(data, current.key)}
              >
                Next puzzle
              </button>
            )}
          </div>
        </>
      ) : (
        <Section title="No puzzles available">
          <div style={{ padding: "0 18px" }}>
            <div className="cb-inline-note">
              <i className="fa fa-circle-info" aria-hidden />
              <span>
                Puzzles come from captured model-game eval swings and your own missed repertoire
                moves. Open the model games or practice a repertoire to create more.
              </span>
            </div>
            <p style={{ marginTop: 12 }}>
              <Link className="cb-btn" to="/model">
                Open model games
              </Link>
            </p>
          </div>
        </Section>
      )}

      <Section title="Puzzle sources">
        <div style={{ padding: "0 18px", display: "grid", gap: 6, fontSize: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Captured model-game swings</span>
            <strong>{data.counts.modelGame}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Saved repertoire mistakes</span>
            <strong>{data.counts.repertoireMistakes}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Solved</span>
            <strong>
              {data.counts.solved}/{data.counts.total}
            </strong>
          </div>
        </div>
        <p style={{ margin: "10px 18px 0", color: "var(--cb-text-3)", fontSize: 11 }}>
          {data.engine.note}
        </p>
      </Section>

      {data.puzzles.length > 1 && (
        <Section title="All puzzles">
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {data.puzzles.map((puzzle) => (
              <button
                type="button"
                key={puzzle.key}
                className={`cb-row${puzzle.key === current?.key ? " selected" : ""}`}
                onClick={() => {
                  setCurrent(puzzle);
                  setAttempt(null);
                  setError("");
                }}
              >
                <span className="cb-row-main">
                  <span className="cb-row-title">{puzzle.sourceLabel}</span>
                  <span className="cb-row-meta">
                    {SOURCE_LABEL[puzzle.source] ?? puzzle.source} · {puzzle.difficulty}
                    {puzzle.cpLoss != null ? ` · ${puzzle.cpLoss}cp` : ""}
                  </span>
                </span>
                <span className="cb-row-right">
                  {puzzle.solved ? (
                    <i className="fa fa-circle-check" aria-hidden style={{ color: "var(--cb-green)" }} />
                  ) : puzzle.attempts > 0 ? (
                    <span className="cb-row-meta">{puzzle.attempts} tries</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </PlayLayout>
  );
}
