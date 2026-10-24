import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Crumbs, START_FEN, useBoard } from "../board/stage";
import { moveFromUci, replay } from "../chess";
import { useApi } from "../useApi";
import type { PracticeSession, RepertoireSummary } from "../types";
import { Back, Empty, PageHead, Row, Section, Skeleton, moveLabel } from "../ui";
import { playSound } from "../sounds";

interface Task {
  sans: string[]; // full line
  shown: number; // plies played on the board
  hidden: number; // plies listed as text only
  answer: string; // your move after the hidden plies
  alternatives: string[];
}

function pickTask(sessions: PracticeSession[], hidden: number, color: "white" | "black"): Task | null {
  const candidates: Task[] = [];
  for (const s of sessions) {
    for (const line of s.lines) {
      line.plies.forEach((p, i) => {
        if (p.side !== color || i < hidden) return;
        const shown = i - hidden;
        candidates.push({ sans: line.sans, shown, hidden, answer: p.san, alternatives: p.alternatives });
      });
    }
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function VisualizationPage() {
  const reps = useApi<{ repertoires: RepertoireSummary[] }>("/repertoires");
  const started = (reps.data?.repertoires || []).filter((r) => r.stats.mine > 0);
  const [repId, setRepId] = useState<number | null>(null);
  const [hidden, setHidden] = useState(2);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [state, setState] = useState<"asking" | "right" | "wrong">("asking");
  const [score, setScore] = useState({ right: 0, wrong: 0 });

  useEffect(() => {
    if (repId == null && started.length) setRepId(started[0].id);
  }, [started, repId]);

  useEffect(() => {
    if (repId == null) return;
    api.get<PracticeSession>(`/practice/${repId}/session?mode=all`).then(setSession).catch(() => setSession(null));
  }, [repId]);

  const color = session?.color ?? "white";
  const next = () => {
    if (!session) return;
    setTask(pickTask([session], hidden, color));
    setState("asking");
  };
  useEffect(next, [session, hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = useMemo(() => (task ? replay(task.sans.slice(0, task.shown)) : replay([])), [task]);
  const after = useMemo(() => (task ? replay(task.sans.slice(0, task.shown + task.hidden)) : null), [task]);
  const solved = state !== "asking" && task ? replay(task.sans.slice(0, task.shown + task.hidden + 1)) : null;

  const onMove = (move: { uci: string }) => {
    if (!task || !after || state !== "asking") return;
    // The move is played on the *imagined* position after the hidden moves.
    const played = moveFromUci(after.fen, move.uci);
    const ok = played && (played.san === task.answer || task.alternatives.includes(played.san));
    setState(ok ? "right" : "wrong");
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), wrong: s.wrong + (ok ? 0 : 1) }));
    playSound(ok ? "correct" : "wrong");
  };

  useBoard({
    fen: solved?.fen ?? base.fen ?? START_FEN,
    lastMove: solved?.lastMove ?? base.lastMove,
    orientation: color,
    interactive: Boolean(task) && state === "asking",
    peek: false,
    onMove,
  });

  if (!reps.data) return <Skeleton rows={4} />;
  if (!started.length) {
    return (
      <>
        <Back to="/" />
        <PageHead title="Visualization" />
        <Empty title="Add some moves first">This drill uses the lines in your repertoires.</Empty>
      </>
    );
  }

  return (
    <>
      <Crumbs items={[{ label: "Visualization" }]} />
      <Back to="/" />
      <PageHead
        title="Visualization"
        sub="The board stops a few moves early. Picture the moves listed below, then play your next move as if they had been played."
      />
      <div className="segmented small pad-x">
        {started.map((r) => (
          <button key={r.id} type="button" className={repId === r.id ? "selected" : ""} onClick={() => setRepId(r.id)}>
            {r.name}
          </button>
        ))}
      </div>
      <Section title="Hidden moves">
        <div className="chips pad-x">
          {[1, 2, 3, 4, 6].map((n) => (
            <button key={n} type="button" className={`chip${n === hidden ? " selected" : ""}`} onClick={() => setHidden(n)}>
              {n}
            </button>
          ))}
        </div>
      </Section>
      {task ? (
        <div className="prompt">
          <p className="prompt-note">Then:</p>
          <div className="prompt-line mono">
            {task.sans.slice(task.shown, task.shown + task.hidden).map((san, i) => (
              <span key={i} className="vis-move">
                {moveLabel(task.shown + i, san)}
              </span>
            ))}
            <span className="vis-move pending">{moveLabel(task.shown + task.hidden, "?")}</span>
          </div>
          {state === "right" && <p className="feedback good">Correct: {task.answer}.</p>}
          {state === "wrong" && <p className="feedback bad">Your move here is {task.answer}.</p>}
          <p className="score-line">
            <span className="good-text">{score.right} right</span>
            <span className="bad-text">{score.wrong} wrong</span>
          </p>
        </div>
      ) : session ? (
        <Empty title="No lines long enough">Add longer lines, or pick fewer hidden moves.</Empty>
      ) : (
        <Skeleton rows={2} />
      )}
      <div className="rows actions">{task && state !== "asking" && <Row variant="accent" title="Next" onClick={next} chevron />}</div>
    </>
  );
}
