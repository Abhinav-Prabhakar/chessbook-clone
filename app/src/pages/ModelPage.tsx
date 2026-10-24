import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chess } from "chess.js";
import { api } from "../api";
import { Board, type BoardHighlight, type BoardMove } from "../components/Board";
import {
  BoardHeader,
  EmptyState,
  OptionSheet,
  Row,
  Section,
  Sidebar,
  SkeletonRows,
  Splash,
} from "../components/ui";
import { useToast } from "../components/Toast";
import { useProfile } from "../profile";
import { findMove, pgnTimeline, START_FEN } from "../chess";
import type { Color } from "../types";

/*
 * Model games (audit D094–D106, D185)
 *
 * Data comes from the captured model-game endpoints in `server/api.js` /
 * `server/model-games.js`:
 *
 *   GET  /model-games?source=historical|masters|online
 *   GET  /model-games/daily
 *   GET  /model-games/random?exclude=
 *   GET  /model-games/history?groupBy=week
 *   GET  /model-games/:id
 *   POST /model-games/:id/progress  { ply, reviewed }
 *   POST /model-games/:id/review    { reviewed, score }
 *
 * The board is a real guess-the-move surface: a played move is compared to the
 * game's SAN, a miss is recorded without revealing the answer, and the
 * opponent's reply is auto-played. Per-ply pass/fail is kept on this device;
 * the position and review score are persisted on the server.
 */

type ModelSource = "historical" | "masters" | "online";
type Outcome = "correct" | "wrong" | "revealed";

interface PlayerInfo {
  name: string;
  shortName: string;
  elo: number | null;
  title: string | null;
}

interface PlayerPerformance {
  blunders?: number;
  mistakes?: number;
  inaccuracies?: number;
}

interface ModelPly {
  ply: number;
  moveNumber: number;
  side: Color;
  san: string;
  epdBefore: string | null;
  epdAfter: string | null;
  fenBefore: string | null;
  fenAfter: string | null;
  evalBefore: number | null;
  evalAfter: number | null;
  evalCp: number | null;
  evalPawn: number | null;
  evalAvailable: boolean;
}

interface EvalSample {
  ply: number;
  epd: string | null;
  evalCp: number | null;
  evalPawn: number | null;
  available: boolean;
}

interface ProgressState {
  ply: number;
  total: number;
  percent: number;
  completed: boolean;
  reviewed: boolean;
  score: number | null;
  completedAt: string | null;
  reviewedAt: string | null;
  updatedAt: string | null;
}

interface GameAnnotation {
  key?: string;
  san?: string;
  ply?: number;
  text?: string;
  [key: string]: unknown;
}

interface OpeningMatchLine {
  lineId: number;
  lineName: string;
  repertoireId: number;
  repertoireName: string;
  repertoireColor: Color;
  moves: string[];
  matchedPlies: number;
  matchedPercent?: number;
  openingId?: number | null;
}

interface OpeningMatchGuide {
  slug: string;
  name: string;
  eco: string;
  matchedPlies: number;
  moves: string[];
}

interface OpeningMatch {
  available: boolean;
  line: OpeningMatchLine | null;
  guide: OpeningMatchGuide | null;
}

interface ReviewState {
  reviewed: boolean;
  score: number | null;
  reviewedAt: string | null;
}

interface ModelGameSummary {
  id: number;
  white: string;
  black: string;
  whiteFullName?: string;
  blackFullName?: string;
  event: string;
  eventName?: string;
  year?: string | number | null;
  playedAt?: string | null;
  capturedAt?: string | null;
  result?: string | null;
  resultTag?: string | null;
  outcome?: string | null;
  resultLabel?: string | null;
  pgn?: string;
  description?: string;
  link?: string | null;
  linkAvailable?: boolean;
  daily?: boolean;
  reviewed?: boolean;
  progress?: number;
  progressState?: ProgressState;
  players?: { white: PlayerInfo; black: PlayerInfo };
  source?: string | null;
}

interface ModelGameDetail extends ModelGameSummary {
  moves?: string[];
  plies?: ModelPly[];
  moveCount?: number;
  performances?: Partial<Record<Color, PlayerPerformance>>;
  analysis?: {
    available?: boolean;
    source?: string;
    engineReviewAvailable?: boolean;
    engineReviewReason?: string;
    performances?: Partial<Record<Color, PlayerPerformance>>;
  };
  annotations?: GameAnnotation[];
  annotationsAvailable?: boolean;
  evalSamples?: EvalSample[];
  evalGraph?: {
    available: boolean;
    source?: string;
    samples?: EvalSample[];
    mateSupported?: boolean;
  };
  openingMatch?: OpeningMatch;
  review?: ReviewState;
}

interface ListPayload {
  games: ModelGameSummary[];
  total: number;
  dailyGameId: number | null;
  source: ModelSource;
  available: boolean;
  reason: string | null;
}

interface HistoryGame extends ModelGameSummary {
  _date?: string | null;
}

interface HistoryWeek {
  weekStart: string | null;
  weekEnd: string | null;
  label: string;
  games: HistoryGame[];
}

interface HistoryPayload {
  groupBy: string;
  total: number;
  games: HistoryGame[];
  weeks: HistoryWeek[];
  available: boolean;
  source?: string;
}

interface ReviewResponse {
  ok: boolean;
  progress?: ProgressState;
  review?: ReviewState;
  analysis?: ModelGameDetail["analysis"];
}

interface StoredSession {
  results: Record<number, Outcome>;
  hints: Record<number, number>;
  side: Color;
}

const MODEL_SOURCES: { value: ModelSource; label: string; hint: string }[] = [
  {
    value: "historical",
    label: "Historical and master games",
    hint: "The captured historical game collection on this device.",
  },
  {
    value: "masters",
    label: "Master games only",
    hint: "Filter the local collection to master-level games.",
  },
  {
    value: "online",
    label: "Online games",
    hint: "No online account exists in this build — this shows an explicit empty state.",
  },
];

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

function storageKey(gameId: number) {
  return `cb_model_session_${gameId}`;
}

function readSession(gameId: number): StoredSession {
  try {
    const raw = localStorage.getItem(storageKey(gameId));
    if (!raw) return { results: {}, hints: {}, side: "white" };
    const parsed = JSON.parse(raw) as Partial<StoredSession> | null;
    const results: Record<number, Outcome> = {};
    if (parsed?.results && typeof parsed.results === "object") {
      for (const [key, value] of Object.entries(parsed.results)) {
        if (value === "correct" || value === "wrong" || value === "revealed") {
          const index = Number(key);
          if (Number.isInteger(index) && index >= 0) results[index] = value;
        }
      }
    }
    const hints: Record<number, number> = {};
    if (parsed?.hints && typeof parsed.hints === "object") {
      for (const [key, value] of Object.entries(parsed.hints)) {
        const index = Number(key);
        const level = Number(value);
        if (Number.isInteger(index) && index >= 0 && Number.isFinite(level) && level > 0) {
          hints[index] = Math.min(2, Math.trunc(level));
        }
      }
    }
    return { results, hints, side: parsed?.side === "black" ? "black" : "white" };
  } catch {
    return { results: {}, hints: {}, side: "white" };
  }
}

function writeSession(gameId: number, session: StoredSession) {
  try {
    localStorage.setItem(storageKey(gameId), JSON.stringify(session));
  } catch {
    // Storage is an enhancement; the server keeps the position.
  }
}

function clearSession(gameId: number) {
  try {
    localStorage.removeItem(storageKey(gameId));
  } catch {
    // ignore
  }
}

function formatEval(cp: number) {
  const pawns = cp / 100;
  const text = Math.abs(pawns).toFixed(1);
  return pawns > 0 ? `+${text}` : pawns < 0 ? `-${text}` : "0.0";
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function pieceNameAt(fen: string, square: string) {
  try {
    const chess = new Chess(fen);
    const piece = chess.get(square as any);
    return piece ? PIECE_NAMES[piece.type] ?? "piece" : "piece";
  } catch {
    return "piece";
  }
}

function targetRegion(to: string) {
  const index = "abcdefgh".indexOf(to[0] ?? "");
  if (index <= 2) return "towards the queenside";
  if (index >= 5) return "towards the kingside";
  return "into the centre";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function annotationForPly(game: ModelGameDetail | null, index: number, san: string) {
  const rows = game?.annotations ?? [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (row.san === san || row.ply === index + 1 || row.key === String(index + 1)) {
      if (typeof row.text === "string" && row.text.trim()) return row.text.trim();
    }
  }
  return null;
}

function performanceText(performance: PlayerPerformance | undefined) {
  if (!performance) return "Performance not captured";
  const parts: string[] = [];
  if (typeof performance.blunders === "number") {
    parts.push(`${performance.blunders} blunder${performance.blunders === 1 ? "" : "s"}`);
  }
  if (typeof performance.mistakes === "number") {
    parts.push(`${performance.mistakes} mistake${performance.mistakes === 1 ? "" : "s"}`);
  }
  if (typeof performance.inaccuracies === "number") {
    parts.push(
      `${performance.inaccuracies} inaccurac${performance.inaccuracies === 1 ? "y" : "ies"}`
    );
  }
  return parts.length ? parts.join(" · ") : "Performance not captured";
}

function resultText(game: ModelGameDetail) {
  if (game.outcome === "white") return "White won";
  if (game.outcome === "black") return "Black won";
  if (game.outcome === "draw") return "Draw";
  return game.resultLabel || game.result || "Result unavailable";
}

function gameDescription(game: ModelGameDetail) {
  const white = game.players?.white;
  const black = game.players?.black;
  const whiteName = white?.shortName || game.white;
  const blackName = black?.shortName || game.black;
  const whiteElo = white?.elo ? ` (${white.elo})` : "";
  const blackElo = black?.elo ? ` (${black.elo})` : "";
  const event = game.eventName || game.event;
  const totalMoves = Math.ceil(
    (game.plies?.length ?? game.moves?.length ?? game.moveCount ?? 0) / 2
  );
  let sentence: string;
  if (game.outcome === "white") sentence = `${whiteName} defeated ${blackName}`;
  else if (game.outcome === "black") sentence = `${blackName} defeated ${whiteName}`;
  else sentence = `${whiteName} and ${blackName} drew`;
  return `In this game between ${whiteName}${whiteElo} and ${blackName}${blackElo}${
    event ? ` at the "${event}"` : ""
  }, ${sentence} in ${totalMoves} move${totalMoves === 1 ? "" : "s"}.`;
}

function openingLabel(game: ModelGameDetail) {
  return (
    game.openingMatch?.line?.lineName ||
    game.openingMatch?.guide?.name ||
    "No matched opening"
  );
}

function EvalGraph({
  samples,
  maxPly,
  ply,
  onSeek,
}: {
  samples: EvalSample[];
  maxPly: number;
  ply: number;
  onSeek?: (ply: number) => void;
}) {
  const usable = (samples ?? []).filter(
    (sample): sample is EvalSample & { evalCp: number } =>
      typeof sample?.evalCp === "number" && Number.isFinite(sample.evalCp)
  );

  if (!usable.length) {
    return (
      <div className="cb-evalgraph" data-testid="model-evalgraph-empty">
        <p
          className="cb-model-description"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            margin: 0,
            padding: "0 14px",
            textAlign: "center",
            fontSize: 12,
          }}
        >
          No captured evaluation samples for this game.
        </p>
      </div>
    );
  }

  const total = Math.max(1, maxPly);
  const points = usable.map((sample) => ({
    x: Math.max(0, Math.min(100, (sample.ply / total) * 100)),
    y: 11 - Math.tanh(sample.evalCp / 500) * 10,
  }));
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const area = `M ${points[0].x.toFixed(2)} 11 ${points
    .map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ")} L ${points[points.length - 1].x.toFixed(2)} 11 Z`;
  const current =
    [...usable].reverse().find((sample) => sample.ply <= ply) ?? usable[0];
  const playhead = Math.max(0, Math.min(100, (ply / total) * 100));

  return (
    <div
      className="cb-evalgraph"
      data-testid="model-evalgraph"
      role="img"
      aria-label={`Evaluation graph from ${usable.length} captured samples. Current evaluation ${formatEval(
        current.evalCp
      )}.`}
      style={{ cursor: onSeek ? "pointer" : "default" }}
      onClick={
        onSeek
          ? (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (!rect.width) return;
              const ratio = Math.max(
                0,
                Math.min(1, (event.clientX - rect.left) / rect.width)
              );
              onSeek(Math.round(ratio * total));
            }
          : undefined
      }
    >
      <span
        className="cb-evalgraph-label"
        style={{ left: 8, top: 6, zIndex: 4, color: "var(--cb-text-2)" }}
      >
        {formatEval(current.evalCp)}
      </span>
      <svg viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden>
        <line
          x1="0"
          x2="100"
          y1="11"
          y2="11"
          stroke="rgba(255,255,255,.07)"
          strokeWidth=".4"
        />
        <path d={area} fill="oklch(73.5% 0.1736 141 / 0.16)" />
        <path
          d={line}
          fill="none"
          stroke="oklch(73.5% 0.1736 141 / 0.9)"
          strokeWidth=".55"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={playhead}
          x2={playhead}
          y1="0"
          y2="22"
          stroke="oklch(70% 0.15 230)"
          strokeWidth=".5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

export function ModelPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { settings, saveSettings } = useProfile();

  const settingsSource = (settings?.modelSource ?? "historical") as ModelSource;

  const [source, setSource] = useState<ModelSource>(settingsSource);
  const [sourceSheet, setSourceSheet] = useState(false);

  const [list, setList] = useState<ListPayload | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [listNonce, setListNonce] = useState(0);

  const [gameId, setGameId] = useState<number | null>(() => {
    const parsed = id ? Number(id) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  const [game, setGame] = useState<ModelGameDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailNonce, setDetailNonce] = useState(0);

  const [ply, setPly] = useState(0);
  const [browsePly, setBrowsePly] = useState<number | null>(null);
  const [userSide, setUserSide] = useState<Color>("white");
  const [results, setResults] = useState<Record<number, Outcome>>({});
  const [hints, setHints] = useState<Record<number, number>>({});
  const [notice, setNotice] = useState<{
    kind: "ok" | "wrong" | "info";
    text: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [wrongMove, setWrongMove] = useState<{ from: string; to: string } | null>(null);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [reviewState, setReviewState] = useState<ReviewState>({
    reviewed: false,
    score: null,
    reviewedAt: null,
  });

  const [view, setView] = useState<"game" | "history">("game");
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyGroup, setHistoryGroup] = useState<"week" | "opening">("week");
  const [openingLabels, setOpeningLabels] = useState<Record<number, string>>({});
  const [openingLoading, setOpeningLoading] = useState(false);

  const feedbackTimer = useRef<number | null>(null);
  const prevPlyRef = useRef(0);
  const reviewPostedRef = useRef<string | null>(null);
  const progressSigRef = useRef("");
  const scoreRef = useRef<number | null>(null);

  /* ------------------------------------------------------------- source --- */

  useEffect(() => {
    setSource((current) => (current === settingsSource ? current : settingsSource));
  }, [settingsSource]);

  useEffect(() => {
    if (!id) return;
    const parsed = Number(id);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setGameId((current) => (current === parsed ? current : parsed));
  }, [id]);

  /* --------------------------------------------------------------- list --- */

  useEffect(() => {
    let alive = true;
    setListLoading(true);
    setListError("");
    api
      .get<ListPayload>(`/model-games?source=${encodeURIComponent(source)}`)
      .then((payload) => {
        if (!alive) return;
        setList(payload);
        const ids = new Set(payload.games.map((entry) => entry.id));
        setGameId((current) => {
          if (current != null && ids.has(current)) return current;
          if (payload.dailyGameId != null && ids.has(payload.dailyGameId)) {
            return payload.dailyGameId;
          }
          return payload.games[0]?.id ?? null;
        });
      })
      .catch((error: Error) => {
        if (!alive) return;
        setList(null);
        setGame(null);
        setListError(error.message);
      })
      .finally(() => {
        if (alive) setListLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [source, listNonce]);

  /* ------------------------------------------------------------- detail --- */

  useEffect(() => {
    if (gameId == null) {
      setGame(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    setDetailError("");
    setGame(null);
    api
      .get<{ game: ModelGameDetail }>(`/model-games/${gameId}`)
      .then(({ game: loaded }) => {
        if (!alive) return;
        const total = loaded.plies?.length ?? 0;
        const stored = readSession(loaded.id);
        const rawPly = Number(loaded.progressState?.ply ?? loaded.progress ?? 0);
        const loadedPly = Math.max(
          0,
          total > 0 ? Math.min(total, rawPly) : rawPly
        );
        setGame(loaded);
        setUserSide(stored.side);
        setResults(stored.results);
        setHints(stored.hints);
        setPly(loadedPly);
        setBrowsePly(null);
        setAutoPlaying(false);
        setWrongMove(null);
        setFeedback(null);
        setNotice(
          loadedPly > 0 && (total === 0 || loadedPly < total)
            ? { kind: "info", text: `Resumed at move ${Math.ceil(loadedPly / 2) || 1}.` }
            : null
        );
        setReviewState({
          reviewed: Boolean(loaded.review?.reviewed),
          score:
            typeof loaded.review?.score === "number" ? loaded.review.score : null,
          reviewedAt: loaded.review?.reviewedAt ?? null,
        });
        prevPlyRef.current = loadedPly;
        progressSigRef.current = "";
        reviewPostedRef.current = null;
      })
      .catch((error: Error) => {
        if (!alive) return;
        setGame(null);
        setDetailError(error.message);
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [gameId, detailNonce]);

  /* ------------------------------------------------------------ timeline --- */

  const timeline = useMemo(() => {
    if (!game) return null;
    if (game.pgn) {
      try {
        const parsed = pgnTimeline(game.pgn);
        if (parsed.moves.length) {
          return {
            ...parsed,
            moves: parsed.moves.map((move, index) => ({
              ...move,
              side: (index % 2 === 0 ? "white" : "black") as Color,
            })),
          };
        }
      } catch {
        // fall through to the captured SAN list
      }
    }
    const san = game.plies?.map((entry) => entry.san) ?? game.moves ?? [];
    if (!san.length) return null;
    try {
      const chess = new Chess();
      const fens = [chess.fen()];
      const moves: {
        san: string;
        from: string;
        to: string;
        fen: string;
        side: Color;
      }[] = [];
      for (const moveSan of san) {
        const move = chess.move(moveSan);
        fens.push(chess.fen());
        moves.push({
          san: move.san,
          from: move.from,
          to: move.to,
          fen: chess.fen(),
          side: move.color === "w" ? "white" : "black",
        });
      }
      return { sans: moves.map((move) => move.san), fens, moves };
    } catch {
      return null;
    }
  }, [game]);

  useEffect(
    () => () => {
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    },
    []
  );

  const maxPly = timeline?.moves.length ?? 0;
  const completed = maxPly > 0 && ply >= maxPly;
  const shownPly = Math.min(browsePly ?? ply, maxPly);
  const displayFen = timeline?.fens[shownPly] ?? START_FEN;
  const lastMove = shownPly > 0 && timeline ? timeline.moves[shownPly - 1] ?? null : null;
  const nextMove = timeline?.moves[shownPly] ?? null;
  const boardInteractive = Boolean(
    game &&
      timeline &&
      !completed &&
      browsePly === null &&
      !autoPlaying &&
      nextMove &&
      nextMove.side === userSide
  );

  const answeredPlies = useMemo(
    () =>
      Object.keys(results)
        .map(Number)
        .filter((index) => timeline?.moves[index]?.side === userSide),
    [results, timeline, userSide]
  );
  const answered = answeredPlies.length;
  const correct = answeredPlies.filter((index) => results[index] === "correct").length;
  const totalGuesses = useMemo(
    () => (timeline ? timeline.moves.filter((move) => move.side === userSide).length : 0),
    [timeline, userSide]
  );
  const score = answered ? Math.round((correct / answered) * 100) : null;
  scoreRef.current = score;
  const hintsUsed = useMemo(
    () => Object.values(hints).filter((level) => level > 0).length,
    [hints]
  );

  const hintLevel =
    !completed && browsePly === null ? hints[ply] ?? 0 : 0;
  const hintMove = useMemo(() => {
    if (!timeline || hintLevel === 0 || completed || browsePly !== null) return null;
    const expected = timeline.moves[ply];
    if (!expected) return null;
    return findMove(timeline.fens[ply] ?? START_FEN, expected.san);
  }, [timeline, hintLevel, completed, browsePly, ply]);

  const hintText = useMemo(() => {
    if (!timeline || hintLevel === 0 || !hintMove) return null;
    const expected = timeline.moves[ply];
    if (!expected) return null;
    if (hintLevel === 1) {
      const note = annotationForPly(game, ply, expected.san);
      if (note) return note;
      const piece = pieceNameAt(timeline.fens[ply] ?? START_FEN, hintMove.from);
      const capture = expected.san.includes("x") ? " It is a capture." : "";
      return `${capitalize(piece)} move ${targetRegion(hintMove.to)}.${capture}`;
    }
    return `The ${pieceNameAt(
      timeline.fens[ply] ?? START_FEN,
      hintMove.from
    )} on ${hintMove.from} is the piece that moved.`;
  }, [timeline, hintLevel, hintMove, game, ply]);

  const highlights: BoardHighlight[] =
    hintLevel === 2 && hintMove && !completed
      ? [{ square: hintMove.from, kind: "hint" }]
      : [];

  const currentEpd = useMemo(() => {
    if (!game) return null;
    if (shownPly === 0) return game.plies?.[0]?.epdBefore ?? null;
    return game.plies?.[shownPly - 1]?.epdAfter ?? null;
  }, [game, shownPly]);

  const evalSamples = game?.evalSamples ?? game?.evalGraph?.samples ?? [];
  const evalCount = evalSamples.filter(
    (sample) => typeof sample.evalCp === "number"
  ).length;

  /* --------------------------------------------------------- auto reply --- */

  useEffect(() => {
    if (!timeline || !game || browsePly !== null) return;
    if (ply >= maxPly) return;
    const upcoming = timeline.moves[ply];
    if (!upcoming || upcoming.side === userSide) return;
    setAutoPlaying(true);
    const timer = window.setTimeout(() => {
      setPly((current) => Math.min(maxPly, current + 1));
      setAutoPlaying(false);
    }, 650);
    return () => {
      window.clearTimeout(timer);
      setAutoPlaying(false);
    };
  }, [game, timeline, ply, maxPly, userSide, browsePly]);

  /* ----------------------------------------------------------- progress --- */

  useEffect(() => {
    if (!game) return;
    const signature = `${ply}:${reviewState.reviewed ? 1 : 0}`;
    if (progressSigRef.current === signature) return;
    const timer = window.setTimeout(() => {
      progressSigRef.current = signature;
      api
        .post(`/model-games/${game.id}/progress`, {
          ply,
          reviewed: reviewState.reviewed,
        })
        .catch(() => {
          progressSigRef.current = "";
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [game, ply, reviewState.reviewed]);

  /* ------------------------------------------------------------ review --- */

  useEffect(() => {
    if (!game || maxPly === 0) return;
    if (ply < maxPly) {
      prevPlyRef.current = ply;
      return;
    }
    if (prevPlyRef.current < maxPly) {
      const key = `${game.id}:${maxPly}`;
      if (reviewPostedRef.current !== key) {
        reviewPostedRef.current = key;
        const value = scoreRef.current;
        api
          .post<ReviewResponse>(`/model-games/${game.id}/review`, {
            reviewed: true,
            score: value,
          })
          .then((response) => {
            setReviewState({
              reviewed: true,
              score: response.review?.score ?? value,
              reviewedAt: response.review?.reviewedAt ?? new Date().toISOString(),
            });
          })
          .catch((error: Error) => {
            reviewPostedRef.current = null;
            toast(`The review could not be saved: ${error.message}`, "bad");
          });
      }
    }
    prevPlyRef.current = ply;
  }, [ply, maxPly, game, toast]);

  /* ------------------------------------------------------------ session --- */

  useEffect(() => {
    if (!game) return;
    writeSession(game.id, { results, hints, side: userSide });
  }, [game, results, hints, userSide]);

  /* ------------------------------------------------------------ history --- */

  useEffect(() => {
    if (view !== "history" || historyGroup !== "opening" || !history) return;
    let alive = true;
    setOpeningLoading(true);
    Promise.all(
      history.games.map((entry) =>
        api
          .get<{ game: ModelGameDetail }>(`/model-games/${entry.id}`)
          .then((response) => [entry.id, openingLabel(response.game)] as const)
          .catch(() => [entry.id, "No matched opening"] as const)
      )
    )
      .then((entries) => {
        if (!alive) return;
        setOpeningLabels((current) => {
          const next = { ...current };
          for (const [entryId, label] of entries) next[entryId] = label;
          return next;
        });
      })
      .finally(() => {
        if (alive) setOpeningLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [view, historyGroup, history]);

  /* ------------------------------------------------------------ actions --- */

  const recordOutcome = (index: number, outcome: Outcome) => {
    setResults((current) =>
      current[index] ? current : { ...current, [index]: outcome }
    );
  };

  const flashFeedback = (kind: "correct" | "wrong") => {
    setFeedback(kind);
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => {
      setFeedback(null);
      setWrongMove(null);
    }, 1100);
  };

  const handleBoardMove = (move: BoardMove) => {
    if (!timeline || !game || completed || browsePly !== null || autoPlaying) return;
    const expected = timeline.moves[ply];
    if (!expected || expected.side !== userSide) return;
    if (move.san === expected.san) {
      recordOutcome(ply, "correct");
      setWrongMove(null);
      setNotice({ kind: "ok", text: `Correct — ${expected.san}.` });
      flashFeedback("correct");
      setPly((current) => Math.min(maxPly, current + 1));
    } else {
      recordOutcome(ply, "wrong");
      setWrongMove({ from: move.from, to: move.to });
      setNotice({
        kind: "wrong",
        text: `${move.san} is not the move played. Try again, or take a hint.`,
      });
      flashFeedback("wrong");
    }
  };

  const revealMove = () => {
    if (!timeline || completed || browsePly !== null || autoPlaying) return;
    const expected = timeline.moves[ply];
    if (!expected) return;
    recordOutcome(ply, "revealed");
    setWrongMove(null);
    setNotice({ kind: "info", text: `The move played was ${expected.san}.` });
    flashFeedback("correct");
    setPly((current) => Math.min(maxPly, current + 1));
  };

  const giveHint = () => {
    if (!timeline || completed || browsePly !== null || autoPlaying) return;
    if (hintLevel >= 2) {
      revealMove();
      return;
    }
    setHints((current) => ({ ...current, [ply]: (current[ply] ?? 0) + 1 }));
  };

  const resetSession = () => {
    setResults({});
    setHints({});
    setPly(0);
    setBrowsePly(null);
    setNotice(null);
    setWrongMove(null);
    setFeedback(null);
    setAutoPlaying(false);
    prevPlyRef.current = 0;
    reviewPostedRef.current = null;
    progressSigRef.current = "";
    if (game) clearSession(game.id);
  };

  const switchSide = (side: Color) => {
    if (side === userSide) return;
    if (ply > 0 && !completed) return;
    resetSession();
    setUserSide(side);
  };

  const selectGame = (nextId: number) => {
    setView("game");
    setBrowsePly(null);
    setGameId(nextId);
    navigate(`/model/${nextId}`);
  };

  const chooseRandom = async () => {
    if (!game) return;
    const pool = (list?.games ?? []).filter((entry) => entry.id !== game.id);
    if (!pool.length) {
      toast("Only one model game matches this source.", "info");
      return;
    }
    let nextId = pool[Math.floor(Math.random() * pool.length)].id;
    try {
      const response = await api.get<{ game: ModelGameDetail }>(
        `/model-games/random?exclude=${game.id}`
      );
      if (pool.some((entry) => entry.id === response.game.id)) {
        nextId = response.game.id;
      }
    } catch {
      // The local random pick still respects the selected source.
    }
    selectGame(nextId);
  };

  const chooseSource = (value: string) => {
    setSourceSheet(false);
    const next = value as ModelSource;
    if (next === source) return;
    setSource(next);
    saveSettings({ modelSource: next }).catch((error: Error) => {
      toast(error.message, "bad");
      setSource(settingsSource);
    });
  };

  const openHistory = () => {
    setView("history");
    setHistoryLoading(true);
    setHistoryError("");
    api
      .get<HistoryPayload>("/model-games/history?groupBy=week&includeDaily=1")
      .then((payload) => setHistory(payload))
      .catch((error: Error) => setHistoryError(error.message))
      .finally(() => setHistoryLoading(false));
  };

  const openingGroups = useMemo(() => {
    const groups = new Map<string, HistoryGame[]>();
    for (const entry of history?.games ?? []) {
      const label =
        openingLabels[entry.id] ??
        (openingLoading ? "Identifying opening…" : "No matched opening");
      const bucket = groups.get(label) ?? [];
      bucket.push(entry);
      groups.set(label, bucket);
    }
    return [...groups.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
    );
  }, [history, openingLabels, openingLoading]);

  const moveNumberLabel = (index: number) => {
    const move = timeline?.moves[index];
    if (!move) return "";
    return `${Math.floor(index / 2) + 1}${move.side === "white" ? "." : "…"}`;
  };

  /* ------------------------------------------------------------- render --- */

  const loadingList = listLoading && !list;
  if (loadingList) {
    return <Splash label="Loading model games…" />;
  }
  if (view === "game" && gameId != null && detailLoading && !game) {
    return <Splash label="Loading the model game…" />;
  }

  const sourceLabel =
    MODEL_SOURCES.find((option) => option.value === source)?.label ??
    "Historical and master games";

  const sourceRow = (
    <Row
      title="Model games source"
      right={<span className="cb-setting-value">{sourceLabel}</span>}
      onClick={() => setSourceSheet(true)}
      testId="model-source"
    />
  );

  const historyRow = (
    <Row
      title="View previous model games"
      onClick={openHistory}
      testId="model-history"
    />
  );

  const renderHistoryRow = (entry: HistoryGame) => (
    <Row
      key={entry.id}
      title={`${entry.white} vs. ${entry.black}`}
      meta={`${entry.eventName || entry.event || "Event not captured"} · ${
        entry.resultLabel || entry.result || "Result not captured"
      }`}
      right={
        <span className="cb-setting-value">
          {entry.progressState?.percent ?? 0}%
        </span>
      }
      onClick={() => selectGame(entry.id)}
      testId={`model-history-game-${entry.id}`}
    />
  );

  let sidebar: ReactNode;

  if (view === "history") {
    sidebar = (
      <>
        <div className="cb-page-head">
          <h1 className="cb-page-title">Previous model games</h1>
          <p className="cb-page-sub">
            {history
              ? `${history.total} captured game${history.total === 1 ? "" : "s"} on this device`
              : "Loading captured games…"}
          </p>
        </div>

        <div
          className="cb-tabs"
          role="tablist"
          aria-label="Group model-game history"
          style={{ marginTop: 12 }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={historyGroup === "week"}
            className={`cb-tab ${historyGroup === "week" ? "active" : ""}`}
            onClick={() => setHistoryGroup("week")}
          >
            By week
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={historyGroup === "opening"}
            className={`cb-tab ${historyGroup === "opening" ? "active" : ""}`}
            onClick={() => setHistoryGroup("opening")}
          >
            By opening
          </button>
        </div>

        {historyError ? (
          <EmptyState
            icon="fa-triangle-exclamation"
            title="History could not be loaded"
            action={
              <button type="button" className="cb-btn" onClick={openHistory}>
                Try again
              </button>
            }
          >
            {historyError}
          </EmptyState>
        ) : historyLoading ? (
          <SkeletonRows rows={5} className="cb-model-copy" />
        ) : !history || (history.games ?? []).length === 0 ? (
          <EmptyState icon="fa-star" title="No previous model games">
            No captured model games are stored yet.
          </EmptyState>
        ) : historyGroup === "week" ? (
          (history.weeks ?? []).map((week) => (
            <Section key={week.label} title={week.label}>
              {(week.games ?? []).map(renderHistoryRow)}
            </Section>
          ))
        ) : openingLoading ? (
          <SkeletonRows rows={5} className="cb-model-copy" />
        ) : (
          openingGroups.map(([label, entries]) => (
            <Section key={label} title={label}>
              {entries.map(renderHistoryRow)}
            </Section>
          ))
        )}

        <p
          className="cb-model-description"
          style={{ marginTop: 18, padding: "0 18px" }}
        >
          Grouped from the captured model-game collection. Open any game to play
          through it.
        </p>

        <div className="cb-model-rows" style={{ marginTop: 20 }}>
          <Row title="Back to the game" onClick={() => setView("game")} />
          {sourceRow}
        </div>
      </>
    );
  } else if (listError) {
    sidebar = (
      <>
        <div className="cb-page-head">
          <h1 className="cb-page-title">Model games</h1>
        </div>
        <EmptyState
          icon="fa-triangle-exclamation"
          title="Model games could not be loaded"
          action={
            <button
              type="button"
              className="cb-btn"
              onClick={() => setListNonce((value) => value + 1)}
            >
              Try again
            </button>
          }
        >
          {listError}
        </EmptyState>
        <div className="cb-model-rows" style={{ marginTop: 16 }}>{sourceRow}</div>
      </>
    );
  } else if (detailError) {
    sidebar = (
      <>
        <div className="cb-page-head">
          <h1 className="cb-page-title">Model games</h1>
        </div>
        <EmptyState
          icon="fa-triangle-exclamation"
          title="This model game could not be opened"
          action={
            <button
              type="button"
              className="cb-btn"
              onClick={() => setDetailNonce((value) => value + 1)}
            >
              Try again
            </button>
          }
        >
          {detailError}
        </EmptyState>
        <div className="cb-model-rows" style={{ marginTop: 16 }}>
          {historyRow}
          {sourceRow}
        </div>
      </>
    );
  } else if (!game) {
    sidebar = (
      <>
        <div className="cb-page-head">
          <h1 className="cb-page-title">Model games</h1>
          <p className="cb-page-sub">
            Only captured games are shown; nothing is invented.
          </p>
        </div>
        <EmptyState
          icon="fa-star"
          title="No model games for this source"
          action={
            <button
              type="button"
              className="cb-btn"
              onClick={() => setSourceSheet(true)}
            >
              Change source
            </button>
          }
        >
          {list?.reason ?? "No model games match this source."}
        </EmptyState>
        <div className="cb-model-rows" style={{ marginTop: 16 }}>
          {historyRow}
          {sourceRow}
        </div>
      </>
    );
  } else if (!timeline) {
    sidebar = (
      <>
        <div className="cb-page-head">
          <h1 className="cb-page-title">
            {game.white} <span className="cb-vs">vs.</span> {game.black}
          </h1>
          <p className="cb-page-sub">{game.eventName || game.event}</p>
        </div>
        <EmptyState icon="fa-chess-board" title="No moves were captured">
          This model game exists, but its SAN move list is unavailable.
        </EmptyState>
        <div className="cb-model-rows" style={{ marginTop: 16 }}>
          {historyRow}
          {sourceRow}
        </div>
      </>
    );
  } else {
    const expected = timeline.moves[ply] ?? null;
    const promptNumber = expected
      ? `${Math.floor(ply / 2) + 1}${expected.side === "white" ? "." : "…"}`
      : "";
    const matchLine = game.openingMatch?.line ?? null;
    const matchGuide = game.openingMatch?.guide ?? null;
    const matchText = matchLine
      ? `This game matches your saved moves in the ${matchLine.lineName}.`
      : matchGuide
        ? `This game matches the captured ${matchGuide.name} guide.`
        : "No saved opening matches this game yet.";
    const result = resultText(game);
    const white = game.players?.white;
    const black = game.players?.black;
    const performances = game.performances ?? {};
    const annotationCount = game.annotations?.length ?? 0;
    const sideLocked = ply > 0 && !completed;
    const matchedEpd = matchLine
      ? game.plies?.[matchLine.matchedPlies - 1]?.epdAfter ?? null
      : null;
    const buildHref = matchLine
      ? `/build/${matchLine.repertoireColor}?${
          matchedEpd
            ? `epd=${encodeURIComponent(matchedEpd)}`
            : `path=${encodeURIComponent(
                matchLine.moves.slice(0, matchLine.matchedPlies).join(" ")
              )}`
        }`
      : null;
    const opponentName = userSide === "white" ? game.black : game.white;

    sidebar = (
      <>
        <div className="cb-page-head">
          <h1 className="cb-page-title">
            {game.white} <span className="cb-vs">vs.</span> {game.black}
          </h1>
          <p className="cb-page-sub">
            {game.daily ? "Today's model game · " : ""}
            {game.eventName || game.event}
            {result ? ` · ${result}` : ""}
          </p>
        </div>

        <div
          className="cb-tabs"
          role="tablist"
          aria-label="Choose the side to guess"
          style={{ marginTop: 12 }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={userSide === "white"}
            className={`cb-tab ${userSide === "white" ? "active" : ""}`}
            disabled={sideLocked}
            style={{ opacity: sideLocked ? 0.55 : 1 }}
            onClick={() => switchSide("white")}
          >
            Guess White
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={userSide === "black"}
            className={`cb-tab ${userSide === "black" ? "active" : ""}`}
            disabled={sideLocked}
            style={{ opacity: sideLocked ? 0.55 : 1 }}
            onClick={() => switchSide("black")}
          >
            Guess Black
          </button>
        </div>

        {completed ? (
          <div className="cb-plan-card" data-testid="model-complete">
            <div>
              <span className="cb-plan-kicker">
                {reviewState.reviewed ? "Reviewed model game" : "Game complete"}
              </span>
              <strong>{score == null ? "—" : `${score}%`}</strong>
              <p>
                {answered === 0
                  ? "No local guesses were recorded. Start again to guess this game."
                  : `${correct} of ${answered} guessed move${
                      answered === 1 ? "" : "s"
                    } correct · ${answered} of ${totalGuesses} move${
                      totalGuesses === 1 ? "" : "s"
                    } guessed${
                      hintsUsed
                        ? ` · ${hintsUsed} hint${hintsUsed === 1 ? "" : "s"} used`
                        : ""
                    }`}
              </p>
            </div>
            <span className="cb-status-pill">
              {reviewState.reviewed ? "Reviewed" : "Complete"}
            </span>
          </div>
        ) : (
          <div className="cb-practice-prompt" data-testid="model-guess-prompt">
            <div className="cb-practice-side">
              <span className={`cb-practice-color ${userSide}`} aria-hidden />
              <div>
                <strong>
                  {autoPlaying
                    ? `${opponentName} is replying…`
                    : `Guess ${userSide === "white" ? "White" : "Black"}'s move`}
                </strong>
                <span>
                  {autoPlaying
                    ? "The reply plays automatically."
                    : `${promptNumber} ${
                        expected?.side === "white" ? "White" : "Black"
                      } to move`}
                </span>
              </div>
            </div>
            <div className="cb-practice-count">
              <strong>{score == null ? "—" : `${score}%`}</strong>
              <span className="cb-row-meta" style={{ fontSize: 10 }}>
                {correct}/{answered} correct
              </span>
            </div>
          </div>
        )}

        <EvalGraph
          samples={evalSamples}
          maxPly={maxPly}
          ply={shownPly}
          onSeek={completed ? (next) => setBrowsePly(next) : undefined}
        />

        {completed ? (
          <div className="cb-model-actions">
            <button
              type="button"
              className="cb-model-action"
              onClick={resetSession}
              data-testid="model-play-again"
            >
              Play again
            </button>
            <button
              type="button"
              className="cb-model-action"
              onClick={() => setBrowsePly(browsePly == null ? 0 : null)}
            >
              {browsePly == null ? "Review moves" : "Back to result"}
            </button>
          </div>
        ) : (
          <div className="cb-model-actions">
            <button
              type="button"
              className="cb-model-action"
              onClick={revealMove}
              disabled={autoPlaying || browsePly != null}
              style={{ opacity: autoPlaying || browsePly != null ? 0.55 : 1 }}
              data-testid="model-play-next"
            >
              Play next move
            </button>
            <button
              type="button"
              className="cb-model-action"
              onClick={giveHint}
              disabled={autoPlaying || browsePly != null}
              style={{ opacity: autoPlaying || browsePly != null ? 0.55 : 1 }}
              data-testid="model-hint"
            >
              {hintLevel >= 2 ? "Show me the move" : "Give me a hint"}
            </button>
          </div>
        )}

        {completed && browsePly != null && (
          <div className="cb-tabs" style={{ marginTop: -10 }}>
            <button
              type="button"
              className="cb-tab"
              onClick={() => setBrowsePly(Math.max(0, browsePly - 1))}
            >
              Previous
            </button>
            <span
              className="cb-row-meta"
              style={{ alignSelf: "center", padding: "0 4px" }}
            >
              {shownPly === 0
                ? "Start position"
                : `After ${timeline.moves[shownPly - 1]?.san ?? "move"}`}
            </span>
            <button
              type="button"
              className="cb-tab"
              onClick={() => setBrowsePly(Math.min(maxPly, browsePly + 1))}
            >
              Next
            </button>
          </div>
        )}

        {!completed && (notice || hintText) && (
          <div style={{ margin: "0 18px 18px" }} aria-live="polite">
            {notice && (
              <p
                className="cb-model-match"
                style={{
                  color:
                    notice.kind === "wrong"
                      ? "var(--cb-danger)"
                      : notice.kind === "ok"
                        ? "var(--cb-green)"
                        : "var(--cb-text-2)",
                  marginBottom: hintText ? 4 : 0,
                }}
              >
                {notice.text}
              </p>
            )}
            {hintText && <p className="cb-model-description">Hint: {hintText}</p>}
          </div>
        )}

        <div className="cb-model-copy">
          <p className="cb-model-match">
            {matchText} Move the pieces on the board to guess the move at any
            point.
          </p>
          <p className="cb-model-description">{gameDescription(game)}</p>
        </div>

        <div className="cb-move-list" aria-label="Moves played in this game">
          {timeline.moves.map((move, index) => {
            if (!completed && index >= ply) return null;
            const outcome = results[index];
            const active = index === shownPly - 1;
            const label = move.san;
            const outcomeLabel =
              outcome === "correct"
                ? "Correct"
                : outcome === "wrong"
                  ? "Missed"
                  : outcome === "revealed"
                    ? "Revealed"
                    : "Played";
            const style =
              outcome === "correct"
                ? { color: "var(--cb-green)" }
                : outcome === "wrong"
                  ? { color: "var(--cb-danger)" }
                  : undefined;
            const content = (
              <>
                {index % 2 === 0 && (
                  <span className="cb-move-number">{index / 2 + 1}.</span>
                )}
                <span>{label}</span>
              </>
            );
            if (completed) {
              return (
                <button
                  key={`${index}-${move.san}`}
                  type="button"
                  className={`cb-move-pill ${index < shownPly ? "past" : ""} ${
                    active ? "active" : ""
                  }`}
                  style={style}
                  title={`${move.side === "white" ? "White" : "Black"} move ${
                    index + 1
                  }: ${label} — ${outcomeLabel}`}
                  onClick={() => setBrowsePly(index + 1)}
                >
                  {content}
                </button>
              );
            }
            return (
              <span
                key={`${index}-${move.san}`}
                className={`cb-move-pill past ${active ? "active" : ""}`}
                style={style}
                title={`${outcomeLabel}: ${label}`}
              >
                {content}
              </span>
            );
          })}
          {!completed && ply < maxPly && timeline.moves[ply] && (
            <span
              className="cb-move-pill"
              style={{ opacity: 0.65 }}
              aria-label="Next move hidden"
            >
              {ply % 2 === 0 && (
                <span className="cb-move-number">{Math.floor(ply / 2) + 1}.</span>
              )}
              <span>?</span>
            </span>
          )}
        </div>

        <p
          className="cb-model-description"
          style={{ margin: "10px 18px 0", fontSize: 11 }}
        >
          Correct guesses are green, misses are red. The answer stays hidden until
          you guess it or reveal it.
        </p>

        <Section title="Saved opening & plans">
          {matchLine ? (
            <Row
              to={buildHref ?? `/build/${matchLine.repertoireColor}`}
              title={matchLine.lineName}
              meta={`${matchLine.repertoireName} · ${matchLine.matchedPlies} plies matched · open the position and its plans`}
              right={<span className="cb-setting-value">Open in builder</span>}
              chevron
            />
          ) : (
            <Row
              title="Matching saved line"
              meta="No saved line follows this game"
              right={<span className="cb-setting-value">No match</span>}
            />
          )}
          {matchGuide ? (
            <Row
              title={matchGuide.name}
              meta={`${matchGuide.eco} · captured opening guide`}
              right={<span className="cb-setting-value">Captured</span>}
            />
          ) : (
            <Row
              title="Opening guide"
              meta="No guide was captured for this opening"
              right={<span className="cb-setting-value">Not captured</span>}
            />
          )}
        </Section>

        <Section title="Game details">
          <Row
            title={
              <span className="cb-rep-title">
                <span className="cb-color-dot white" aria-hidden />
                <span>{white?.name ?? game.white}</span>
              </span>
            }
            meta={performanceText(performances.white)}
            right={
              <span className="cb-setting-value">
                {white?.elo ?? "Rating not captured"}
              </span>
            }
          />
          <Row
            title={
              <span className="cb-rep-title">
                <span className="cb-color-dot black" aria-hidden />
                <span>{black?.name ?? game.black}</span>
              </span>
            }
            meta={performanceText(performances.black)}
            right={
              <span className="cb-setting-value">
                {black?.elo ?? "Rating not captured"}
              </span>
            }
          />
          <Row
            title="Event"
            right={
              <span className="cb-setting-value">
                {game.eventName || game.event || "Not captured"}
              </span>
            }
          />
          <Row
            title="Result"
            meta={game.result ? `PGN result ${game.result}` : "No PGN result tag"}
            right={<span className="cb-setting-value">{result}</span>}
          />
          <Row
            title="Game date"
            right={
              <span className="cb-setting-value">
                {game.year ?? "Not captured"}
              </span>
            }
          />
          <Row
            title="Captured"
            right={
              <span className="cb-setting-value">
                {formatDate(game.capturedAt ?? game.playedAt) ?? "Not captured"}
              </span>
            }
          />
          <Row
            title="Game link"
            meta={
              game.link
                ? "A public game link was captured"
                : "No public game link was captured"
            }
            right={
              <span className="cb-setting-value">
                {game.link ? "Open" : "Not captured"}
              </span>
            }
            onClick={
              game.link
                ? () =>
                    window.open(game.link as string, "_blank", "noopener,noreferrer")
                : undefined
            }
          />
          <Row
            title="Annotations"
            meta={
              annotationCount
                ? "Captured game annotations are available"
                : "Hints fall back to a partial, non-answer reveal"
            }
            right={
              <span className="cb-setting-value">
                {annotationCount
                  ? `${annotationCount} captured`
                  : "None captured"}
              </span>
            }
          />
          <Row
            title="Evaluation samples"
            meta={
              evalCount
                ? "Plotted from the captured win-probability/eval samples"
                : "No captured samples for this game"
            }
            right={
              <span className="cb-setting-value">
                {evalCount ? `${evalCount} captured` : "Unavailable"}
              </span>
            }
          />
          <Row
            title="Engine review"
            meta={
              game.analysis?.engineReviewReason ??
              "No engine review is bundled with this build."
            }
            right={
              <span className="cb-setting-value">
                {game.analysis?.engineReviewAvailable ? "Available" : "Unavailable"}
              </span>
            }
          />
          <Row
            title="Review"
            right={
              <span className="cb-setting-value">
                {reviewState.reviewed
                  ? `Reviewed${
                      reviewState.score != null ? ` · ${reviewState.score}%` : ""
                    }`
                  : "Not reviewed"}
              </span>
            }
          />
        </Section>

        <Section
          title="Position data"
          action={
            <span className="cb-row-meta">
              {shownPly} / {maxPly} plies
            </span>
          }
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "0 18px 4px",
            }}
          >
            <p
              className="cb-model-description"
              style={{
                margin: 0,
                wordBreak: "break-all",
                fontFamily: "var(--cb-font-mono)",
                fontSize: 11,
              }}
            >
              {currentEpd ?? "No EPD was captured for this position."}
            </p>
            <p className="cb-model-description" style={{ margin: 0, fontSize: 11 }}>
              SAN: {game.moves?.length ?? maxPly} plies · EPD: captured model-game
              data
            </p>
          </div>
        </Section>

        <div className="cb-model-rows" style={{ marginTop: 18 }}>
          <Row
            title="Choose another random game"
            onClick={chooseRandom}
            testId="model-random"
          />
          {historyRow}
          {sourceRow}
        </div>
      </>
    );
  }

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader items={[{ label: "Model games" }]} />
          <Board
            fen={displayFen}
            interactive={boardInteractive}
            lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
            lastMoveTint="oklch(0.75 0.1417 230 / 0.42)"
            wrongMove={wrongMove}
            feedback={feedback}
            highlights={highlights}
            onMove={handleBoardMove}
          />
          {game ? (
            <div className="cb-board-footer cb-board-footer-line visible">
              <span className="cb-board-opening">
                {game.white} ({game.players?.white?.elo ?? "—"}) vs. {game.black} (
                {game.players?.black?.elo ?? "—"})
              </span>
              <span className="cb-line-moves">
                {timeline && shownPly < maxPly && nextMove
                  ? `${moveNumberLabel(shownPly)} ${
                      nextMove.side === "white" ? "White" : "Black"
                    } to move`
                  : "Final position"}
              </span>
              <a
                href={`https://lichess.org/analysis/standard/${encodeURIComponent(
                  displayFen.split(" ")[0]
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                Analyze <i className="fa fa-up-right-from-square" aria-hidden />
              </a>
            </div>
          ) : null}
        </section>

        <Sidebar backTo="/" backLabel="Back">
          {sidebar}
        </Sidebar>
      </main>

      {sourceSheet && (
        <OptionSheet
          title="Model games source"
          value={source}
          options={MODEL_SOURCES}
          onSelect={chooseSource}
          onClose={() => setSourceSheet(false)}
        />
      )}
    </div>
  );
}
