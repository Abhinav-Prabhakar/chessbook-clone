import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Chess } from "chess.js";
import { api, ApiError } from "../api";
import type {
  AttemptResponse,
  CardState,
  DailySummary,
  PracticeMode,
  PracticeSession,
  PracticeTask,
  Refutation,
  Repertoire,
  SessionPayload,
} from "../types";
import { Board, type BoardArrow, type BoardHighlight } from "../components/Board";
import { Confetti } from "../components/Confetti";
import { BoardHeader, EmptyState, Row, Sidebar, Splash } from "../components/ui";
import { afterMove, findMove, START_FEN } from "../chess";
import { getPracticePreferences } from "../prefs";
import { useProfile } from "../profile";
import { playSound } from "../sounds";

const MODE_LABELS: Record<string, string> = {
  due: "Due review",
  weak: "Mistakes",
  all: "All moves",
  early: "Early review",
  specific: "Specific opening",
  line: "Specific opening",
  common: "Next common moves",
};

function pct(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value)}%`;
}

const GRADE_LABELS: Record<number, string> = {
  1: "Again",
  2: "Hard",
  3: "Good",
  4: "Easy",
};

function tzOffset() {
  return new Date().getTimezoneOffset();
}

function submissionId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** FEN after a SAN, or null when the move cannot be replayed. */
function fenAfter(fen: string, san: string) {
  try {
    return afterMove(fen, san).fen;
  } catch {
    return null;
  }
}

function noteText(task: PracticeTask | null) {
  if (!task) return null;
  const position = task.noteText?.trim();
  if (position) return position;
  const move = task.moveNote?.note?.trim();
  return move || null;
}

function hintFor(task: PracticeTask) {
  const saved = noteText(task);
  if (saved) return saved;
  const move = findMove(task.fen, task.expectedSan);
  if (!move) return "There is no saved note for this position yet.";
  const piece = pieceNameAt(task.fen, move.from);
  return piece
    ? `Look at your ${piece} on ${move.from}: one of your saved moves starts there.`
    : `One of your saved moves starts on ${move.from}.`;
}

/** Tiny helper so the hint can name the piece without revealing the move. */
function pieceNameAt(fen: string, square: string) {
  const names: Record<string, string> = {
    p: "pawn",
    n: "knight",
    b: "bishop",
    r: "rook",
    q: "queen",
    k: "king",
  };
  try {
    const chess = new Chess(fen);
    const piece = chess.get(square as any);
    return piece ? names[piece.type] ?? null : null;
  } catch {
    return null;
  }
}

function DailyGoalLine({ daily }: { daily: DailySummary | null }) {
  if (!daily) return null;
  const percent = daily.goal > 0 ? Math.min(100, (daily.reviews / daily.goal) * 100) : 0;
  return (
    <div
      style={{
        margin: "18px 18px 0",
        paddingTop: 12,
        borderTop: "1px solid var(--cb-border-soft)",
        color: "var(--cb-text-3)",
        fontSize: 11,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span>
          Daily goal {daily.reviews}/{daily.goal}
          {daily.goalMet ? " · met" : ""}
        </span>
        <span>
          {daily.streak.current}-day streak
          {daily.streak.highest > daily.streak.current
            ? ` · best ${daily.streak.highest}`
            : ""}
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          overflow: "hidden",
          background: "var(--cb-border-soft)",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${percent}%`,
            background: daily.goalMet ? "var(--cb-green)" : "var(--cb-blue)",
            transition: "width 200ms ease",
          }}
        />
      </div>
    </div>
  );
}

export function PracticePage() {
  const { key = "white" } = useParams<{ key: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const search = params.toString();
  const { settings } = useProfile();
  const prefs = getPracticePreferences();
  const reviewStyle = settings?.reviewStyle ?? prefs.reviewStyle;
  const practiceMode = settings?.practiceMode ?? prefs.mode;
  const pauseAfterMove = settings?.pauseAfterMove ?? prefs.pauseAfterMove;
  const pauseOnFail = settings?.pauseOnFail ?? prefs.pause.onFail;
  const pauseWhenNote = settings?.pauseWhenNote ?? prefs.pause.whenNote;
  const pauseOnLowScore = settings?.pauseOnLowScore ?? prefs.pause.onLowScore;

  const [session, setSession] = useState<PracticeSession | null>(null);
  const [task, setTask] = useState<PracticeTask | null>(null);
  const [stats, setStats] = useState<Repertoire | null>(null);
  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [config, setConfig] = useState<{ mode: PracticeMode; lineIds: number[] }>({
    mode: "due",
    lineIds: [],
  });
  const [resumed, setResumed] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [endFen, setEndFen] = useState<string | null>(null);
  const [endLast, setEndLast] = useState<{ from: string; to: string } | null>(null);
  const [flash, setFlash] = useState<{
    fen: string;
    move: { from: string; to: string };
    san: string;
  } | null>(null);
  const [refutation, setRefutation] = useState<Refutation | null>(null);
  const [lastCard, setLastCard] = useState<CardState | null>(null);
  const [held, setHeld] = useState(false);
  const [advanceHold, setAdvanceHold] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "info" | "wrong" | "ok";
    text: string;
  } | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [assisted, setAssisted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const flashTimer = useRef<number | null>(null);
  const pauseTimer = useRef<number | null>(null);
  const createdSessions = useRef<Set<string>>(new Set());

  const requestedLineIds = useMemo(() => {
    const multi = params.get("lines");
    const single = params.get("line");
    const values = [
      ...(multi ? multi.split(",") : []),
      ...(single ? [single] : []),
    ]
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    return [...new Set(values)];
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyPayload = useCallback(
    (payload: SessionPayload, options: { created?: boolean } = {}) => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      if (options.created) createdSessions.current.add(payload.session.id);
      setSession(payload.session);
      setTask(payload.task);
      setStats(payload.repertoire);
      setResumed(
        Boolean(payload.resumed) && !createdSessions.current.has(payload.session.id)
      );
      setCompleted(!payload.task && payload.session.complete);
      setEndFen(null);
      setEndLast(null);
      setFlash(null);
      setRefutation(null);
      setLastCard(null);
      setHeld(false);
      setAdvanceHold(false);
      setNotice(null);
      setHintText(null);
      setRevealed(null);
      setAssisted(false);
    },
    []
  );

  const refreshDaily = useCallback(() => {
    api
      .get<{ daily: DailySummary }>(`/practice/daily?tzOffset=${tzOffset()}`)
      .then((result) => setDaily(result.daily))
      .catch(() => {
        // Daily progress is additive; practice still works without it.
      });
  }, []);

  /**
   * Keep the session in the URL so a reload (or an offline reconnect) resumes
   * the exact position instead of creating a fresh queue (audit checklist:
   * "Reloading mid-session resumes at the same position").
   */
  const rememberSession = useCallback((id: string) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("session", id);
      window.history.replaceState({}, "", url);
    } catch {
      // Cosmetic only; the in-memory session stays authoritative.
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const sessionParam = params.get("session");
    const modeParam = params.get("mode") as PracticeMode | null;
    const lineIds = requestedLineIds;
    const defaultMode: PracticeMode = "due";
    try {
      let payload: SessionPayload;
      let nextConfig: { mode: PracticeMode; lineIds: number[] } = {
        mode: modeParam || defaultMode,
        lineIds,
      };

      if (sessionParam) {
        const current = await api.get<SessionPayload>(
          `/practice/sessions/${sessionParam}/current`
        );
        payload =
          current.session.status === "paused"
            ? await api.post<SessionPayload>(
                `/practice/sessions/${sessionParam}/resume`
              )
            : current;
        nextConfig = { mode: current.session.mode, lineIds: [] };
        if (!payload.resumed) payload = { ...payload, resumed: true };
      } else if (!modeParam && lineIds.length === 0) {
        const list = await api.get<{ sessions: PracticeSession[] }>(
          `/practice/sessions?repertoire=${key}&status=all`
        );
        const latest = list.sessions.find((item) => item.status !== "complete");
        if (latest) {
          const current = await api.get<SessionPayload>(
            `/practice/sessions/${latest.id}/current`
          );
          payload =
            current.session.status === "paused"
              ? await api.post<SessionPayload>(
                  `/practice/sessions/${latest.id}/resume`
                )
              : current;
          payload = { ...payload, resumed: true };
          nextConfig = { mode: latest.mode, lineIds: [] };
        } else {
          payload = await api.post<SessionPayload>("/practice/sessions", {
            repertoire: key,
            mode: defaultMode,
            style: reviewStyle,
            practiceMode,
            coverageGoal: settings?.coverageGoal,
          });
          nextConfig = { mode: defaultMode, lineIds: [] };
        }
      } else {
        payload = await api.post<SessionPayload>("/practice/sessions", {
          repertoire: key,
          mode: modeParam || defaultMode,
          lineIds,
          lineId: lineIds[0],
          resume: true,
          style: reviewStyle,
          practiceMode,
          coverageGoal: settings?.coverageGoal,
        });
      }

      setConfig(nextConfig);
      applyPayload(payload, { created: payload.resumed === false });
      if (payload.session?.id) rememberSession(payload.session.id);
      refreshDaily();
    } catch (e: any) {
      setError(e?.message || "The practice session could not be opened.");
    } finally {
      setLoading(false);
    }
  }, [applyPayload, key, params, rememberSession, refreshDaily, requestedLineIds, reviewStyle, practiceMode, settings?.coverageGoal]);

  useEffect(() => {
    load();
  }, [key, search]); // eslint-disable-line react-hooks/exhaustive-deps

  // A queued offline attempt is replayed by the global queue when the local API
  // returns. Pull the authoritative session so the board reflects the replay.
  useEffect(() => {
    const onFlushed = () => {
      if (!session?.id || session.status !== "active") return;
      api
        .get<SessionPayload>(`/practice/sessions/${session.id}/current`)
        .then((payload) => applyPayload(payload))
        .catch(() => {
          // Keep the board; the global banner still reports the queue state.
        });
    };
    window.addEventListener("cb:offline-flushed", onFlushed);
    return () => window.removeEventListener("cb:offline-flushed", onFlushed);
  }, [session?.id, session?.status, applyPayload]);

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      if (pauseTimer.current) window.clearTimeout(pauseTimer.current);
    },
    []
  );

  const baseFen = task?.fen ?? endFen ?? START_FEN;
  const boardFen = flash ? flash.fen : baseFen;
  const color = stats?.color ?? "white";
  const position = useMemo(() => findMove(task?.fen ?? baseFen, task?.expectedSan ?? ""), [
    task,
    baseFen,
  ]);

  const lastMove = flash
    ? flash.move
    : task?.autoReply
      ? { from: task.autoReply.from, to: task.autoReply.to }
      : endLast;

  const highlights: BoardHighlight[] = [];
  if (hintText && !revealed && position) {
    highlights.push({ square: position.from, kind: "hint" });
  }
  if (flash && refutation?.available && refutation.to) {
    highlights.push({ square: refutation.to, kind: "refutation" });
  }

  const arrows: BoardArrow[] = [];
  if (flash) {
    arrows.push({ from: flash.move.from, to: flash.move.to, kind: "wrong" });
    // While the wrong position is held on the board, draw the engine's reply
    // on that same position so the arrow is always legal.
    if (refutation?.available && refutation.from && refutation.to) {
      arrows.push({ from: refutation.from, to: refutation.to, kind: "refutation" });
    }
  } else if (revealed && position) {
    arrows.push({ from: position.from, to: position.to, kind: "hint" });
  } else if (!hintText) {
    for (const plan of task?.planArrows ?? []) {
      arrows.push({ from: plan.from, to: plan.to, kind: "plan", color: undefined });
    }
  }

  const promptSuffix = task?.side === "white" ? "." : "…";
  const promptGlyph = revealed ?? "＿";
  const savedNote = noteText(task);
  const prefix = task?.prefix ?? [];
  const dueCount = stats?.due ?? 0;
  const correct = session?.correct ?? 0;
  const wrong = session?.wrong ?? 0;
  const answered = correct + wrong;
  const accuracy = answered ? Math.round((correct / answered) * 100) : null;

  const makeMove = async (move: { from: string; to: string; san: string }) => {
    if (!task || !session || busy || completed) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.post<AttemptResponse>(
        `/practice/sessions/${session.id}/attempt`,
        {
          san: move.san,
          epd: task.epd,
          submissionId: submissionId(),
          hint: assisted,
          tzOffset: tzOffset(),
        }
      );
      setStats(result.stats);
      setDaily(result.daily);
      setSession(result.session);

      if (result.correct) {
        setAssisted(false);
        setRevealed(null);
        setHintText(null);
        setRefutation(null);
        setLastCard(result.card ?? null);
        const nextTask = result.next.task;
        const advance = () => {
          setAdvanceHold(false);
          setTask(nextTask);
          setLastCard(null);
          const noteHold = Boolean(
            pauseWhenNote &&
              nextTask &&
              (nextTask.noteText || nextTask.moveNote?.note)
          );
          const answeredNow = result.session.correct + result.session.wrong;
          const accuracyNow = answeredNow
            ? (result.session.correct / answeredNow) * 100
            : 100;
          const scoreHold = Boolean(
            pauseOnLowScore && nextTask && answeredNow >= 4 && accuracyNow < 50
          );
          if (noteHold) {
            setHeld(true);
            setNotice({
              kind: "info",
              text: "This position has a saved note. Read it, then continue when ready.",
            });
          } else if (scoreHold) {
            setHeld(true);
            setNotice({
              kind: "info",
              text: `Accuracy is ${Math.round(accuracyNow)}%. Paused on low score — continue when ready.`,
            });
          }
          if (!nextTask) {
            setCompleted(true);
            setEndFen(fenAfter(task.fen, result.playedSan));
            setEndLast({ from: move.from, to: move.to });
          }
        };
        const feedback: string[] = [];
        if (result.playedSan && result.playedSan !== task.expectedSan) {
          feedback.push(`Accepted alternate ${result.playedSan}.`);
        }
        if ((session.style ?? reviewStyle) === "cards" && result.card?.grade != null) {
          const interval = result.scheduled?.intervalDays;
          feedback.push(
            `Rated ${GRADE_LABELS[result.card.grade] ?? result.card.grade}` +
              (interval != null ? ` · next in ${interval} day${interval === 1 ? "" : "s"}.` : ".")
          );
        }
        if (feedback.length) {
          setNotice({ kind: "ok", text: feedback.join(" ") });
        }
        if (pauseAfterMove > 0 && nextTask) {
          setNotice({
            kind: "info",
            text: `Correct. Paused for ${pauseAfterMove}s — play when ready.`,
          });
          setAdvanceHold(true);
          if (pauseTimer.current) window.clearTimeout(pauseTimer.current);
          pauseTimer.current = window.setTimeout(advance, pauseAfterMove * 1000);
        } else {
          advance();
        }
        playSound("correct");
      } else {
        setLastCard(result.card ?? null);
        setRefutation(result.refutation ?? null);
        const after = fenAfter(task.fen, result.playedSan);
        if (after) {
          setFlash({
            fen: after,
            move: { from: move.from, to: move.to },
            san: result.playedSan,
          });
          if (flashTimer.current) window.clearTimeout(flashTimer.current);
          if (!pauseOnFail) {
            flashTimer.current = window.setTimeout(() => setFlash(null), 1200);
          }
        }
        if (pauseOnFail) setHeld(true);
        const explanation = result.refutation?.explanation
          ? ` ${result.refutation.explanation}`
          : "";
        setNotice({
          kind: "wrong",
          text:
            (result.playedSan
              ? `Not quite — ${result.playedSan} is not one of your saved moves here.`
              : "Not quite.") +
            explanation +
            (result.replay?.replays
              ? " This line will be replayed once more this session."
              : " The position is unchanged, try again."),
        });
        playSound("wrong");
      }
    } catch (e: any) {
      setNotice({
        kind: "wrong",
        text: e?.message || "That move could not be played.",
      });
      if (e instanceof ApiError && e.status === 409) {
        try {
          const current = await api.get<SessionPayload>(
            `/practice/sessions/${session.id}/current`
          );
          applyPayload(current);
        } catch {
          // Keep the current board; the notice explains the failure.
        }
      }
      playSound("wrong");
    } finally {
      setBusy(false);
    }
  };

  const showHint = () => {
    if (!task) return;
    setHintText(hintFor(task));
    setAssisted(true);
  };

  const showAnswer = () => {
    if (!task) return;
    setRevealed(task.expectedSan);
    setHintText(null);
    setAssisted(true);
    setNotice({
      kind: "info",
      text: `The saved move is ${task.expectedSan}. Play it on the board.`,
    });
  };

  const continueFromHold = () => {
    setHeld(false);
    setFlash(null);
    setRefutation(null);
    setNotice({ kind: "info", text: "Continue when you are ready." });
    if (pauseTimer.current) window.clearTimeout(pauseTimer.current);
  };

  const runAction = async (action: "skip" | "keep" | "reset") => {
    if (!session || busy) return;
    setBusy(true);
    try {
      const payload = await api.post<SessionPayload>(
        `/practice/sessions/${session.id}/${action}`
      );
      applyPayload(payload);
      refreshDaily();
      if (action === "skip") {
        setNotice({ kind: "info", text: "Skipped this position for now." });
      } else if (action === "keep") {
        setNotice({
          kind: "info",
          text: "Kept this position for future review.",
        });
      } else {
        setNotice({ kind: "info", text: "Started this session over." });
      }
    } catch (e: any) {
      setNotice({ kind: "wrong", text: e?.message || "That action failed." });
    } finally {
      setBusy(false);
    }
  };

  const exitPractice = async () => {
    if (session && session.status === "active") {
      try {
        await api.post(`/practice/sessions/${session.id}/pause`);
      } catch {
        // Leaving the screen is more important than persisting the pause.
      }
    }
    navigate(`/learn/${key}`);
  };

  const startNew = async (
    mode: PracticeMode,
    lineIds: number[] = config.lineIds
  ) => {
    const effectiveMode =
      (mode === "specific" || mode === "line") && lineIds.length === 0
        ? "all"
        : mode;
    setBusy(true);
    try {
      const payload = await api.post<SessionPayload>("/practice/sessions", {
        repertoire: key,
        mode: effectiveMode,
        lineIds,
        lineId: lineIds[0],
        resume: false,
        style: reviewStyle,
        practiceMode,
        coverageGoal: settings?.coverageGoal,
      });
      applyPayload(payload, { created: true });
      setConfig({ mode: effectiveMode, lineIds });
      refreshDaily();
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("session", payload.session.id);
        url.searchParams.set("mode", effectiveMode);
        url.searchParams.delete("line");
        url.searchParams.delete("lines");
        if (lineIds.length) url.searchParams.set("lines", lineIds.join(","));
        window.history.replaceState({}, "", url);
      } catch {
        // The URL is cosmetic; the in-memory session is authoritative.
      }
    } catch (e: any) {
      setNotice({ kind: "wrong", text: e?.message || "Could not start a session." });
    } finally {
      setBusy(false);
    }
  };

  const practiceAgain = () => startNew(config.mode, config.lineIds);

  if (loading) return <Splash label="Preparing your training position…" />;

  if (error) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <button type="button" className="cb-btn" onClick={load}>
          Try again
        </button>
        <Link className="cb-btn ghost" to={`/learn/${key}`}>
          Back to learn
        </Link>
      </div>
    );
  }

  const analyzeHref = `https://lichess.org/analysis/standard/${encodeURIComponent(
    (task?.fen ?? baseFen).split(" ")[0]
  )}?color=${color}`;
  const trainingGameHref = task
    ? `/training-games?fen=${encodeURIComponent(task.fen)}&color=${color}&from=practice`
    : `/training-games?color=${color}&from=practice`;

  return (
    <div className="cb-app">
      <main className="cb-main">
        <section className="cb-board-col">
          <BoardHeader
            items={[
              { label: stats?.name ?? "Repertoire", to: `/repertoire/${key}` },
              { label: "Learn", to: `/learn/${key}` },
              { label: "Practice" },
            ]}
          />
          <Board
            fen={boardFen}
            orientation={color}
            interactive={Boolean(task) && !completed && !busy && !held && !advanceHold}
            lastMove={lastMove}
            lastMoveTint="oklch(0.75 0.1417 230 / 0.42)"
            arrows={arrows}
            highlights={highlights}
            onMove={makeMove}
          />
          <div className="cb-board-footer cb-board-footer-line visible">
            <span className="cb-board-opening">
              {task ? task.lineName : completed ? "Session complete" : "Practice"}
            </span>
            <span className="cb-line-moves" aria-label="Moves played so far">
              {prefix.map((move, index) => (
                <span
                  key={`${move.ply}-${move.san}`}
                  className={index === prefix.length - 1 ? "current" : ""}
                >
                  {move.side === "white" && <em>{move.moveNumber}.</em>} {move.san}{" "}
                </span>
              ))}
              {task && <span className="current">{promptGlyph}</span>}
            </span>
            <a href={analyzeHref} target="_blank" rel="noreferrer">
              Analyze <i className="fa fa-up-right-from-square" aria-hidden />
            </a>
          </div>
        </section>

        <Sidebar backTo={`/learn/${key}`} backLabel="Back">
          {completed ? (
            <>
              <div className="cb-practice-head">
                <div>
                  <h1 className="cb-page-title">
                    {session?.total === 0 ? "Nothing is due" : "Session complete"}
                  </h1>
                  <p className="cb-page-sub">
                    {session?.total === 0
                      ? "You are caught up. There are no positions waiting for review."
                      : `${correct} correct · ${wrong} missed${
                          session?.skipped ? ` · ${session.skipped} skipped` : ""
                        }${accuracy == null ? "" : ` · ${accuracy}% accuracy`}`}
                  </p>
                </div>
                <div className="cb-practice-score">
                  <span>
                    {dueCount} Due <i className="fa fa-clock" aria-hidden />
                  </span>
                  <span>
                    {correct} <i className="fa fa-circle-check" aria-hidden />
                  </span>
                  <span>
                    {wrong} <i className="fa fa-circle-xmark" aria-hidden />
                  </span>
                </div>
              </div>

              <div className="cb-learn-options cb-practice-options">
                <Row
                  title="Practice again"
                  className="cb-row-primary"
                  right={<i className="fa fa-rotate-right" aria-hidden />}
                  onClick={practiceAgain}
                  disabled={busy}
                />
                <Row
                  title="Practice all moves"
                  right={<span className="cb-row-meta">{stats?.moveCount ?? 0} moves</span>}
                  onClick={() => startNew("all", [])}
                  disabled={busy || !(stats?.moveCount ?? 0)}
                />
                {(stats?.learned ?? 0) > 0 && (
                  <Row
                    title="Review early"
                    right={<i className="fa fa-clock" aria-hidden />}
                    onClick={() => startNew("early", [])}
                    disabled={busy}
                  />
                )}
                <Row title="Back to learn" to={`/learn/${key}`} />
                <Row title="Back to repertoire" to={`/repertoire/${key}`} />
              </div>

              {session?.total === 0 && (
                <div style={{ marginTop: 18 }}>
                  <EmptyState icon="fa-circle-check" title="You are caught up">
                    New moves become due as you add them. You can still review early or walk
                    through every saved move.
                  </EmptyState>
                </div>
              )}

              <DailyGoalLine daily={daily} />
            </>
          ) : (
            <>
              <div className="cb-practice-head">
                <div>
                  <h1 className="cb-page-title">Practicing moves</h1>
                  <p className="cb-page-sub">
                    {resumed
                      ? "Resumed where you left off. Play the correct move on the board."
                      : "Play the correct move on the board."}
                    {session
                      ? ` · ${MODE_LABELS[session.mode] ?? "Review"} · ${
                          session.remaining
                        } left`
                      : ""}
                  </p>
                </div>
                <div className="cb-practice-score">
                  <span>
                    {dueCount} Due <i className="fa fa-clock" aria-hidden />
                  </span>
                  <span>
                    {correct} <i className="fa fa-circle-check" aria-hidden />
                  </span>
                  <span>
                    {wrong} <i className="fa fa-circle-xmark" aria-hidden />
                  </span>
                </div>
              </div>

              {task && (
                <div
                  data-testid="practice-prompt"
                  style={{
                    borderTop: "1px solid var(--cb-border-soft)",
                    borderBottom: "1px solid var(--cb-border-soft)",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "max-content minmax(0, 1fr)",
                      gap: "0 8px",
                      alignItems: "start",
                      padding: "12px 18px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 13,
                        fontWeight: 600,
                        lineHeight: "20px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ color: "var(--cb-text-3)", letterSpacing: "0.05em" }}>
                        {task.moveNumber}
                        {promptSuffix}
                      </span>
                      <strong
                        data-testid="practice-expected-glyph"
                        style={{
                          fontFamily: "inherit",
                          fontSize: 15,
                          fontWeight: 700,
                          lineHeight: "20px",
                          letterSpacing: "0.08em",
                          color: revealed ? "var(--cb-orange)" : "var(--cb-text)",
                        }}
                      >
                        {promptGlyph}
                      </strong>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          lineHeight: "20px",
                          color: savedNote ? "var(--cb-text-2)" : "var(--cb-text-3)",
                          opacity: savedNote ? 1 : 0.55,
                          overflowWrap: "break-word",
                        }}
                      >
                        {savedNote ?? "No notes added"}
                      </p>
                      {task.moveNote?.note && savedNote !== task.moveNote.note && (
                        <p
                          style={{
                            margin: 0,
                            fontSize: 11,
                            lineHeight: "18px",
                            color: "var(--cb-text-3)",
                            overflowWrap: "break-word",
                          }}
                        >
                          Move note: {task.moveNote.note}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {task && (session?.style ?? reviewStyle) === "cards" && (
                <div className="cb-review-card" data-testid="review-card">
                  <div className="cb-review-card-head">
                    <span>Review card</span>
                    <span className="cb-row-meta">
                      {(lastCard ?? task.card)?.reviewed ? "Review" : "New"}
                    </span>
                  </div>
                  <div className="cb-review-card-grid">
                    <div>
                      <span>Difficulty</span>
                      <strong>{(lastCard ?? task.card)?.difficulty ?? "—"}/10</strong>
                    </div>
                    <div>
                      <span>Expected wrong</span>
                      <strong>{pct((lastCard ?? task.card)?.expectedWrongPercent)}</strong>
                    </div>
                    <div>
                      <span>Seen</span>
                      <strong>{(lastCard ?? task.card)?.reps ?? 0}×</strong>
                    </div>
                    <div>
                      <span>Last grade</span>
                      <strong>
                        {(() => {
                          const grade = (lastCard ?? task.card)?.grade;
                          return grade == null ? "—" : GRADE_LABELS[grade] ?? grade;
                        })()}
                      </strong>
                    </div>
                  </div>
                  {(lastCard ?? task.card)?.dueAt && (
                    <p className="cb-row-meta" style={{ margin: "8px 0 0" }}>
                      Next due{" "}
                      {new Date((lastCard ?? task.card)!.dueAt!).toLocaleDateString()}
                      {(lastCard ?? task.card)?.intervalDays != null
                        ? ` · ${(lastCard ?? task.card)!.intervalDays} day interval`
                        : ""}
                    </p>
                  )}
                </div>
              )}

              {session?.mode === "common" && (
                <div className="cb-inline-note" role="status" style={{ margin: "12px 18px 0" }}>
                  <i className="fa fa-shuffle" aria-hidden />
                  <span>
                    Next common moves · drawn from captured opponent-move incidence at your
                    profile band.
                    {task?.common
                      ? ` Opponents played ${task.common.via.san} here in 1 in ${task.common.via.oneIn} games.`
                      : ""}
                  </span>
                </div>
              )}

              {held && (
                <div className="cb-inline-note" role="status" style={{ margin: "12px 18px 0" }}>
                  <i className="fa fa-pause" aria-hidden />
                  <span>
                    {refutation?.available
                      ? "The position is held so you can study the refutation."
                      : "Paused. Continue when you are ready."}
                  </span>
                  <button type="button" className="cb-btn" onClick={continueFromHold}>
                    Continue
                  </button>
                </div>
              )}

              {refutation?.available && (
                <div className="cb-refutation" data-testid="refutation">
                  <div className="cb-refutation-head">
                    <span className="cb-refutation-swatch" aria-hidden />
                    <strong>Refutation: {refutation.san}</strong>
                    <span className="cb-row-meta">
                      {refutation.engine}
                      {refutation.depth ? ` · depth ${refutation.depth}` : ""}
                    </span>
                  </div>
                  <p>{refutation.explanation}</p>
                  {refutation.line && refutation.line.length > 0 && (
                    <p className="cb-row-meta">
                      Line: {refutation.line.join(" ")}
                    </p>
                  )}
                </div>
              )}

              {notice && (
                <div
                  className="cb-inline-note"
                  role={notice.kind === "wrong" ? "alert" : "status"}
                  style={{
                    margin: "12px 18px 0",
                    borderLeft:
                      notice.kind === "wrong"
                        ? "3px solid var(--cb-danger)"
                        : notice.kind === "ok"
                          ? "3px solid var(--cb-green)"
                          : "3px solid var(--cb-blue)",
                  }}
                >
                  <i
                    className={`fa ${
                      notice.kind === "wrong"
                        ? "fa-triangle-exclamation"
                        : notice.kind === "ok"
                          ? "fa-circle-check"
                          : "fa-lightbulb"
                    }`}
                    aria-hidden
                  />
                  <span>{notice.text}</span>
                </div>
              )}

              {hintText && !revealed && (
                <div
                  className="cb-inline-note"
                  role="status"
                  style={{ margin: "12px 18px 0", borderLeft: "3px solid var(--cb-orange)" }}
                >
                  <i className="fa fa-lightbulb" aria-hidden />
                  <span>{hintText}</span>
                </div>
              )}

              {task && task.alternatives.length > 1 && (
                <div
                  className="cb-inline-note"
                  role="status"
                  style={{ margin: "12px 18px 0" }}
                >
                  <i className="fa fa-code-branch" aria-hidden />
                  <span>
                    You have {task.alternatives.length} saved moves in this position. Any of
                    them is accepted.
                  </span>
                </div>
              )}

              <div className="cb-learn-options cb-practice-options" style={{ marginTop: 36 }}>
                <Row
                  title={
                    hintText
                      ? "I still need a hint"
                      : revealed
                        ? "The answer is on the board"
                        : "I don't know, give me a hint"
                  }
                  className="cb-row-primary"
                  right={<i className="fa fa-lightbulb" aria-hidden />}
                  onClick={showHint}
                  disabled={busy || !task || Boolean(revealed)}
                />
                {!revealed && (
                  <Row
                    title="I don't know, show me the answer"
                    onClick={showAnswer}
                    disabled={busy || !task}
                  />
                )}
                <Row
                  title="I don't know, skip this one"
                  onClick={() => runAction("skip")}
                  disabled={busy || !task}
                />
                <Row
                  title="Keep this position for future review"
                  onClick={() => runAction("keep")}
                  disabled={busy || !task}
                />
                <Row
                  title="I've changed my mind, start over"
                  onClick={() => runAction("reset")}
                  disabled={busy || !session}
                />
                <Row
                  title="View in build mode"
                  onClick={() => {
                    if (!task) return;
                    const path = task.prefix.map((move) => move.san).join(",");
                    navigate(
                      `/build/${key}?path=${encodeURIComponent(path)}&line=${task.lineId}`
                    );
                  }}
                  disabled={!task}
                />
                <Row
                  title="Play a training game from here"
                  meta={
                    task
                      ? "Start a game against the local bot from this exact position"
                      : "Start a game against the local bot"
                  }
                  to={trainingGameHref}
                />
                <Row title="How practice works" to="/help#practice" />
                <Row title="Exit practice" onClick={exitPractice} />
              </div>

              <DailyGoalLine daily={daily} />
            </>
          )}
        </Sidebar>
      </main>
      <Confetti fire={Boolean(completed && correct > 0)} />
    </div>
  );
}
