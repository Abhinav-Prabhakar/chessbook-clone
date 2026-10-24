import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Chess } from "chess.js";
import { api } from "../api";
import type { Color } from "../types";
import { Board } from "../components/Board";
import { Row, Section, Splash, Stat } from "../components/ui";
import { PlayLayout } from "../components/play/PlayLayout";
import { ChessClock } from "../components/play/ChessClock";

interface TimeControl {
  id: string;
  label: string;
  initialMs: number;
  incrementMs: number;
}

interface GameMove {
  ply: number;
  moveNumber: number;
  side: Color;
  san: string;
  from: string;
  to: string;
  by: "player" | "bot";
  clockMs: { white: number; black: number };
}

interface GameResult {
  outcome: "win" | "loss" | "draw";
  reason: string;
  label: string;
}

interface ReviewMove {
  ply: number;
  side: Color;
  san: string;
  bestSan: string | null;
  cpLoss: number;
  classification: string;
  accuracy: number;
  byPlayer: boolean;
}

interface Review {
  available: boolean;
  accuracy: number;
  averageCpLoss: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  bestMoves: number;
  playerMoves: number;
  headline: string;
  summary: string;
  moves: ReviewMove[];
  engine: { name: string; depth: number; stockfish: boolean; note: string };
}

interface Game {
  id: string;
  playerColor: Color;
  botRating: number;
  timeControl: string;
  startFen: string;
  fen: string;
  turn: Color;
  status: "active" | "finished";
  finished: boolean;
  result: GameResult | null;
  moves: GameMove[];
  lastMove: GameMove | null;
  clock: {
    whiteMs: number;
    blackMs: number;
    turn: Color;
    initialMs: number;
    incrementMs: number;
    updatedAt: string;
  };
  legalMoves: string[];
  review: Review | null;
  check: boolean;
}

interface Options {
  bots: number[];
  timeControls: TimeControl[];
  defaultRating: number;
  defaultTimeControl: string;
  profile: { rating: number; games: number; attempts: number };
  recent: {
    id: string;
    botRating: number;
    timeControl: string;
    playerColor: Color;
    result: string | null;
    resultReason: string | null;
    moveCount: number;
    createdAt: string;
  }[];
  engine: { name: string; note: string };
}

function ratingLabel(value: number) {
  if (value < 1000) return "Beginner";
  if (value < 1400) return "Improver";
  if (value < 1800) return "Club";
  if (value < 2200) return "Strong club";
  return "Master";
}

export function TrainingGamesPage() {
  const [params] = useSearchParams();
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [game, setGame] = useState<Game | null>(null);
  const [setup, setSetup] = useState({ rating: 1600, timeControl: "3+2", side: "white" as Color | "random" });
  const [busy, setBusy] = useState(false);
  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [turnStartedAt, setTurnStartedAt] = useState(() => Date.now());
  const [review, setReview] = useState<Review | null>(null);
  const [notice, setNotice] = useState("");
  const [flagged, setFlagged] = useState(false);
  const flagSent = useRef(false);
  const customFen = params.get("fen") || "";
  const customFrom = params.get("from") || "";
  const customColor = params.get("color") || params.get("side") || "";

  useEffect(() => {
    let cancelled = false;
    api
      .get<Options>("/play/training-games/options")
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        let initialSide: Color | "random" = "white";
        if (customColor === "black" || customColor === "white") initialSide = customColor;
        else if (customFen) {
          try {
            initialSide = new Chess(customFen).turn() === "w" ? "white" : "black";
          } catch {
            initialSide = "white";
          }
        }
        setSetup((current) => ({
          rating: Number(params.get("rating")) || Math.round(data.profile.rating) || current.rating,
          timeControl:
            data.timeControls.find((tc) => tc.id === (params.get("tc") || params.get("timeControl")))
              ?.id ??
            (data.timeControls.some((tc) => tc.id === data.defaultTimeControl)
              ? data.defaultTimeControl
              : "3+2"),
          side: initialSide,
        }));
      })
      .catch((err) => setError(err.message || "Training games could not be loaded."));
    return () => {
      cancelled = true;
    };
    // Query parameters are read once for the initial setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyGame = useCallback((next: Game) => {
    setGame(next);
    setSyncedAt(Date.now());
    if (next.turn === next.playerColor) setTurnStartedAt(Date.now());
    if (next.review) setReview(next.review);
  }, []);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setReview(null);
    setFlagged(false);
    flagSent.current = false;
    try {
      const body: Record<string, unknown> = {
        rating: setup.rating,
        timeControl: setup.timeControl,
        side: setup.side,
      };
      if (customFen) body.fen = customFen;
      if (customFrom) body.from = customFrom;
      const data = await api.post<{ game: Game; setup: { customPosition: boolean } }>(
        "/play/training-games",
        body
      );
      applyGame(data.game);
      if (data.setup?.customPosition) {
        setNotice("This game starts from the position you were studying.");
      }
    } catch (err) {
      setError((err as Error).message || "The game could not be started.");
    } finally {
      setBusy(false);
    }
  };

  const playMove = async (move: { from: string; to: string; san: string; promotion?: string }) => {
    if (!game || busy || game.finished || game.turn !== game.playerColor) return;
    setBusy(true);
    setError("");
    try {
      const data = await api.post<{ game: Game; timedOut?: boolean }>(
        `/play/training-games/${game.id}/moves`,
        {
          san: move.san,
          from: move.from,
          to: move.to,
          promotion: move.promotion,
          timeSpentMs: Math.max(0, Date.now() - turnStartedAt),
        }
      );
      applyGame(data.game);
      if (data.timedOut) setNotice("Your flag fell — the game is over.");
    } catch (err) {
      setError((err as Error).message || "That move was not accepted.");
    } finally {
      setBusy(false);
    }
  };

  const resign = async () => {
    if (!game || game.finished || busy) return;
    setBusy(true);
    try {
      const data = await api.post<{ game: Game }>(`/play/training-games/${game.id}/resign`);
      applyGame(data.game);
    } catch (err) {
      setError((err as Error).message || "Could not resign.");
    } finally {
      setBusy(false);
    }
  };

  const claimFlag = useCallback(async () => {
    if (!game || game.finished || flagSent.current) return;
    flagSent.current = true;
    setFlagged(true);
    try {
      const data = await api.post<{ game?: Game }>(`/play/training-games/${game.id}/flag`);
      if (data.game) applyGame(data.game);
    } catch {
      // The server says the clock is still running (or the game moved on);
      // the next state poll/move is authoritative. Allow a later retry.
      flagSent.current = false;
      setFlagged(false);
    }
  }, [applyGame, game]);

  const loadReview = async () => {
    if (!game || !game.finished || busy) return;
    setBusy(true);
    try {
      const data = await api.post<{ review: Review }>(`/play/training-games/${game.id}/review`);
      setReview(data.review);
    } catch (err) {
      setError((err as Error).message || "The review could not be generated.");
    } finally {
      setBusy(false);
    }
  };

  const orientation: Color = game?.playerColor ?? (setup.side === "black" ? "black" : "white");
  const movePairs = useMemo(() => {
    const moves = game?.moves ?? [];
    const rows: { number: number; white?: GameMove; black?: GameMove }[] = [];
    for (const move of moves) {
      const number = move.moveNumber;
      let row = rows.find((entry) => entry.number === number);
      if (!row) {
        row = { number };
        rows.push(row);
      }
      if (move.side === "white") row.white = move;
      else row.black = move;
    }
    return rows;
  }, [game]);

  if (error && !game && !options) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <Link className="cb-btn" to="/dashboard">
          Back to dashboard
        </Link>
      </div>
    );
  }
  if (!options) return <Splash label="Loading training games…" />;

  return (
    <PlayLayout
      title={game ? "Training game" : "Play a training game"}
      subtitle={
        game
          ? `${game.playerColor === "white" ? "White" : "Black"} vs ${ratingLabel(
              game.botRating
            )} bot (${game.botRating}) · ${game.timeControl}`
          : "A local, human-like bot. No account, no cloud, no waiting for an opponent."
      }
      crumbs={
        game
          ? [
              { label: "Training games", to: "/training-games" },
              { label: `${game.botRating} · ${game.timeControl}` },
            ]
          : [{ label: "Training games" }]
      }
      help="training-games"
      board={
        game ? (
          <div>
            <ChessClock
              ms={orientation === "white" ? game.clock.blackMs : game.clock.whiteMs}
              active={game.turn !== game.playerColor && !game.finished}
              syncedAt={syncedAt}
              label={`Bot ${game.botRating}`}
            />
            <div style={{ marginTop: 8 }}>
              <Board
                fen={game.fen}
                orientation={orientation}
                interactive={!game.finished && game.turn === game.playerColor && !busy}
                lastMove={game.lastMove ? { from: game.lastMove.from, to: game.lastMove.to } : null}
                onMove={playMove}
              />
            </div>
            <div style={{ marginTop: 8 }}>
              <ChessClock
                ms={orientation === "white" ? game.clock.whiteMs : game.clock.blackMs}
                active={game.turn === game.playerColor && !game.finished}
                syncedAt={syncedAt}
                label={`You (${game.playerColor})`}
                onExpire={claimFlag}
              />
            </div>
          </div>
        ) : (
          <Board fen={customFen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"} orientation={orientation} />
        )
      }
      boardFooter={
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>
            {game
              ? game.finished
                ? game.result?.label
                : game.turn === game.playerColor
                  ? game.check
                    ? "You are in check — your move"
                    : "Your move"
                  : "Bot is thinking…"
              : customFen
                ? "Position you were studying"
                : "Start position"}
          </span>
          {game ? (
            <a
              href={`https://lichess.org/analysis/standard/${encodeURIComponent(
                game.fen.split(" ")[0]
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Analyze <i className="fa fa-up-right-from-square" aria-hidden />
            </a>
          ) : null}
        </span>
      }
    >
      {error && (
        <div className="cb-inline-note" role="alert" style={{ margin: "12px 18px 0" }}>
          <i className="fa fa-triangle-exclamation" aria-hidden />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="cb-inline-note" role="status" style={{ margin: "12px 18px 0" }}>
          <i className="fa fa-circle-info" aria-hidden />
          <span>{notice}</span>
        </div>
      )}

      {!game ? (
        <>
          <Section title="Opponent strength">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 18px" }}>
              {options.bots.map((rating) => (
                <button
                  type="button"
                  key={rating}
                  className={`cb-btn small${setup.rating === rating ? " primary" : " ghost"}`}
                  onClick={() => setSetup({ ...setup, rating })}
                >
                  {rating}
                </button>
              ))}
            </div>
            <p style={{ margin: "8px 18px 0", color: "var(--cb-text-3)", fontSize: 11 }}>
              {ratingLabel(setup.rating)} · bot searches less deeply and misses more as the rating
              falls.
            </p>
          </Section>

          <Section title="Time control">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 18px" }}>
              {options.timeControls.map((tc) => (
                <button
                  type="button"
                  key={tc.id}
                  className={`cb-btn small${setup.timeControl === tc.id ? " primary" : " ghost"}`}
                  onClick={() => setSetup({ ...setup, timeControl: tc.id })}
                >
                  {tc.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Play as">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 18px" }}>
              {(["white", "black", "random"] as const).map((side) => (
                <button
                  type="button"
                  key={side}
                  className={`cb-btn small${setup.side === side ? " primary" : " ghost"}`}
                  onClick={() => setSetup({ ...setup, side })}
                >
                  {side === "random" ? "Random side" : side === "white" ? "White" : "Black"}
                </button>
              ))}
            </div>
            {customFen && (
              <p style={{ margin: "8px 18px 0", color: "var(--cb-text-3)", fontSize: 11 }}>
                Starting from the position you were studying
                {customFrom ? ` (${customFrom})` : ""}.
              </p>
            )}
          </Section>

          <div style={{ padding: "18px" }}>
            <button type="button" className="cb-btn primary wide" onClick={start} disabled={busy}>
              {busy ? "Starting…" : "Start training game"}
            </button>
          </div>

          <Section title="Your training rating">
            <div className="cb-stat-grid" style={{ padding: 0 }}>
              <Stat value={Math.round(options.profile.rating)} label="Rating" />
              <Stat value={options.profile.games} label="Games" />
              <Stat value={options.profile.attempts} label="Attempts" />
            </div>
          </Section>

          {options.recent.length > 0 && (
            <Section title="Recent games">
              {options.recent.map((recent) => (
                <Row
                  key={recent.id}
                  title={`${recent.playerColor === "white" ? "White" : "Black"} vs bot ${recent.botRating}`}
                  meta={`${recent.timeControl} · ${recent.moveCount} plies${
                    recent.result ? ` · ${recent.result}` : ""
                  }${recent.resultReason ? ` (${recent.resultReason})` : ""}`}
                  right={<i className="fa fa-chevron-right" aria-hidden />}
                  onClick={() => {
                    api
                      .get<{ game: Game }>(`/play/training-games/${recent.id}`)
                      .then((data) => applyGame(data.game))
                      .catch((err) => setError(err.message));
                  }}
                />
              ))}
            </Section>
          )}
        </>
      ) : (
        <>
          <Section title="Moves">
            <div className="cb-move-list">
              {movePairs.length === 0 && (
                <span className="cb-row-meta" style={{ padding: "8px 0" }}>
                  No moves yet.
                </span>
              )}
              {movePairs.map((pair) => (
                <span key={pair.number} className="cb-move-pill past">
                  <span className="cb-move-number">{pair.number}.</span>
                  <span>{pair.white?.san ?? "…"}</span>
                  <span>{pair.black?.san ?? ""}</span>
                </span>
              ))}
            </div>
          </Section>

          {!game.finished ? (
            <div style={{ display: "flex", gap: 8, padding: "18px" }}>
              <button type="button" className="cb-btn ghost" onClick={resign} disabled={busy}>
                Resign
              </button>
              <button
                type="button"
                className="cb-btn ghost"
                onClick={() => {
                  setGame(null);
                  setReview(null);
                  setError("");
                  setNotice("");
                }}
              >
                New game
              </button>
            </div>
          ) : (
            <>
              <div
                className="cb-inline-note"
                role="status"
                style={{ margin: "16px 18px 0" }}
              >
                <i className="fa fa-flag-checkered" aria-hidden />
                <span>
                  <strong>{game.result?.label ?? "Game over"}</strong>
                  {game.result?.reason ? ` · ${game.result.reason}` : ""}
                </span>
              </div>
              <div className="cb-stat-grid" style={{ padding: "14px 18px 0" }}>
                <Stat value={game.moves.length} label="Plies" />
                <Stat value={`${game.botRating}`} label="Bot rating" />
                <Stat value={game.timeControl} label="Time control" />
              </div>
              <div style={{ display: "flex", gap: 8, padding: "18px" }}>
                <button
                  type="button"
                  className="cb-btn primary"
                  onClick={loadReview}
                  disabled={busy || Boolean(review)}
                >
                  {review ? "Review ready" : busy ? "Reviewing…" : "Review game"}
                </button>
                <button
                  type="button"
                  className="cb-btn ghost"
                  onClick={() => {
                    setGame(null);
                    setReview(null);
                    setError("");
                    setNotice("");
                  }}
                >
                  Rematch
                </button>
              </div>
            </>
          )}

          {review && (
            <Section title="Local game review">
              <div className="cb-stat-grid" style={{ padding: "0 18px" }}>
                <Stat value={`${review.accuracy}%`} label="Accuracy" />
                <Stat value={review.blunders} label="Blunders" />
                <Stat value={review.mistakes} label="Mistakes" />
              </div>
              <p style={{ margin: "10px 18px 0", color: "var(--cb-text-3)", fontSize: 12 }}>
                {review.headline} {review.summary}
              </p>
              <p style={{ margin: "6px 18px 0", color: "var(--cb-text-3)", fontSize: 11 }}>
                {review.engine.name} · depth {review.engine.depth} ·{" "}
                {review.engine.stockfish ? "Stockfish" : "no Stockfish binary"}.
              </p>
              <div className="cb-move-list" style={{ marginTop: 10 }}>
                {review.moves
                  .filter((move) => move.byPlayer)
                  .map((move) => (
                    <span
                      key={move.ply}
                      className="cb-move-pill past"
                      title={`${move.classification} · ${move.cpLoss}cp lost${
                        move.bestSan ? ` · best ${move.bestSan}` : ""
                      }`}
                    >
                      <span className="cb-move-number">{move.ply}.</span>
                      <span>{move.san}</span>
                      <span
                        style={{
                          color:
                            move.classification === "blunder"
                              ? "var(--cb-danger)"
                              : move.classification === "mistake"
                                ? "oklch(72% 0.12 60)"
                                : move.classification === "best"
                                  ? "var(--cb-green)"
                                  : "var(--cb-text-3)",
                        }}
                      >
                        {move.classification === "best" ? "✓" : `${move.cpLoss}cp`}
                      </span>
                    </span>
                  ))}
              </div>
            </Section>
          )}

          <p style={{ margin: "16px 18px 0", color: "var(--cb-text-3)", fontSize: 11 }}>
            This review uses the local heuristic engine, not Stockfish. It compares each of your
            moves with the best move it can find at a shallow depth.
          </p>
        </>
      )}
    </PlayLayout>
  );
}
