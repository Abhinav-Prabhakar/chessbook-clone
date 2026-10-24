import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { BoardCaption, Crumbs, useBoard } from "../board/stage";
import { moveFromUci, replay } from "../chess";
import { useApi } from "../useApi";
import type { Color, RepertoireSummary } from "../types";
import { Back, Button, ErrorNote, PageHead, Row, Section, Skeleton, moveLabel, useToast } from "../ui";
import { BoardStrip, MoveList } from "../ui/MoveList";
import { buildPath, parsePath } from "../routes";
import { useSettings } from "../settings";

interface GameView {
  id: string;
  color: Color;
  botRating: number;
  fen: string;
  sans: string[];
  lastMove: { from: string; to: string } | null;
  status: "playing" | "over";
  result: string | null;
  reason: string | null;
  turn: Color;
  repertoireId: number | null;
  book: { ply: number; san?: string; yours?: boolean; expected?: string[]; inBook?: boolean } | null;
}

const RATINGS = [800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

export function TrainingGamesPage() {
  const { gameId } = useParams();
  return gameId ? <TrainingGame id={gameId} /> : <TrainingSetup />;
}

function nearestRating(r: number) {
  return RATINGS.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a));
}

function TrainingSetup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings } = useSettings();
  const path = parsePath(params.get("path"));
  const presetColor = params.get("color") as Color | null;
  const repertoireParam = params.get("repertoire");
  const reps = useApi<{ repertoires: RepertoireSummary[] }>("/repertoires");
  const history = useApi<{ games: { id: string; color: Color; botRating: number; result: string | null; reason: string | null; status: string; moves: number; createdAt: string }[] }>("/training");
  const [color, setColor] = useState<Color>(presetColor === "black" ? "black" : "white");
  const [rating, setRating] = useState(() => nearestRating(settings.rating + (settings.ratingSystem === "chesscom" ? 150 : 0)));
  const [busy, setBusy] = useState(false);
  const start = replay(path);
  useBoard({ fen: start.fen, lastMove: start.lastMove, orientation: color, peek: false });

  const repertoire =
    reps.data?.repertoires.find((r) => String(r.id) === repertoireParam) ??
    reps.data?.repertoires.find((r) => r.color === color && r.started) ??
    null;

  const begin = async () => {
    setBusy(true);
    try {
      const game = await api.post<GameView>("/training", { color, botRating: rating, path, repertoireId: repertoire?.id ?? null });
      navigate(`/training-games/${game.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Crumbs items={[{ label: "Training games" }]} />
      <BoardCaption>
        <BoardStrip title={path.length ? "Starting position" : ""}>{path.length > 0 && <MoveList sans={path} />}</BoardStrip>
      </BoardCaption>
      <Back to="/" />
      <PageHead
        title="Training games"
        sub="Play a game against a bot. In the opening it plays the moves real players at its rating play, so you meet the lines you'll actually face."
      />
      <Section title="Play as">
        <div className="segmented big">
          {(["white", "black"] as Color[]).map((c) => (
            <button key={c} type="button" className={color === c ? "selected" : ""} onClick={() => setColor(c)}>
              <span className={`color-dot ${c}`} /> {c === "white" ? "White" : "Black"}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Opponent strength" right={<span className="muted">Lichess rating</span>}>
        <div className="chips pad-x">
          {RATINGS.map((r) => (
            <button key={r} type="button" className={`chip${r === rating ? " selected" : ""}`} onClick={() => setRating(r)}>
              {r}
            </button>
          ))}
        </div>
      </Section>
      {repertoire && (
        <p className="context-line">
          You'll be told when the game leaves your <strong>{repertoire.name}</strong>.
        </p>
      )}
      <div className="pad">
        <Button onClick={begin} disabled={busy}>
          {busy ? "Starting…" : path.length ? "Play from this position" : "Play"}
        </Button>
      </div>
      {history.data && history.data.games.length > 0 && (
        <Section title="Recent games">
          <div className="rows plain">
            {history.data.games.slice(0, 8).map((g) => (
              <Row
                key={g.id}
                variant="plain"
                title={`${g.color === "white" ? "White" : "Black"} vs. bot (${g.botRating})`}
                meta={g.status === "playing" ? `In progress · ${g.moves} moves` : `${resultFor(g.result, g.color)} · ${g.reason}`}
                to={`/training-games/${g.id}`}
                chevron
              />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function resultFor(result: string | null, color: Color) {
  if (!result) return "Unfinished";
  if (result === "1/2-1/2") return "Draw";
  const won = (result === "1-0") === (color === "white");
  return won ? "You won" : "You lost";
}

function TrainingGame({ id }: { id: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, reload, setData } = useApi<GameView>(`/training/${id}`);
  const [pending, setPending] = useState<{ fen: string; lastMove: { from: string; to: string }; san: string } | null>(null);
  const [view, setView] = useState<number | null>(null); // ply being reviewed
  const game = data;

  useEffect(() => setView(null), [game?.sans.length]);

  const onMove = async (move: { uci: string; from: string; to: string; san: string }) => {
    if (!game || pending) return;
    const local = moveFromUci(game.fen, move.uci);
    if (!local) return;
    setPending({ fen: local.fen, lastMove: { from: move.from, to: move.to }, san: local.san });
    try {
      const next = await api.post<GameView>(`/training/${game.id}/move`, { uci: move.uci });
      setData(next);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPending(null);
    }
  };

  const reviewing = view != null && game && view < game.sans.length;
  const reviewPos = reviewing ? replay(game!.sans.slice(0, view!)) : null;
  useBoard(
    game
      ? {
          fen: pending?.fen ?? reviewPos?.fen ?? game.fen,
          lastMove: pending?.lastMove ?? reviewPos?.lastMove ?? game.lastMove ?? null,
          orientation: game.color,
          interactive: game.status === "playing" && game.turn === game.color && !pending && !reviewing,
          peek: false,
          onMove,
        }
      : null
  );

  if (error && !game) return <ErrorNote error={error} retry={reload} />;
  if (!game) return <Skeleton rows={5} />;

  const sans = pending ? [...game.sans, pending.san] : game.sans;
  const over = game.status === "over";
  const book = game.book;
  let bookText: React.ReactNode = null;
  if (book && !book.inBook && game.repertoireId) {
    const where = moveLabel(book.ply, book.san || "");
    bookText = book.yours ? (
      <>
        You left your repertoire with <strong>{where}</strong>
        {book.expected?.length ? (
          <>
            . Your move there is <strong className="good-text">{book.expected.join(" or ")}</strong>.
          </>
        ) : (
          ". You haven't saved a move for that position yet."
        )}
      </>
    ) : (
      <>
        Your opponent played <strong>{where}</strong>, which you haven't prepared yet.
      </>
    );
  } else if (book?.inBook && game.repertoireId && game.sans.length) {
    bookText = "Still in your repertoire.";
  }

  return (
    <>
      <Crumbs items={[{ label: "Training games", to: "/training-games" }, { label: `vs. bot (${game.botRating})` }]} />
      <BoardCaption>
        <BoardStrip fen={game.fen} orientation={game.color}>
          <MoveList sans={sans} current={reviewing ? view! - 1 : sans.length - 1} onSelect={(i) => setView(i + 1 >= game.sans.length ? null : i + 1)} />
        </BoardStrip>
      </BoardCaption>
      <Back to="/training-games" />
      <PageHead
        title={over ? resultFor(game.result, game.color) : game.turn === game.color ? "Your move" : "Bot is thinking…"}
        sub={over ? `${game.result} · ${game.reason}` : `You play ${game.color} against a ${game.botRating} bot.`}
      />
      {bookText && <p className="context-line">{bookText}</p>}
      <div className="rows actions">
        {book && !book.inBook && game.repertoireId && (
          <Row
            title={book.yours ? "Check this position in your repertoire" : "Prepare a response to it"}
            to={buildPath(game.repertoireId, game.sans.slice(0, book.yours ? book.ply : book.ply + 1))}
            chevron
          />
        )}
        {reviewing && <Row title="Back to the game" onClick={() => setView(null)} />}
        {!over && (
          <Row
            title="Resign"
            onClick={async () => {
              setData(await api.post<GameView>(`/training/${game.id}/resign`));
            }}
          />
        )}
        <Row title="New game" onClick={() => navigate("/training-games")} chevron />
        {over && (
          <Row
            title="Analyze on Lichess"
            onClick={() => window.open(`https://lichess.org/analysis/pgn/${encodeURIComponent(game.sans.join(" "))}`, "_blank")}
          />
        )}
      </div>
    </>
  );
}
