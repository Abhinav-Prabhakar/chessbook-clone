import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { AttemptResult, Line, PracticeNext, Repertoire } from "../types";
import { Board } from "../components/Board";
import { Confetti } from "../components/Confetti";
import {
  BoardHeader,
  EmptyState,
  ProgressRing,
  Row,
  Section,
  Sidebar,
  Splash,
  Stat,
} from "../components/ui";
import { afterMove, afterMoves, START_FEN } from "../chess";
import { useToast } from "../components/Toast";
import { playSound } from "../sounds";

export function PracticePage() {
  const { key = "white" } = useParams<{ key: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const requestedLine = params.get("line");
  const mode = params.get("mode") || "due";

  const [current, setCurrent] = useState<Line | null>(null);
  const [stats, setStats] = useState<Repertoire | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [complete, setComplete] = useState(false);
  const [fen, setFen] = useState(START_FEN);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [wrongMove, setWrongMove] = useState<{ from: string; to: string } | null>(null);
  const [solved, setSolved] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextLine, setNextLine] = useState<Line | null>(null);
  const [nextComplete, setNextComplete] = useState(false);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionWrong, setSessionWrong] = useState(0);
  const color = stats?.color ?? current?.side ?? "white";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const wrongTimer = useRef<number | null>(null);

  const beginLine = useCallback((line: Line) => {
    if (wrongTimer.current) window.clearTimeout(wrongTimer.current);
    setCurrent(line);
    setFen(line.fen);
    setSolved(false);
    setShowAnswer(false);
    setFeedback(null);
    setWrongMove(null);
    setNextLine(null);
    setNextComplete(false);
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    setComplete(false);
    try {
      if (requestedLine) {
        const data = await api.get<{ repertoire: Repertoire; lines: Line[] }>(
          `/repertoires/${key}`
        );
        const line = data.lines.find((l) => l.id === Number(requestedLine));
        setStats(data.repertoire);
        if (line) {
          beginLine(line);
          setRemaining(data.repertoire.due);
        } else {
          const next = await api.get<PracticeNext>(`/practice/next?repertoire=${key}&mode=${mode}`);
          setRemaining(next.remaining);
          setComplete(next.complete);
          if (next.line) beginLine(next.line);
        }
      } else {
        const next = await api.get<PracticeNext>(`/practice/next?repertoire=${key}&mode=${mode}`);
        setStats(next.stats);
        setRemaining(next.remaining);
        setComplete(next.complete);
        if (next.line) beginLine(next.line);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [beginLine, key, requestedLine, mode]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useEffect(
    () => () => {
      if (wrongTimer.current) window.clearTimeout(wrongTimer.current);
    },
    []
  );

  const playedMoves = useMemo(
    () => (current ? current.moves.slice(0, -1) : []),
    [current]
  );

  const nextNumber = Math.floor(playedMoves.length / 2) + 1;
  const nextSuffix = playedMoves.length % 2 === 0 ? "." : "...";
  const prefixMove = playedMoves.length ? afterMoves(START_FEN, playedMoves) : null;

  const accuracy =
    sessionCorrect + sessionWrong === 0
      ? null
      : Math.round((sessionCorrect / (sessionCorrect + sessionWrong)) * 100);

  const makeMove = async (move: { from: string; to: string; san: string }) => {
    if (!current || solved || busy) return;
    setBusy(true);
    try {
      const result = await api.post<AttemptResult>("/practice/attempt", {
        lineId: current.id,
        san: move.san,
        mode,
      });
      setStats(result.stats);
      setRemaining(result.next.remaining);
      if (result.correct) {
        setSessionCorrect((n) => n + 1);
        const played = afterMove(current.fen, current.expectedSan);
        setFen(played.fen);
        setFeedback("correct");
        setSolved(true);
        setShowAnswer(false);
        setNextLine(result.next.line);
        setNextComplete(result.next.complete);
        playSound("correct");
        toast(`Correct — ${current.expectedSan}`, "ok");
      } else {
        setSessionWrong((n) => n + 1);
        const played = afterMove(current.fen, move.san);
        setFen(played.fen);
        setWrongMove({ from: move.from, to: move.to });
        setFeedback("wrong");
        playSound("wrong");
        toast("Not quite. Try that position again.", "bad");
        wrongTimer.current = window.setTimeout(() => {
          setFen(current.fen);
          setWrongMove(null);
          setFeedback(null);
        }, 950);
      }
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    if (!current || solved) return;
    const played = afterMove(current.fen, current.expectedSan);
    setFen(played.fen);
    setFeedback("correct");
    setSolved(true);
    setShowAnswer(true);
    setNextLine(null);
    setNextComplete(remaining <= 1);
    try {
      const updated = await api.patch<{ line: Line }>(`/lines/${current.id}`, {
        learned: true,
        mastered: Math.max(current.mastered, 8),
        dueAt: new Date(Date.now() + 10 * 60000).toISOString(),
      });
      setCurrent(updated.line);
      toast(`The move is ${current.expectedSan}`, "info");
      const next = await api.get<PracticeNext>(`/practice/next?repertoire=${key}&mode=${mode}`);
      setStats(next.stats);
      setNextLine(next.line);
      setNextComplete(next.complete);
    } catch {
      toast(`The move is ${current.expectedSan}`, "info");
    }
  };

  const advance = () => {
    if (nextLine) {
      beginLine(nextLine);
      if (requestedLine) {
        const next = new URLSearchParams(params);
        next.delete("line");
        setParams(next, { replace: true });
      }
      return;
    }
    if (nextComplete) {
      setComplete(true);
      setCurrent(null);
      setFen(START_FEN);
      return;
    }
    loadInitial();
  };

  const practiceAgain = () => {
    const next = new URLSearchParams(params);
    next.delete("line");
    setParams(next, { replace: true });
    setSessionCorrect(0);
    setSessionWrong(0);
    setComplete(false);
    loadInitial();
  };

  if (loading) return <Splash label="Preparing your training position…" />;

  if (error) {
    return (
      <div className="cb-splash">
        <p>{error}</p>
        <button type="button" className="cb-btn" onClick={loadInitial}>
          Try again
        </button>
        <Link className="cb-btn ghost" to={`/learn/${key}`}>
          Back to learn
        </Link>
      </div>
    );
  }

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
            fen={fen}
            orientation={color}
            interactive={Boolean(current) && !solved && !busy}
            feedback={feedback}
            wrongMove={wrongMove}
            lastMove={
              solved && current
                ? (() => {
                    const move = afterMove(current.fen, current.expectedSan);
                    return { from: move.from, to: move.to };
                  })()
                : prefixMove && prefixMove.from
                  ? { from: prefixMove.from, to: prefixMove.to }
                  : null
            }
            onMove={makeMove}
          />
          <div className="cb-board-footer cb-board-footer-line visible">
            <span className="cb-board-opening">
              {current ? current.name : "Session complete"}
            </span>
            {current && (
              <span className="cb-line-moves">
                {playedMoves.map((san, i) => (
                  <span key={`${san}-${i}`} className={i === playedMoves.length - 1 && !solved ? "current" : ""}>
                    {i % 2 === 0 && <em>{i / 2 + 1}.</em>} {san}{" "}
                  </span>
                ))}
                {solved && (
                  <span className="current">
                    {playedMoves.length % 2 === 0 && <em>{nextNumber}.</em>} {current.expectedSan}
                  </span>
                )}
              </span>
            )}
            <a
              href={`https://lichess.org/analysis/standard/${encodeURIComponent(
                fen.split(" ")[0]
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Analyze <i className="fa fa-up-right-from-square" aria-hidden />
            </a>
          </div>
        </section>

        <Sidebar backTo={`/learn/${key}`} backLabel="Back">
          {complete || !current ? (
            <>
              <div className="cb-page-head">
                <h1 className="cb-page-title">Session complete</h1>
                <p className="cb-page-sub">
                  {sessionCorrect} correct · {sessionWrong} missed
                  {accuracy != null ? ` · ${accuracy}% accuracy` : ""}
                </p>
              </div>
              <div className="cb-actions vertical">
                <button type="button" className="cb-btn primary wide" onClick={practiceAgain}>
                  <i className="fa fa-rotate-right" aria-hidden /> Practice again
                </button>
                <button
                  type="button"
                  className="cb-btn wide"
                  onClick={() => navigate(`/repertoire/${key}`)}
                >
                  <i className="fa fa-chess-board" aria-hidden /> Back to repertoire
                </button>
              </div>
              <Section title="Session">
                <div className="cb-stat-grid" style={{ padding: 0 }}>
                  <Stat value={sessionCorrect} label="Correct" />
                  <Stat value={sessionWrong} label="Missed" />
                  <Stat value={accuracy == null ? "—" : `${accuracy}%`} label="Accuracy" />
                </div>
              </Section>
              <EmptyState icon="fa-circle-check" title="You are caught up">
                Lines you miss will become due again in a few minutes. Correct lines return in three
                days, then thirty days once mastered.
              </EmptyState>
            </>
          ) : (
            <>
              <div className="cb-practice-head">
                <div>
                  <h1 className="cb-page-title">Practicing moves</h1>
                  <p className="cb-page-sub">Play the correct move on the board.</p>
                </div>
                <div className="cb-practice-score">
                  <span>
                    {remaining} Due <i className="fa fa-clock" aria-hidden />
                  </span>
                  <span>
                    {sessionCorrect} <i className="fa fa-circle-check" aria-hidden />
                  </span>
                  <span>
                    {sessionWrong} <i className="fa fa-circle-xmark" aria-hidden />
                  </span>
                </div>
              </div>

              <div className="cb-move-prompt">
                <span>
                  {nextNumber}
                  {nextSuffix}
                </span>
                <strong>{solved ? current.expectedSan : "__"}</strong>
              </div>

              <div className="cb-learn-options cb-practice-options">
                {!solved && (
                  <Row
                    title="I don't know, show me the answer"
                    onClick={reveal}
                    disabled={busy}
                  />
                )}
                {solved && (
                  <Row
                    title={nextLine ? "Next line" : "Finish session"}
                    right={<i className="fa fa-arrow-right" aria-hidden />}
                    onClick={advance}
                    className="cb-row-primary"
                  />
                )}
                <Row
                  title="View in build mode"
                  onClick={() => navigate(`/build/${key}?line=${current.id}`)}
                />
                <Row
                  title="Exit practice"
                  onClick={() => navigate(`/learn/${key}`)}
                />
              </div>
            </>
          )}

          {stats && (
            <div className="cb-practice-footer">
              <span>
                <ProgressRing value={stats.completion} size={12} /> {stats.completion}% complete
              </span>
              <span>{stats.mastery}% mastered</span>
            </div>
          )}
        </Sidebar>
      </main>
      <Confetti fire={Boolean(complete && sessionCorrect > 0)} />
    </div>
  );
}
