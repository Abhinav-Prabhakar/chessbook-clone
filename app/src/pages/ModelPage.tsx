import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { ModelGame } from "../types";
import { Board } from "../components/Board";
import {
  BoardHeader,
  EmptyState,
  ProgressRing,
  Row,
  Section,
  Sidebar,
  Splash,
} from "../components/ui";
import { pgnTimeline, START_FEN } from "../chess";
import { useToast } from "../components/Toast";

export function ModelPage() {
  const { id } = useParams<{ id?: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [games, setGames] = useState<ModelGame[] | null>(null);
  const [gameId, setGameId] = useState<number | null>(id ? Number(id) : null);
  const [ply, setPly] = useState(0);
  const [playing, setPlaying] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    api
      .get<{ games: ModelGame[] }>("/model-games")
      .then((r) => {
        setGames(r.games);
        const first = gameId ? r.games.find((g) => g.id === gameId) ?? r.games[0] : r.games[0];
        if (first) {
          setGameId(first.id);
          setPly(first.progress || 0);
        }
      })
      .catch((e) => toast(e.message, "bad"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const game = useMemo(
    () => games?.find((g) => g.id === gameId) ?? games?.[0] ?? null,
    [games, gameId]
  );

  const timeline = useMemo(() => {
    if (!game) return null;
    try {
      return pgnTimeline(game.pgn);
    } catch {
      return { sans: [], fens: [START_FEN], moves: [] };
    }
  }, [game]);

  const maxPly = timeline?.moves.length ?? 0;
  const safePly = Math.min(ply, maxPly);
  const evalPoints = useMemo(() => {
    const count = Math.max(1, maxPly);
    let value = 0;
    const points: number[] = [];
    for (let i = 0; i <= count; i++) {
      if (i === 0) value = 0;
      else {
        const san = timeline?.moves[i - 1]?.san ?? "";
        value += san.includes("x") ? 0.16 : 0.06;
        if (san.includes("+") || san.includes("#")) value += 0.1;
        value = Math.max(-1.2, Math.min(1.8, value * 0.92));
      }
      points.push(value);
    }
    return points;
  }, [timeline, maxPly]);

  useEffect(() => {
    setPly((p) => Math.min(p, maxPly));
  }, [maxPly]);

  useEffect(() => {
    if (!playing) return;
    if (safePly >= maxPly) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setPly((p) => Math.min(p + 1, maxPly)), 850);
    return () => window.clearTimeout(timer);
  }, [playing, safePly, maxPly]);

  useEffect(() => {
    if (!game) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.post(`/model-games/${game.id}/progress`, { ply: safePly }).catch(() => {});
    }, 350);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [game, safePly]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setPly((p) => Math.min(p + 1, maxPly));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPly((p) => Math.max(p - 1, 0));
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maxPly]);

  if (!games) return <Splash label="Loading model games…" />;

  if (!game || !timeline) {
    return (
      <div className="cb-app">
        <main className="cb-main">
          <section className="cb-board-col">
            <Board fen={START_FEN} />
          </section>
          <Sidebar backTo="/" backLabel="Back">
            <EmptyState icon="fa-star" title="No model games yet">
              Model games will appear here when the database is seeded.
            </EmptyState>
          </Sidebar>
        </main>
      </div>
    );
  }

  const move = safePly > 0 ? timeline.moves[safePly - 1] : null;
  const fen = timeline.fens[safePly] ?? START_FEN;

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader items={[{ label: "Model games" }]} />
          <Board
            fen={fen}
            lastMove={move ? { from: move.from, to: move.to } : null}
          />
          <div className="cb-board-footer">
            <span>
              {game.white} vs. {game.black} · {game.event} {game.year}
            </span>
            <a
              href={`https://lichess.org/analysis/standard/${encodeURIComponent(fen.split(" ")[0])}`}
              target="_blank"
              rel="noreferrer"
            >
              Analyze <i className="fa fa-up-right-from-square" aria-hidden />
            </a>
          </div>
        </section>

        <Sidebar backTo="/" backLabel="Back">
          <div className="cb-page-head">
            <h1 className="cb-page-title">
              {game.white} <span className="cb-vs">vs.</span> {game.black}
            </h1>
            <p className="cb-page-sub">
              {game.event} · {game.year} · {game.result} · {safePly}/{maxPly} plies
            </p>
          </div>

          <div className="cb-evalgraph" aria-label="Evaluation graph">
            <svg viewBox="0 0 100 22" preserveAspectRatio="none">
              <path
                d={`M 0 11 ${evalPoints
                  .map((v, i) => {
                    const x = (i / Math.max(1, evalPoints.length - 1)) * 100;
                    const y = 11 - v * 4.2;
                    return `L ${x.toFixed(2)} ${y.toFixed(2)}`;
                  })
                  .join(" ")} L 100 11 Z`}
                fill="rgba(235,235,235,.82)"
              />
              <line
                x1={(safePly / Math.max(1, maxPly)) * 100}
                x2={(safePly / Math.max(1, maxPly)) * 100}
                y1="0"
                y2="22"
                stroke="oklch(70% .15 230)"
                strokeWidth=".5"
              />
            </svg>
          </div>

          <div className="cb-model-actions">
            <button
              type="button"
              className="cb-model-action"
              onClick={() => {
                setPlaying(false);
                setPly((p) => Math.min(maxPly, p + 1));
              }}
            >
              Play next move
            </button>
            <button
              type="button"
              className="cb-model-action"
              onClick={() => {
                const next = timeline?.moves[safePly];
                toast(next ? `Hint: ${next.san}` : "The game is over.", "info");
              }}
            >
              Give me a hint
            </button>
          </div>

          <Section title="Model game">
            <div className="cb-panel">
              <p>{game.description}</p>
            </div>
          </Section>

          <Section
            title="Moves"
            action={
              <span className="cb-row-meta">
                <ProgressRing value={maxPly ? (safePly / maxPly) * 100 : 0} size={12} />{" "}
                {maxPly ? Math.round((safePly / maxPly) * 100) : 0}%
              </span>
            }
          >
            <div className="cb-move-list">
              {timeline.moves.map((m, i) => (
                <button
                  type="button"
                  key={`${m.san}-${i}`}
                  className={`cb-move-pill ${safePly === i + 1 ? "active" : ""} ${
                    safePly > i + 1 ? "past" : ""
                  }`}
                  onClick={() => {
                    setPly(i + 1);
                    setPlaying(false);
                  }}
                >
                  {i % 2 === 0 && <span className="cb-move-number">{i / 2 + 1}.</span>}
                  {m.san}
                </button>
              ))}
            </div>
          </Section>

          <Section>
            <Row
              title="Choose another random game"
              meta={
                games.length > 1
                  ? "Switch to another game in this collection"
                  : "More model games are coming soon"
              }
              onClick={() => {
                if (games.length < 2) {
                  toast("Only one model game is loaded in this collection.", "info");
                  return;
                }
                const index = games.findIndex((g) => g.id === game.id);
                const next = games[(index + 1) % games.length];
                setGameId(next.id);
                setPly(next.progress || 0);
                setPlaying(false);
              }}
            />
            <Row
              title="View previous model games"
              meta={`${games.length} game${games.length === 1 ? "" : "s"} in this collection`}
              onClick={() => setPlaying(false)}
            />
            <Row
              title="Model games source"
              meta="Online and master games"
              onClick={() => toast("Model games are curated from online and master play.", "info")}
            />
            <Row
              title="Practice your repertoire"
              meta="Turn this idea into your own moves"
              onClick={() => navigate("/practice/white")}
            />
          </Section>

          <p className="cb-keyboard-hint">
            <i className="fa fa-keyboard" aria-hidden /> Use ← → to step and space to play/pause.
          </p>
        </Sidebar>
      </main>
    </div>
  );
}
