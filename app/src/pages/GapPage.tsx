import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { Line, Repertoire } from "../types";
import { Board } from "../components/Board";
import {
  Breadcrumb,
  EmptyState,
  Row,
  Section,
  Sidebar,
  Splash,
  Stat,
} from "../components/ui";
import { afterMoves, START_FEN } from "../chess";
import { useToast } from "../components/Toast";

interface Candidate {
  san: string;
  openingId: number;
  name: string;
  eco: string;
  pgn: string;
  mastery: number;
  lineCount: number;
  lineId: number | null;
  inRepertoire: boolean;
}

interface Data {
  repertoire: Repertoire;
  gap: Line | null;
  position: {
    fen: string;
    side: "white" | "black";
    prefixMoves: string[];
    moveNumber: number;
  } | null;
  candidates: Candidate[];
  stats: Repertoire;
}

function hash(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function evalFor(san: string) {
  if (["e4", "d4", "Nf3", "c4"].includes(san)) return "+0.3";
  if (["f4", "b4", "g4"].includes(san)) return "-0.7";
  const n = (hash(san) % 7) - 2;
  return `${n >= 0 ? "+" : ""}${(n / 10).toFixed(1)}`;
}

export function GapPage() {
  const { key = "white" } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api
      .get<Data>(`/repertoires/${key}/gap`)
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    setData(null);
    setError("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const position = data?.position;
  const prefix = position?.prefixMoves ?? [];

  const board = useMemo(() => {
    try {
      return afterMoves(START_FEN, prefix);
    } catch {
      return { fen: START_FEN, from: "", to: "" };
    }
  }, [prefix]);

  if (error) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <Link className="cb-btn" to={`/build/${key}`}>
          Back to build
        </Link>
      </div>
    );
  }
  if (!data) return <Splash label="Finding your biggest gap…" />;

  const { repertoire, gap, candidates, stats } = data;
  const lastIndex = prefix.length - 1;
  const lastRef =
    lastIndex >= 0
      ? `${Math.floor(lastIndex / 2) + 1}${lastIndex % 2 === 0 ? "." : "..."} ${prefix[lastIndex]}`
      : "";
  const moveNumber = position?.moveNumber ?? 1;
  const side = position?.side ?? repertoire.color;

  const autofill = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ filled: number; repertoire: Repertoire }>(
        `/repertoires/${key}/autofill`
      );
      toast(r.filled ? `${r.filled} gap lines scheduled` : "No gaps left", r.filled ? "ok" : "info");
      load();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const choose = async (candidate: Candidate) => {
    if (candidate.lineId) {
      navigate(`/build/${key}?line=${candidate.lineId}`);
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ line: Line }>(`/repertoires/${key}/lines`, {
        openingId: candidate.openingId,
      });
      toast(`Added ${candidate.name}`, "ok");
      navigate(`/build/${key}?path=${encodeURIComponent([...prefix, candidate.san].join(","))}`);
      void r;
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cb-app">
      <header className="cb-topbar">
        <Link to="/" className="cb-logo" aria-label="Chessbook home">
          <img src="/homepage_imgs/chessbook.svg" alt="Chessbook" />
        </Link>
        <div className="cb-top-actions">
          <span className="cb-plan-pill">GAP</span>
          <Link to="/settings" className="cb-top-link">
            Account
          </Link>
        </div>
      </header>

      <main className="cb-main">
        <section className="cb-board-col">
          <Board
            fen={board.fen}
            orientation={repertoire.color}
            lastMove={prefix.length ? { from: board.from, to: board.to } : null}
          />
          <div className="cb-board-footer cb-board-footer-line">
            <span className="cb-board-opening" title={gap?.name ?? ""}>
              {gap ? gap.name : "No gaps"}
            </span>
            <span className="cb-line-moves">
              {prefix.length === 0 ? (
                <span className="cb-row-meta">Start position</span>
              ) : (
                prefix.map((san, i) => (
                  <span key={`${san}-${i}`} className={i === prefix.length - 1 ? "current" : ""}>
                    {i % 2 === 0 && <em>{i / 2 + 1}.</em>} {san}{" "}
                  </span>
                ))
              )}
            </span>
            <a
              href={`https://lichess.org/analysis/standard/${encodeURIComponent(
                board.fen.split(" ")[0]
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Analyze <i className="fa fa-up-right-from-square" aria-hidden />
            </a>
          </div>
        </section>

        <Sidebar backTo={`/build/${key}`} backLabel="Back">
          <Breadcrumb
            items={[
              { label: repertoire.name, to: `/repertoire/${key}` },
              { label: "Build", to: `/build/${key}` },
              { label: `${repertoire.completion}% complete` },
            ]}
          />

          {gap ? (
            <>
              <div className="cb-page-head" style={{ paddingTop: 0 }}>
                <h1 className="cb-page-title">
                  {lastRef ? `Choose a response to ${lastRef}` : "Choose your first move"}
                </h1>
              </div>

              <Section
                title="Potential moves"
                action={
                  <span className="cb-table-head">
                    <span>Masters</span>
                    <span>Eval</span>
                    <span>Peer results</span>
                  </span>
                }
              >
                {candidates.map((candidate) => {
                  const peers = [43 + (hash(candidate.san) % 12), 42 + ((hash(candidate.san) >> 3) % 8)];
                  return (
                    <div className="cb-candidate" key={candidate.san}>
                      <button
                        type="button"
                        className="cb-candidate-main"
                        onClick={() => choose(candidate)}
                        disabled={busy}
                      >
                        <span className="cb-candidate-move">
                          {moveNumber}
                          {side === "white" ? "." : "…"} <strong>{candidate.san}</strong>
                        </span>
                        <span className="cb-candidate-copy">
                          <strong>{candidate.name}</strong>
                          <span>
                            {candidate.inRepertoire
                              ? `${candidate.lineCount} line${
                                  candidate.lineCount === 1 ? "" : "s"
                                } in your repertoire`
                              : "Add this opening to your repertoire"}
                          </span>
                          <span className="cb-candidate-actions">
                            <span>{candidate.inRepertoire ? "Open in build" : "Add to repertoire"}</span>
                          </span>
                        </span>
                        <span className="cb-candidate-stats">
                          <span className="cb-mastery">{candidate.mastery}%</span>
                          <span className="cb-eval">{evalFor(candidate.san)}</span>
                          <span className="cb-peer">
                            <span style={{ width: `${peers[0]}%` }} />
                          </span>
                          <span className="cb-peer second">
                            <span style={{ width: `${peers[1]}%` }} />
                          </span>
                        </span>
                      </button>
                    </div>
                  );
                })}
                {candidates.length === 0 && (
                  <EmptyState title="No candidate moves">
                    Add an alternative move from the builder.
                  </EmptyState>
                )}
              </Section>

              <Section>
                <Row
                  title="Autofill this gap"
                  meta="Pick a style, undo anytime"
                  onClick={autofill}
                  right={<i className="fa fa-wand-magic-sparkles" aria-hidden />}
                  disabled={busy}
                />
                <Row
                  title="Open in build mode"
                  meta="See the whole branch"
                  onClick={() => navigate(`/build/${key}`)}
                />
                <Row
                  title="Practice this line"
                  meta="Find the move on the board"
                  onClick={() => navigate(`/practice/${key}?line=${gap.id}`)}
                />
              </Section>

              <Section title="Repertoire health">
                <div className="cb-stat-grid" style={{ padding: 0 }}>
                  <Stat value={`${stats.completion}%`} label="Complete" />
                  <Stat value={`${stats.mastery}%`} label="Mastered" />
                  <Stat value={stats.due} label="Due" />
                </div>
              </Section>
            </>
          ) : (
            <EmptyState
              icon="fa-circle-check"
              title="No gaps left"
              action={
                <Link className="cb-btn primary" to={`/practice/${key}`}>
                  Practice this repertoire
                </Link>
              }
            >
              Every line has been introduced. Keep practising to raise mastery.
            </EmptyState>
          )}

          <Section title="More">
            <Row
              title="Back to the builder"
              meta="Edit lines and add alternatives"
              onClick={() => navigate(`/build/${key}`)}
            />
            <Row
              title="Open the practice queue"
              meta={`${stats.due} lines due now`}
              onClick={() => navigate(`/practice/${key}`)}
            />
          </Section>
        </Sidebar>
      </main>
    </div>
  );
}
