import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { ModelGame } from "../types";
import { Board } from "../components/Board";
import { BoardHeader, EmptyState, Row, Sidebar, Splash } from "../components/ui";
import { pgnTimeline, START_FEN } from "../chess";
import { useToast } from "../components/Toast";

export function ModelPage() {
  const { id } = useParams<{ id?: string }>();
  const { toast } = useToast();
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
          </div>

          <div className="cb-evalgraph" aria-label="Evaluation graph">
            <span className="cb-evalgraph-label">+0.3</span>
            <svg viewBox="0 0 100 22" preserveAspectRatio="none">
              <line x1="0" x2="100" y1="11" y2="11" stroke="rgba(255,255,255,.06)" strokeWidth=".4" />
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

          <div className="cb-model-copy">
            <p className="cb-model-match">
              This game matches your saved moves. Move the pieces on the board to guess the move
              at any point.
            </p>
            <p className="cb-model-description">{game.description}</p>
          </div>

          <div className="cb-model-rows">
            <Row
              title="Choose another random game"
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
              onClick={() => setPlaying(false)}
            />
            <Row
              title="Model games source"
              right={<span className="cb-setting-value">Online and master games</span>}
              onClick={() => toast("Model games are curated from online and master play.", "info")}
            />
          </div>
        </Sidebar>
      </main>
    </div>
  );
}
