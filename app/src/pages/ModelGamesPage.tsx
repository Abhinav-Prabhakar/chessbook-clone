import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { BoardCaption, Crumbs, START_FEN, useBoard } from "../board/stage";
import type { Arrow, Mark } from "../board/Board";
import { forget, useApi } from "../useApi";
import type { Color, ModelGame } from "../types";
import { Back, Empty, ErrorNote, Icon, PageHead, Row, Section, Skeleton, useToast } from "../ui";
import { BoardStrip } from "../ui/MoveList";
import { useSettings } from "../settings";
import { playSound } from "../sounds";
import { buildPath } from "../routes";

interface HistoryRow {
  id: number;
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  event: string | null;
  year: number | null;
  result: string;
  plies: number;
  side: Color;
  ply: number;
  correct: number;
  wrong: number;
  completed: boolean;
  daily: string | null;
}

function players(g: { white: string; black: string; whiteElo: number | null; blackElo: number | null }) {
  const w = g.whiteElo ? `${g.white} (${g.whiteElo})` : g.white;
  const b = g.blackElo ? `${g.black} (${g.blackElo})` : g.black;
  return `${w} vs. ${b}`;
}

function resultText(result: string, white: string, black: string) {
  if (result === "1-0") return `${white} won`;
  if (result === "0-1") return `${black} won`;
  return "Draw";
}

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

  const today = daily.data?.game;
  return (
    <>
      <Crumbs items={[{ label: "Model games" }]} />
      <Back to="/" />
      <PageHead
        title="Model games"
        sub="Master games that start the way your repertoire does. Guess each move to learn the plans behind your openings."
      />
      <Section title="Today">
        <div className="rows">
          {today ? (
            <Row
              variant="accent"
              title={players(today)}
              meta={[today.opening?.name, today.event, today.year].filter(Boolean).join(" · ")}
              right={today.progress?.completed ? <Icon name="check" /> : <Icon name="star" />}
              to={`/model-games/${today.id}`}
              chevron
            />
          ) : daily.loading ? (
            <Skeleton rows={1} />
          ) : (
            <Row title="Model games are still being prepared" meta="The master game library is loading in the background. This takes under a minute the first time." onClick={() => daily.reload()} />
          )}
          <Row title={busy ? "Finding a game…" : "Another game from your openings"} onClick={random} disabled={busy} chevron />
        </div>
      </Section>
      <Section title="Previous games" right={history.data ? <span className="muted">{history.data.total.toLocaleString()} games in the library</span> : null}>
        {history.data && history.data.games.length === 0 && <Empty title="No games played yet" />}
        <div className="rows plain">
          {history.data?.games.map((g) => (
            <Row
              key={g.id}
              variant="plain"
              title={players(g)}
              meta={[g.event, g.year, resultText(g.result, g.white, g.black)].filter(Boolean).join(" · ")}
              right={
                <span className="muted">
                  {g.completed ? `${g.correct}/${g.correct + g.wrong} guessed` : g.ply ? "In progress" : "Not started"}
                </span>
              }
              to={`/model-games/${g.id}`}
              chevron
            />
          ))}
        </div>
      </Section>
    </>
  );
}

export function ModelGamePage() {
  const { gameId = "" } = useParams();
  const { settings } = useSettings();
  const { data, error, reload } = useApi<{ game: ModelGame }>(`/model-games/${gameId}`);
  const game = data?.game ?? null;
  const [side, setSide] = useState<Color>("white");
  const [ply, setPly] = useState(0); // moves shown on the board
  const [frontier, setFrontier] = useState(0); // furthest move reached
  const [results, setResults] = useState<Record<number, "good" | "bad">>({});
  const [tries, setTries] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [wrong, setWrong] = useState<{ from: string; to: string } | null>(null);
  const [paused, setPaused] = useState(false);
  const init = useRef<number | null>(null);

  useEffect(() => {
    if (!game || init.current === game.id) return;
    init.current = game.id;
    const start = game.progress?.completed ? game.sans.length : game.progress?.ply ?? 0;
    setSide(game.side);
    setPly(start);
    setFrontier(start);
    setResults({});
  }, [game]);

  const total = game?.sans.length ?? 0;
  const atFrontier = ply === frontier;
  const finished = game ? frontier >= total : false;
  const turn: Color = ply % 2 === 0 ? "white" : "black";
  const inBook = game ? frontier < game.follows : false;
  const guessing = Boolean(game) && atFrontier && !finished && turn === side && !inBook && !paused;

  const saveProgress = (next: number, res: Record<number, "good" | "bad">) => {
    if (!game) return;
    const values = Object.values(res);
    void api
      .post(`/model-games/${game.id}/progress`, {
        ply: next,
        correct: values.filter((v) => v === "good").length,
        wrong: values.filter((v) => v === "bad").length,
        completed: next >= game.sans.length,
      })
      .then(() => forget("/model-games"))
      .catch(() => {});
  };

  const step = (res = results) => {
    const next = frontier + 1;
    setFrontier(next);
    setPly(next);
    setTries(0);
    setReveal(false);
    if (next % 6 === 0 || next >= total) saveProgress(next, res);
  };

  // Play the opponent's moves (and the book moves) automatically.
  useEffect(() => {
    if (!game || !atFrontier || finished || guessing || paused) return;
    const delay = inBook ? 380 : Math.max(300, settings.autoplayDelay + 250);
    const t = window.setTimeout(() => step(), delay);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, frontier, ply, guessing, atFrontier, finished, paused, inBook]);

  const fenAt = (n: number) => (n === 0 ? START_FEN : game!.moves[n - 1].fen);
  const fen = game ? fenAt(ply) : START_FEN;
  const last = game && ply > 0 ? game.moves[ply - 1] : null;
  const expected = game && guessing ? game.moves[ply] : null;

  const onMove = (move: { san: string; from: string; to: string }) => {
    if (!expected) return;
    if (move.san === expected.san) {
      const res = { ...results, [ply]: tries === 0 && !reveal ? ("good" as const) : ("bad" as const) };
      setResults(res);
      if (tries === 0 && !reveal) playSound("correct");
      step(res);
      return;
    }
    setTries((t) => t + 1);
    setWrong({ from: move.from, to: move.to });
    playSound("wrong");
    window.setTimeout(() => setWrong(null), 600);
  };

  const arrows: Arrow[] = [];
  const marks: Mark[] = [];
  if (expected && reveal) arrows.push({ from: expected.from, to: expected.to, color: "orange" });
  else if (expected && tries >= 2) marks.push({ square: expected.from, color: "hint" });
  if (wrong) marks.push({ square: wrong.to, color: "bad" });

  useBoard(
    game
      ? {
          fen,
          orientation: side,
          lastMove: last ? { from: last.from, to: last.to } : null,
          interactive: Boolean(expected),
          arrows,
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

  const sideName = side === "white" ? game.white : game.black;
  return (
    <>
      <Crumbs items={[{ label: "Model games", to: "/model-games" }, { label: `${game.white} vs. ${game.black}` }]} />
      <BoardCaption>
        <BoardStrip title={game.opening?.name} fen={fen} orientation={side}>
          <div className="move-list">
            {game.sans.slice(0, frontier).map((san, i) => (
              <span key={i} className="ml-group">
                {i % 2 === 0 && <span className="ml-num">{i / 2 + 1}.</span>}
                <button
                  type="button"
                  className={`ml-move ml-click${i === ply - 1 ? " ml-current" : ""}${results[i] ? ` ml-${results[i]}` : ""}`}
                  onClick={() => setPly(i + 1)}
                >
                  {san}
                </button>
              </span>
            ))}
            {!finished && <span className="ml-pending">{guessing ? "?" : "…"}</span>}
          </div>
        </BoardStrip>
      </BoardCaption>
      <Back to="/model-games" />
      <PageHead
        title={
          <>
            {game.white} <span className="vs">vs.</span> {game.black}
          </>
        }
        sub={[game.event, game.year, resultText(game.result, game.white, game.black)].filter(Boolean).join(" · ")}
      />
      <div className="segmented small pad-x">
        {(["white", "black"] as Color[]).map((c) => (
          <button key={c} type="button" className={side === c ? "selected" : ""} onClick={() => setSide(c)}>
            Guess {c === "white" ? "White" : "Black"}
          </button>
        ))}
      </div>

      <div className="prompt">
        {finished ? (
          <>
            <div className="prompt-line">
              <span className="prompt-move">Game over · {game.result}</span>
            </div>
            <p className="prompt-note">
              You guessed {stats.good} of {stats.good + stats.bad} moves for {sideName}.
            </p>
          </>
        ) : !atFrontier ? (
          <p className="prompt-note">Reviewing move {ply}. Go back to the latest move to keep guessing.</p>
        ) : inBook ? (
          <p className="prompt-note">
            The game follows your {game.repertoire?.name ?? "repertoire"} for {game.follows} moves. Playing them…
          </p>
        ) : guessing ? (
          <>
            <div className="prompt-line">
              <span className="prompt-move">What did {sideName} play?</span>
            </div>
            <p className="prompt-note">{tries > 0 ? "Not the game move. Try again, or reveal it." : "Move a piece to guess."}</p>
          </>
        ) : (
          <p className="prompt-note">{paused ? "Paused." : "Watching the reply…"}</p>
        )}
        <div className="score-line">
          <span className="good-text">
            {stats.good} <Icon name="check" />
          </span>
          <span className="bad-text">
            {stats.bad} <Icon name="x" />
          </span>
          <span className="muted">
            Move {Math.ceil(frontier / 2)} of {Math.ceil(total / 2)}
          </span>
        </div>
      </div>

      <div className="rows actions">
        {guessing && !reveal && <Row title="Show me the move" onClick={() => setReveal(true)} />}
        {!atFrontier && <Row title="Back to the latest move" onClick={() => setPly(frontier)} />}
        {atFrontier && !finished && <Row title={paused ? "Resume" : "Pause"} onClick={() => setPaused((p) => !p)} />}
        {!finished && (
          <Row
            title="Skip to the end"
            onClick={() => {
              setFrontier(total);
              setPly(total);
              saveProgress(total, results);
            }}
          />
        )}
        {game.repertoire && (
          <Row
            title={`Open in ${game.repertoire.name}`}
            meta="See this position in your builder"
            to={buildPath(game.repertoire.id, game.sans.slice(0, Math.max(1, Math.min(ply, game.follows + 1))))}
            chevron
          />
        )}
        <Row title="Play a training game from here" to={`/training-games?path=${encodeURIComponent(game.sans.slice(0, ply).join(","))}&color=${side}`} chevron />
      </div>
    </>
  );
}
