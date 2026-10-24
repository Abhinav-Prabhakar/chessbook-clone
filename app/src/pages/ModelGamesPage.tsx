import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { BoardCaption, Crumbs, START_FEN, useBoard } from "../board/stage";
import type { Mark } from "../board/Board";
import { forget, useApi } from "../useApi";
import type { Color, ModelGame } from "../types";
import { Back, Empty, ErrorNote, PageHead, Row, Section, Skeleton, useToast } from "../ui";
import { BoardStrip } from "../ui/MoveList";
import { playSound } from "../sounds";
import { buildPath } from "../routes";

interface HistoryRow {
  id: number;
  white: string;
  black: string;
  event: string | null;
  year: number | null;
  result: string;
  side: Color;
  completed: boolean;
  correct: number;
  wrong: number;
  daily: string | null;
  updatedAt: string;
  opening?: string | null;
}

function short(name: string) {
  const parts = name.split(" ");
  return parts[parts.length - 1];
}

function weekLabel(iso: string) {
  const d = new Date(iso);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const day = monday.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `Week of ${monday.toLocaleDateString(undefined, { month: "short" })} ${day}${suffix}`;
}

/* -------------------------------------------------------------- history --- */

export function ModelGamesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const daily = useApi<{ game: ModelGame | null }>("/model-games/daily");
  const history = useApi<{ games: HistoryRow[]; total: number }>("/model-games/history");
  const [busy, setBusy] = useState(false);
  useBoard({ fen: START_FEN, orientation: "white", peek: true });

  const random = async () => {
    setBusy(true);
    try {
      const { game } = await api.post<{ game: ModelGame | null }>("/model-games/random");
      if (game) navigate(`/model-games/${game.id}`);
      else toast("Model games are still being prepared. Try again in a moment.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const weeks = new Map<string, HistoryRow[]>();
  for (const game of history.data?.games || []) {
    const label = weekLabel(game.updatedAt);
    if (!weeks.has(label)) weeks.set(label, []);
    weeks.get(label)!.push(game);
  }
  const today = daily.data?.game;

  return (
    <>
      <Crumbs items={[{ label: "Model games" }]} />
      <Back to="/" />
      <PageHead title="Your model games history" />
      <Row
        variant="accent"
        className="block-row flush"
        title={today ? "Play through today's game" : daily.loading ? "Finding today's game…" : "Today's game is still being prepared"}
        right={today ? <span className="setting-value">{short(today.white)} vs. {short(today.black)}</span> : null}
        to={today ? `/model-games/${today.id}` : undefined}
        onClick={today ? undefined : () => daily.reload()}
      />
      <div className="rows list spaced-sm">
        <Row title={busy ? "Finding a game…" : "Choose another random game"} onClick={random} disabled={busy} />
      </div>
      {history.data && history.data.games.length === 0 && <Empty title="No games yet" />}
      {[...weeks.entries()].map(([label, games]) => (
        <Section key={label} title={label}>
          <div className="rows list">
            {games.map((g) => (
              <Row
                key={g.id}
                title={
                  <span className="rep-title compact">
                    <span className={`color-dot ${g.side}`} />
                    {short(g.white)} vs. {short(g.black)}
                  </span>
                }
                right={
                  <span className="setting-value">
                    {g.opening ?? (g.completed ? `${g.correct}/${g.correct + g.wrong} guessed` : "")}
                  </span>
                }
                to={`/model-games/${g.id}`}
              />
            ))}
          </div>
        </Section>
      ))}
      {history.data && <p className="hint-text">{history.data.total.toLocaleString()} master games in the library.</p>}
    </>
  );
}

/* ----------------------------------------------------------------- game --- */

function EvalGraph({
  evals,
  total,
  ply,
  onSeek,
}: {
  evals: (number | null)[];
  total: number;
  ply: number;
  onSeek: (ply: number) => void;
}) {
  const W = 600;
  const H = 100;
  const n = Math.max(2, total + 1);
  const x = (i: number) => (i / (n - 1)) * W;
  // Squash evaluations so small edges are visible and big ones don't dominate.
  const y = (v: number | null) => H / 2 - (Math.tanh((v ?? 0) / 4) * H) / 2;
  const points = evals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = points.length ? `M0,${H / 2} L${points.join(" L")} L${x(evals.length - 1).toFixed(1)},${H / 2} Z` : "";
  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        onSeek(Math.round(((e.clientX - rect.left) / rect.width) * (n - 1)));
      }}
    >
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="eval-mid" />
      {area && <path d={area} className="eval-area" />}
      <line x1={x(ply)} x2={x(ply)} y1="0" y2={H} className="eval-cursor" />
    </svg>
  );
}

export function ModelGamePage() {
  const { gameId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useApi<{ game: ModelGame }>(`/model-games/${gameId}`);
  const game = data?.game ?? null;
  const [ply, setPly] = useState(0);
  const [results, setResults] = useState<Record<number, "good" | "bad">>({});
  const [hint, setHint] = useState(false);
  const [wrong, setWrong] = useState<{ from: string; to: string } | null>(null);
  const [evals, setEvals] = useState<(number | null)[]>([]);
  const [busy, setBusy] = useState(false);
  const init = useRef<number | null>(null);

  useEffect(() => {
    if (!game || init.current === game.id) return;
    init.current = game.id;
    setPly(game.progress?.completed ? 0 : game.progress?.ply ?? 0);
    setResults({});
  }, [game]);

  // Evaluations are computed by Stockfish in the background; poll until ready.
  useEffect(() => {
    if (!game) return;
    let stop = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const res = await api.get<{ status: string; evals: (number | null)[] }>(`/model-games/${game.id}/evals`);
        if (stop) return;
        setEvals(res.evals);
        if (res.status !== "ready") timer = window.setTimeout(poll, 1000);
      } catch {
        // The graph is optional.
      }
    };
    void poll();
    return () => {
      stop = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [game]);

  const total = game?.sans.length ?? 0;
  const fen = game && ply > 0 ? game.moves[ply - 1].fen : START_FEN;
  const last = game && ply > 0 ? game.moves[ply - 1] : null;
  const next = game && ply < total ? game.moves[ply] : null;

  const saveProgress = (at: number, res: Record<number, "good" | "bad">) => {
    if (!game) return;
    const values = Object.values(res);
    void api
      .post(`/model-games/${game.id}/progress`, {
        ply: at,
        correct: values.filter((v) => v === "good").length,
        wrong: values.filter((v) => v === "bad").length,
        completed: at >= total,
      })
      .then(() => forget("/model-games"))
      .catch(() => {});
  };

  const advance = (res = results) => {
    const at = Math.min(total, ply + 1);
    setPly(at);
    setHint(false);
    if (at % 6 === 0 || at >= total) saveProgress(at, res);
  };

  const onMove = (move: { san: string; from: string; to: string }) => {
    if (!next) return;
    if (move.san === next.san) {
      const res = results[ply] ? results : { ...results, [ply]: hint ? ("bad" as const) : ("good" as const) };
      setResults(res);
      if (!results[ply] && !hint) playSound("correct");
      advance(res);
      return;
    }
    if (!results[ply]) setResults({ ...results, [ply]: "bad" });
    setWrong({ from: move.from, to: move.to });
    playSound("wrong");
    window.setTimeout(() => setWrong(null), 600);
  };

  const marks: Mark[] = [];
  if (next && hint) marks.push({ square: next.from, color: "hint" });
  if (wrong) marks.push({ square: wrong.to, color: "bad" });

  useBoard(
    game
      ? {
          fen,
          orientation: game.side,
          lastMove: last ? { from: last.from, to: last.to } : null,
          interactive: Boolean(next),
          marks,
          peek: false,
          onMove,
        }
      : null
  );

  const stats = useMemo(() => {
    const values = Object.values(results);
    return { good: values.filter((v) => v === "good").length, bad: values.filter((v) => v === "bad").length };
  }, [results]);

  if (error && !game) return <ErrorNote error={error} retry={reload} />;
  if (!game) return <Skeleton rows={6} />;

  const elo = (name: string, rating: number | null) => (rating ? `${name} (${rating})` : name);
  const moves = Math.ceil(total / 2);
  const outcome =
    game.result === "1-0"
      ? `${short(game.white)} defeated ${short(game.black)} in ${moves} moves.`
      : game.result === "0-1"
        ? `${short(game.black)} defeated ${short(game.white)} in ${moves} moves.`
        : `the game was drawn after ${moves} moves.`;

  const random = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ game: ModelGame | null }>("/model-games/random");
      if (res.game) navigate(`/model-games/${res.game.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const from = Math.max(0, ply - 6);
  return (
    <>
      <Crumbs items={[{ label: "Model games", to: "/model-games" }]} />
      <BoardCaption>
        <BoardStrip title={game.opening?.name} fen={fen} orientation={game.side}>
          <div className="move-list">
            {game.sans.slice(from, ply).map((san, k) => {
              const i = from + k;
              return (
                <span key={i} className="ml-group">
                  {(i % 2 === 0 || k === 0) && (
                    <span className="ml-num">
                      {Math.floor(i / 2) + 1}
                      {i % 2 === 0 ? "." : "…"}
                    </span>
                  )}
                  <button
                    type="button"
                    className={`ml-move ml-click${i === ply - 1 ? " ml-current" : ""}${results[i] ? ` ml-${results[i]}` : ""}`}
                    onClick={() => setPly(i + 1)}
                  >
                    {san}
                  </button>
                </span>
              );
            })}
          </div>
        </BoardStrip>
      </BoardCaption>
      <Back to="/model-games" />
      <PageHead title={`${short(game.white)} vs. ${short(game.black)}`} />
      <div className="eval-wrap">
        <EvalGraph evals={evals} total={total} ply={ply} onSeek={(p) => setPly(Math.max(0, Math.min(total, p)))} />
      </div>
      <div className="button-pair">
        <button type="button" className="btn btn-secondary" onClick={() => advance()} disabled={!next}>
          {next ? "Play next move" : "End of the game"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setHint(true)} disabled={!next || hint}>
          Give me a hint
        </button>
      </div>
      <div className="game-text">
        <p className="lead">
          {game.repertoire && game.opening
            ? `This game matches your saved moves in the ${game.opening.name}. `
            : game.opening
              ? `This game is a ${game.opening.name}. `
              : ""}
          Move the pieces on the board to guess the move at any point.
        </p>
        <p>
          In this game between {elo(game.white, game.whiteElo)} and {elo(game.black, game.blackElo)}
          {game.event ? ` at the "${game.event}"` : ""}
          {game.year ? ` (${game.year})` : ""}, {outcome}
        </p>
        {stats.good + stats.bad > 0 && (
          <p className="muted">
            You've guessed {stats.good} of {stats.good + stats.bad} moves.
          </p>
        )}
      </div>
      <div className="rows list">
        <Row title={busy ? "Finding a game…" : "Choose another random game"} onClick={random} disabled={busy} />
        <Row title="View previous model games" to="/model-games" />
        {game.repertoire && game.follows > 0 && (
          <Row title={`Open in ${game.repertoire.name}`} to={buildPath(game.repertoire.id, game.sans.slice(0, game.follows))} />
        )}
      </div>
    </>
  );
}
