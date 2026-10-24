/**
 * Practice, following production Chessbook's flow (docs/learning-flow-parity.md).
 *
 * The session is a queue of quiz groups (positions where you have saved
 * moves). For each group the board plays the line from the start, then you
 * play every saved move. New moves ("first practice") are shown with arrows;
 * after the line ends they come back once without help. Moves outside your
 * repertoire are judged by the engine: a good move is an alternative, a real
 * mistake is refuted on the board. Results are reported once per group.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, pathQuery } from "../api";
import { BoardCaption, Crumbs, useBoard } from "../board/stage";
import type { Arrow, FeedbackKind, SquareFeedback } from "../board/Board";
import { moveFromUci, replay } from "../chess";
import { forget, useApi } from "../useApi";
import type { Daily, QuizGroup, PracticeSession, RepertoireSummary, Settings } from "../types";
import { Back, ErrorNote, Icon, PageHead, Progress, Row, Skeleton, moveLabel, relativeDue } from "../ui";
import { BoardStrip, MoveList } from "../ui/MoveList";
import { buildPath, learnPath, parsePath, repertoirePath } from "../routes";
import { useSettings } from "../settings";
import { playSound } from "../sounds";

const START = 0;
const HINTS = 1;
const ARROWS = 2;
const FULL = 3;
const MAX_WRONG = 3;
const PLY_MS = 280;

interface Stats {
  correct: number;
  incorrect: number;
  practiced: number;
}

interface State {
  status: "loading" | "error" | "active" | "done";
  error: string | null;
  session: PracticeSession | null;
  queue: QuizGroup[];
  current: QuizGroup | null;
  previous: QuizGroup | null;
  viewingPrevious: boolean;
  stage: number;
  completed: string[];
  failed: string[];
  firstWrong: string | null;
  wrongGuesses: number;
  stats: Stats;
  seenEpds: string[];
  // Board
  shownLine: string[];
  targetLine: string[];
  override: { fen: string; lastMove: { from: string; to: string } } | null;
  feedback: SquareFeedback | null;
  busy: boolean;
  confirmSkip: boolean;
  daily: Daily | null;
}

const storageKey = (id: string) => `cb_practice_${id}`;

export function savedSession(id: string): { filter: string } | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const sameLine = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const isPrefix = (a: string[], b: string[]) => a.length <= b.length && a.every((x, i) => x === b[i]);

/** In "complete lines" styles, the positions before a group (from where the line split off) are asked too. */
function expand(prev: QuizGroup | null, group: QuizGroup, style: Settings["reviewStyle"]): QuizGroup[] {
  if (style === "selective" || !group.preceding?.length) return [group];
  if (!prev) return [...group.preceding, group];
  const prevEnd = [...prev.line, prev.moves[0]?.san].filter(Boolean) as string[];
  if (sameLine(prevEnd, group.line.slice(0, -1))) return [group];
  let common = 0;
  while (common < prevEnd.length && common < group.line.length && prevEnd[common] === group.line[common]) common += 1;
  return [...group.preceding.filter((p) => p.line.length >= common), group];
}

export function PracticePage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { settings, update } = useSettings();
  const filter = params.get("filter") || params.get("mode") || "due";
  const resume = params.get("resume") === "1";
  const linePath = parsePath(params.get("path"));
  const summary = useApi<{ repertoire: RepertoireSummary }>(`/repertoires/${id}`);

  const st = useRef<State>({
    status: "loading",
    error: null,
    session: null,
    queue: [],
    current: null,
    previous: null,
    viewingPrevious: false,
    stage: START,
    completed: [],
    failed: [],
    firstWrong: null,
    wrongGuesses: 0,
    stats: { correct: 0, incorrect: 0, practiced: 0 },
    seenEpds: [],
    shownLine: [],
    targetLine: [],
    override: null,
    feedback: null,
    busy: false,
    confirmSkip: false,
    daily: null,
  });
  const [, render] = useReducer((n: number) => n + 1, 0);
  const timers = useRef<number[]>([]);
  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const S = st.current;

  /* --------------------------------------------------------- persistence --- */

  const persist = useCallback(() => {
    const s = st.current;
    try {
      if (s.status === "active" && s.session) {
        const queue = s.current && !s.viewingPrevious ? [s.current, ...s.queue] : s.queue;
        localStorage.setItem(
          storageKey(id),
          JSON.stringify({ filter: s.session.filter, session: { ...s.session, groups: [] }, queue, stats: s.stats, seenEpds: s.seenEpds })
        );
      } else if (s.status === "done") {
        localStorage.removeItem(storageKey(id));
      }
    } catch {
      // Resume is a convenience.
    }
  }, [id]);

  /* ---------------------------------------------------------- group flow --- */

  const setupGroup = useCallback((group: QuizGroup | null) => {
    const s = st.current;
    s.current = group;
    s.stage = START;
    s.completed = [];
    s.failed = [];
    s.firstWrong = null;
    s.wrongGuesses = 0;
    s.feedback = null;
    s.override = null;
    s.confirmSkip = false;
    if (group) {
      s.targetLine = group.line;
      if (group.synthetic && settings.reviewStyle === "once") s.seenEpds.push(group.epd);
    }
  }, [settings.reviewStyle]);

  const report = async (group: QuizGroup, failed: string[], firstWrong: string | null) => {
    if (group.retry || group.synthetic) return;
    try {
      const result = await api.post<{ daily: Daily }>(`/practice/${id}/reviews`, {
        submissionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        daily: st.current.session?.filter === "daily",
        tzOffset: new Date().getTimezoneOffset(),
        results: group.moves.map((m) => ({
          moveId: m.moveId,
          correct: !failed.includes(m.san),
          played: failed.includes(m.san) ? firstWrong : m.san,
        })),
      });
      st.current.daily = result.daily;
    } catch {
      // The session continues even if the write fails.
    }
  };

  const finish = () => {
    const s = st.current;
    s.status = "done";
    s.current = null;
    persist();
    forget(`/repertoires/${id}`);
    forget(`/practice/${id}`);
    forget("/dashboard");
    render();
  };

  const nextGroup = useCallback(() => {
    const s = st.current;
    const style = s.session?.style ?? "selective";
    const group = s.current;
    if (group && s.viewingPrevious) {
      // Coming back from looking at the previous position: nothing to score.
      s.viewingPrevious = false;
    } else if (group) {
      const hasLearning = group.moves.some((m) => m.learning);
      if (s.failed.length || hasLearning) {
        const retry: QuizGroup = { ...group, retry: true, preceding: [], moves: group.moves.map((m) => ({ ...m, learning: false })) };
        if (hasLearning) {
          // Comes back once the current line ends (where the walk steps back up the tree).
          let at = s.queue.findIndex((g, i) => {
            const before = i === 0 ? group : s.queue[i - 1];
            return !g.retry && !g.synthetic && g.line.length < before.line.length;
          });
          if (at === -1) s.queue.push(retry);
          else {
            while (at < s.queue.length && s.queue[at].retry) at += 1;
            s.queue.splice(at, 0, retry);
          }
        } else {
          const last = s.queue[s.queue.length - 1] ?? group;
          s.queue.push(...expand(last, retry, style));
        }
      }
      if (!group.retry && !group.synthetic) s.stats.practiced += group.moves.length;
      void report(group, s.failed, s.firstWrong);
      s.previous = group;
    }
    // "Once per session": don't ask a line position twice.
    while (s.queue[0]?.synthetic && style === "once" && s.seenEpds.includes(s.queue[0].epd)) s.queue.shift();
    const next = s.queue.shift() ?? null;
    if (!next) {
      finish();
      return;
    }
    setupGroup(next);
    persist();
    render();
  }, [setupGroup, persist]);

  /* ---------------------------------------------------------------- load --- */

  useEffect(() => {
    let cancelled = false;
    const s = st.current;
    const start = (session: PracticeSession, queue: QuizGroup[], stats?: Stats, seen?: string[]) => {
      s.session = session;
      s.queue = queue;
      s.stats = stats ?? { correct: 0, incorrect: 0, practiced: 0 };
      s.seenEpds = seen ?? [];
      s.status = "active";
      const first = s.queue.shift() ?? null;
      if (!first) {
        s.status = "done";
        s.session = { ...session, groups: [] };
        render();
        return;
      }
      setupGroup(first);
      persist();
      render();
    };
    if (resume) {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey(id)) || "null");
        if (saved?.queue?.length) {
          start(saved.session, saved.queue, saved.stats, saved.seenEpds);
          return;
        }
      } catch {
        // fall through to a fresh session
      }
    }
    api
      .get<PracticeSession>(`/practice/${id}/session?filter=${filter}${linePath.length ? `&path=${pathQuery(linePath)}` : ""}`)
      .then((session) => {
        if (cancelled) return;
        if (!session.groups.length) {
          s.session = session;
          s.status = "done";
          render();
          return;
        }
        const queue: QuizGroup[] = [];
        session.groups.forEach((g, i) => queue.push(...expand(i ? session.groups[i - 1] : null, g, session.style)));
        start(session, queue);
      })
      .catch((e) => {
        if (cancelled) return;
        s.status = "error";
        s.error = (e as Error).message;
        render();
      });
    return () => {
      cancelled = true;
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, filter, resume, params.get("path")]);

  /* ------------------------------------------------------- line playback --- */

  useEffect(() => {
    const s = st.current;
    if (s.override) return;
    const { shownLine, targetLine } = s;
    if (sameLine(shownLine, targetLine)) return;
    if (!isPrefix(shownLine, targetLine)) {
      // Jump back to where the lines split, then play forward.
      let common = 0;
      while (common < shownLine.length && common < targetLine.length && shownLine[common] === targetLine[common]) common += 1;
      const t = window.setTimeout(() => {
        s.shownLine = targetLine.slice(0, common);
        render();
      }, 120);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      s.shownLine = targetLine.slice(0, shownLine.length + 1);
      render();
    }, PLY_MS);
    return () => window.clearTimeout(t);
  });

  const group = S.current;
  const playing = Boolean(group) && !sameLine(S.shownLine, S.targetLine);
  const learningGroup = Boolean(group?.moves.some((m) => m.learning));
  const hasNotes = Boolean(group?.moves.some((m) => m.note));
  const remainingMoves = group ? group.moves.filter((m) => !S.completed.includes(m.san)) : [];

  /* --------------------------------------------------------------- moves --- */

  const markFailed = () => {
    const s = st.current;
    if (!s.failed.length) s.stats.incorrect += 1;
    for (const m of remainingMoves) if (!s.failed.includes(m.san)) s.failed.push(m.san);
  };

  const onMove = async (move: { san: string; uci: string; from: string; to: string }) => {
    const s = st.current;
    const g = s.current;
    if (!g || playing || s.stage === FULL || s.busy || s.override) return;
    const hit = g.moves.find((m) => m.san === move.san);
    if (hit && !s.completed.includes(hit.san)) {
      if (!hit.learning) s.stats.correct += 1;
      s.completed.push(hit.san);
      s.shownLine = [...g.line, hit.san];
      s.targetLine = s.shownLine;
      s.feedback = { square: move.to, kind: "correct" };
      if (!hit.learning && !s.failed.length) playSound("correct");
      const remaining = g.moves.filter((m) => !s.completed.includes(m.san));
      const pause = s.session?.pause ?? "never";
      const shouldPause =
        pause === "always" || (pause === "when-annotation" && hasNotes) || (pause === "when-wrong" && s.wrongGuesses > 0);
      render();
      later(550, () => {
        s.feedback = null;
        if (remaining.length) {
          // More saved moves here: step back and ask for the next one.
          s.shownLine = g.line;
          s.targetLine = g.line;
          render();
        } else if (shouldPause) {
          s.stage = FULL;
          render();
        } else {
          nextGroup();
        }
      });
      return;
    }
    if (hit) return;

    // Not in the repertoire: let the engine judge it.
    const played = moveFromUci(g.fen, move.uci);
    if (!played) return;
    s.busy = true;
    s.firstWrong = s.firstWrong ?? move.san;
    s.override = { fen: played.fen, lastMove: { from: move.from, to: move.to } };
    s.feedback = { square: move.to, kind: "thinking" };
    render();
    let kind: FeedbackKind = "mistake";
    let refutation: { from: string; to: string; uci: string } | null = null;
    try {
      const verdict = await api.post<{ classification: string; refutation: { from: string; to: string; uci: string } | null }>(
        "/practice/judge",
        { fen: g.fen, uci: move.uci }
      );
      kind = verdict.classification === "good" ? "alternative" : (verdict.classification as FeedbackKind);
      refutation = verdict.refutation;
    } catch {
      kind = "mistake";
    }
    if (st.current.current !== g) return;
    const alternative = kind === "alternative" || kind === "inaccuracy";
    s.feedback = { square: move.to, kind: alternative ? "alternative" : kind };
    // An alternative is only forgiven when your line ends here.
    const lineEnds = g.moves.every((m) => m.leaf);
    if (!alternative || !lineEnds) {
      markFailed();
      s.wrongGuesses += 1;
    }
    playSound(alternative ? "notify" : "wrong");
    render();

    const takeBack = () => {
      s.feedback = null;
      s.override = null;
      s.busy = false;
      if (s.wrongGuesses >= MAX_WRONG && s.stage < ARROWS) s.stage = ARROWS;
      render();
    };
    if (!alternative && refutation) {
      later(500, () => {
        const reply = moveFromUci(played.fen, refutation!.uci);
        if (reply) {
          s.feedback = { square: move.to, kind };
          s.override = { fen: reply.fen, lastMove: { from: reply.from, to: reply.to } };
          render();
        }
        later(1100, takeBack);
      });
    } else {
      later(1100, takeBack);
    }
  };

  const giveUp = () => {
    const s = st.current;
    s.stage = hasNotes && s.stage !== HINTS ? HINTS : ARROWS;
    markFailed();
    render();
  };

  const backToPrevious = () => {
    const s = st.current;
    if (!s.previous || !s.current || s.viewingPrevious) return;
    s.queue.unshift(s.current);
    const prev = s.previous;
    s.current = prev;
    s.viewingPrevious = true;
    s.stage = FULL;
    s.completed = prev.moves.map((m) => m.san);
    s.failed = [];
    s.feedback = null;
    s.override = null;
    s.targetLine = [...prev.line, prev.moves[0].san];
    render();
  };

  const skipFirstPractice = async () => {
    const s = st.current;
    const clear = (g: QuizGroup) => ({ ...g, moves: g.moves.map((m) => ({ ...m, learning: false })) });
    s.queue = s.queue.map(clear);
    if (s.current) s.current = clear(s.current);
    s.confirmSkip = false;
    render();
    try {
      await update({ skipFirstPractice: true });
    } catch {
      // The session already continues without first practice.
    }
  };

  const exit = () => {
    persist();
    forget(`/practice/${id}`);
    forget(`/repertoires/${id}`);
    forget("/dashboard");
    navigate(learnPath(id));
  };

  /* --------------------------------------------------------------- board --- */

  const arrows: Arrow[] = [];
  if (group && !playing && !S.override && (S.stage === ARROWS || learningGroup || S.viewingPrevious) && S.stage !== FULL) {
    for (const m of group.moves) {
      arrows.push({ from: m.from, to: m.to, color: S.completed.includes(m.san) ? "gray" : learningGroup ? "green" : "orange" });
    }
  }
  const shown = replay(S.shownLine);
  const color = S.session?.color ?? summary.data?.repertoire.color ?? "white";
  const atPosition = group && sameLine(S.shownLine, group.line);
  useBoard(
    S.status === "active" || S.status === "done"
      ? {
          fen: S.override?.fen ?? shown.fen,
          lastMove: S.override?.lastMove ?? shown.lastMove,
          orientation: color,
          interactive: S.status === "active" && Boolean(atPosition) && !playing && !S.busy && S.stage !== FULL,
          arrows,
          feedback: S.feedback,
          peek: false,
          onMove: (m) => void onMove(m),
        }
      : null
  );

  /* -------------------------------------------------------------- render --- */

  const repName = summary.data?.repertoire.name ?? "Repertoire";
  const crumbs = (
    <Crumbs
      items={[
        { label: repName, to: repertoirePath(id) },
        { label: "Learn", to: learnPath(id) },
        { label: "Practice" },
      ]}
    />
  );

  if (S.status === "error") {
    return (
      <>
        {crumbs}
        <Back to={learnPath(id)} />
        <ErrorNote error={S.error || "Couldn't start practice"} />
      </>
    );
  }
  if (S.status === "loading") {
    return (
      <>
        {crumbs}
        <Back to={learnPath(id)} />
        <Skeleton rows={5} />
      </>
    );
  }
  if (S.status === "done") {
    return (
      <>
        {crumbs}
        <BoardCaption>
          <BoardStrip title={group?.opening?.name ?? ""} />
        </BoardCaption>
        <Back to={learnPath(id)} />
        <SessionComplete id={id} filter={S.session?.filter ?? filter} stats={S.stats} daily={S.daily} empty={!S.stats.practiced} />
      </>
    );
  }

  const g = group!;
  const due = (() => {
    let n = 0;
    const count = (x: QuizGroup) => (x.retry || x.synthetic ? 0 : x.moves.length);
    for (const x of S.queue) n += count(x);
    if (!S.viewingPrevious && !g.retry && !g.synthetic) n += remainingMoves.length;
    return n;
  })();

  let prompt: string;
  if (S.stage === FULL) prompt = g.moves.length > 1 ? "You have multiple saved moves for this position." : "This is your saved move.";
  else if (learningGroup && g.moves.length > 1) prompt = `You have ${g.moves.length} saved moves for this position. Play them all on the board.`;
  else if (g.moves.length > 1 && S.completed.length > 0) prompt = "You have another response. Play it on the board.";
  else if (g.line.length === 0) prompt = "Play your first move on the board.";
  else prompt = "Play the correct move on the board.";

  if (S.confirmSkip) {
    return (
      <>
        {crumbs}
        <Back onClick={() => ((S.confirmSkip = false), render())} />
        <PageHead title="Skip first practice?" />
        <div className="game-text tight">
          <p>This will skip the first practice mode for all moves.</p>
        </div>
        <div className="rows list">
          <Row variant="accent" title="Yes, skip first practice" onClick={() => void skipFirstPractice()} />
          <Row title="Cancel" onClick={() => ((S.confirmSkip = false), render())} />
        </div>
      </>
    );
  }

  // The moves table: the move number, then each saved move once it's revealed.
  const rows = g.moves
    .filter((m, i) => S.completed.includes(m.san) || m.learning || S.stage >= ARROWS || i === g.moves.findIndex((x) => !S.completed.includes(x.san)))
    .map((m) => {
      const revealed = S.completed.includes(m.san) || m.learning || S.stage >= ARROWS;
      const noteVisible = m.learning || S.completed.includes(m.san) || S.stage >= HINTS;
      return { m, revealed, noteVisible };
    });

  return (
    <>
      {crumbs}
      <BoardCaption>
        <BoardStrip title={g.opening?.name} fen={shown.fen} orientation={color}>
          <MoveList sans={S.shownLine} pending={atPosition && S.stage !== FULL && !playing ? "＿" : null} />
        </BoardStrip>
      </BoardCaption>
      <Back to={learnPath(id)} />
      {S.previous && !S.viewingPrevious && (
        <button type="button" className="text-action prev-link" onClick={backToPrevious}>
          <Icon name="chevron-left" /> Previous position
        </button>
      )}
      <PageHead
        title="Practicing moves"
        right={
          <span className="counters">
            <span className="counter">
              {due} Due <span className="badge orange"><Icon name="clock" /></span>
            </span>
            <span className="counter">
              {S.stats.correct} <span className="badge green"><Icon name="check" /></span>
            </span>
            <span className="counter">
              {S.stats.incorrect} <span className="badge red"><Icon name="x" /></span>
            </span>
          </span>
        }
        sub={prompt}
      />
      <div className="quiz-table">
        {rows.map(({ m, revealed, noteVisible }) => (
          <div className="quiz-row" key={m.san}>
            <span className="quiz-move">{revealed ? moveLabel(g.line.length, m.san) : `${moveLabel(g.line.length, "").trim()} ＿`}</span>
            <span className={`quiz-note${noteVisible ? "" : " hidden"}`}>{m.note || "No notes added"}</span>
          </div>
        ))}
      </div>

      <div className="rows list spaced-sm">
        {S.stage === FULL ? (
          <Row variant="accent" title="Got it, continue practicing" onClick={nextGroup} />
        ) : (
          !learningGroup &&
          S.stage !== ARROWS && (
            <Row
              variant="accent"
              title={hasNotes && S.stage < HINTS ? "I don't know, give me a hint" : "I don't know, show me the answer"}
              onClick={giveUp}
              disabled={playing || S.busy}
            />
          )
        )}
        {learningGroup && S.stage !== FULL && <Row title="Skip first practice" onClick={() => ((S.confirmSkip = true), render())} />}
        <Row title="View in build mode" to={buildPath(id, g.line)} />
        <Row title="Exit practice" onClick={exit} />
      </div>
    </>
  );
}

/* --------------------------------------------------------- end of session --- */

function SessionComplete({
  id,
  filter,
  stats,
  daily,
  empty,
}: {
  id: string;
  filter: string;
  stats: Stats;
  daily: Daily | null;
  empty: boolean;
}) {
  const navigate = useNavigate();
  const { data } = useApi<{ repertoire: RepertoireSummary; counts: { due: number; nextDue: string | null } }>(`/practice/${id}?done=1`);
  if (empty) {
    return (
      <>
        <PageHead title="Nothing to practice" sub="No moves match this kind of practice right now." />
        <div className="rows list spaced-sm">
          <Row title="Back to practice options" to={learnPath(id)} />
          <Row title="Continue building" to={buildPath(id)} />
        </div>
      </>
    );
  }
  const perfect = stats.incorrect === 0 && stats.correct > 0;
  const header =
    filter === "daily" ? "Daily practice complete!" : filter === "due" && data?.counts.due === 0 ? "Review complete!" : perfect ? "Perfect practice!" : "Practice complete!";
  const bullets: React.ReactNode[] = [
    <>
      You practiced <strong className="highlight">{stats.practiced} move{stats.practiced === 1 ? "" : "s"}</strong>
    </>,
    perfect ? (
      <>
        You got <strong className="highlight">all</strong> of your moves right
      </>
    ) : (
      <>
        You played the correct move <strong className="highlight">{stats.correct} time{stats.correct === 1 ? "" : "s"}</strong>
      </>
    ),
  ];
  if (filter === "daily" && daily && daily.streak > 0) {
    bullets.push(
      <>
        You now have a <strong className="highlight">{daily.streak} day streak</strong>
      </>
    );
  } else if (data && data.counts.due > 0) {
    bullets.push(
      <>
        You have <strong className="highlight">{data.counts.due} move{data.counts.due === 1 ? "" : "s"}</strong> due for review now
      </>
    );
  } else if (data?.counts.nextDue) {
    bullets.push(
      <>
        Your next practice will be due <strong className="highlight">{relativeDue(data.counts.nextDue)}</strong>
      </>
    );
  }
  const mastery = data?.repertoire.stats.masteredPercent ?? 0;
  return (
    <>
      <PageHead title={header} />
      <div className="stat-block tight">
        <div className="stat-line">
          <strong>{mastery.toFixed(1)}% mastered</strong>
        </div>
        <Progress value={mastery} tone="orange" />
      </div>
      <div className="game-text">
        <p className="lead">Your stats from {filter === "daily" ? "today" : "this session"}:</p>
        <ul className="stat-bullets">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>
      <div className="rows list">
        {data && data.counts.due > 0 && (
          <Row variant="accent" title="Continue practicing" onClick={() => navigate(`/repertoires/${id}/practice?filter=due&t=${Date.now()}`)} />
        )}
        <Row title="Continue building" to={buildPath(id)} />
        <Row title="Done" to={repertoirePath(id)} />
      </div>
    </>
  );
}
