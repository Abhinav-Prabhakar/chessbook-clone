import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, pathQuery } from "../api";
import { BoardCaption, Crumbs, useBoard } from "../board/stage";
import type { Arrow, Mark } from "../board/Board";
import { moveFromUci, replay } from "../chess";
import { forget, useApi } from "../useApi";
import type { Daily, PracticeLine, PracticeSession, RepertoireSummary } from "../types";
import { Back, ErrorNote, Icon, PageHead, Row, Skeleton, relativeDue } from "../ui";
import { BoardStrip, MoveList } from "../ui/MoveList";
import { buildPath, learnPath, parsePath, repertoirePath } from "../routes";
import { useSettings } from "../settings";
import { playSound } from "../sounds";

type Pass = "learn" | "recall";
interface Item {
  line: PracticeLine;
  pass: Pass;
}

const MODE_TITLES: Record<string, string> = {
  due: "Practicing moves",
  new: "Learning new moves",
  difficult: "Practicing tricky moves",
  early: "Reviewing early",
  all: "Practicing every move",
  line: "Practicing this line",
};

/** Plies asked in a pass: the learn pass asks everything scheduled; the recall pass only new moves. */
function asks(item: Item, index: number) {
  const ply = item.line.plies[index];
  if (!ply?.ask) return false;
  return item.pass === "learn" ? true : ply.fresh;
}

function firstAsk(item: Item) {
  const i = item.line.plies.findIndex((_, k) => asks(item, k));
  return i < 0 ? item.line.plies.length : i;
}

export function PracticePage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const mode = params.get("mode") || "due";
  const linePath = parsePath(params.get("path"));
  const sessionUrl = `/practice/${id}/session?mode=${mode}${linePath.length ? `&path=${pathQuery(linePath)}` : ""}`;
  const summary = useApi<{ repertoire: RepertoireSummary }>(`/repertoires/${id}`);

  const [session, setSession] = useState<PracticeSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Item[]>([]);
  const [qi, setQi] = useState(0);
  const [pi, setPi] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [firstWrong, setFirstWrong] = useState<string | null>(null);
  const [hint, setHint] = useState(0);
  const [wrong, setWrong] = useState<{ fen: string; from: string; to: string; san: string } | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "good" | "bad" | "info"; text: string } | null>(null);
  const [stats, setStats] = useState({ correct: 0, wrong: 0, learned: 0 });
  const [daily, setDaily] = useState<Daily | null>(null);
  const reviewed = useRef(new Set<number>());
  const [finished, setFinished] = useState<Set<number>>(new Set());
  const wrongTimer = useRef<number | null>(null);

  // Load the session once.
  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setLoadError(null);
    api
      .get<PracticeSession>(sessionUrl)
      .then((s) => {
        if (cancelled) return;
        const items: Item[] = s.lines.map((line) => ({ line, pass: "learn" as Pass }));
        setSession(s);
        setQueue(items);
        setQi(0);
        setPi(items[0] ? firstAsk(items[0]) : 0);
        reviewed.current = new Set();
        setFinished(new Set());
        setStats({ correct: 0, wrong: 0, learned: 0 });
      })
      .catch((e) => !cancelled && setLoadError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [sessionUrl]);

  const item = queue[qi] || null;
  const done = Boolean(session) && qi >= queue.length;
  const ply = item && pi < item.line.plies.length ? item.line.plies[pi] : null;
  const asking = Boolean(item && ply && asks(item, pi));
  const teaching = asking && item!.pass === "learn" && ply!.fresh;
  const color = session?.color ?? summary.data?.repertoire.color ?? "white";

  const position = useMemo(() => (item ? replay(item.line.sans.slice(0, pi)) : null), [item, pi]);

  // Auto-play moves that are not being asked, then move on to the next line.
  useEffect(() => {
    if (!item || asking || wrong) return;
    if (pi >= item.line.plies.length) {
      const t = window.setTimeout(() => {
        const next = qi + 1;
        setQi(next);
        setPi(queue[next] ? firstAsk(queue[next]) : 0);
        setMistakes(0);
        setFirstWrong(null);
        setHint(0);
        setFeedback(null);
      }, 700);
      return () => window.clearTimeout(t);
    }
    const mineToMove = item.line.plies[pi].side === color;
    const delay = mineToMove ? 260 : settings.autoplayDelay;
    const t = window.setTimeout(() => {
      setPi((p) => p + 1);
      if (!mineToMove) setFeedback(null);
    }, Math.max(120, delay));
    return () => window.clearTimeout(t);
  }, [item, pi, asking, wrong, qi, queue, color, settings.autoplayDelay]);

  const record = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const result = await api.post<{ daily: Daily }>(`/practice/${id}/review`, {
          ...body,
          submissionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          tzOffset: new Date().getTimezoneOffset(),
        });
        setDaily(result.daily);
      } catch {
        // The answer still counts in this session; the server copy is best effort.
      }
    },
    [id]
  );

  const advance = () => {
    setPi((p) => p + 1);
    setMistakes(0);
    setFirstWrong(null);
    setHint(0);
  };

  const onMove = (move: { san: string; uci: string; from: string; to: string }) => {
    if (!item || !ply || !asking || wrong) return;
    const accepted = move.san === ply.san || ply.alternatives.includes(move.san);
    if (accepted) {
      const clean = mistakes === 0 && hint === 0;
      if (teaching) {
        if (ply.moveId) void record({ moveId: ply.moveId, correct: true, kind: "learn" });
        setStats((s) => ({ ...s, learned: s.learned + 1 }));
        // Ask it again, without help, at the end of the session.
        setQueue((q) => (q.some((x, k) => k > qi && x.line === item.line && x.pass === "recall") ? q : [...q, { line: item.line, pass: "recall" }]));
        setFeedback({ tone: "good", text: "Got it. You'll be asked this again at the end." });
      } else {
        if (ply.moveId) {
          const doneId = ply.moveId;
          setFinished((f) => new Set(f).add(doneId));
        }
        if (ply.moveId && !reviewed.current.has(ply.moveId)) {
          reviewed.current.add(ply.moveId);
          void record({ moveId: ply.moveId, correct: clean, played: firstWrong ?? move.san, hinted: hint > 0, kind: "review" });
          setStats((s) => ({ ...s, correct: s.correct + (clean ? 1 : 0), wrong: s.wrong + (clean ? 0 : 1) }));
        }
        setFeedback(
          move.san !== ply.san
            ? { tone: "good", text: `${move.san} is also in your repertoire. This line continues with ${ply.san}.` }
            : clean
              ? { tone: "good", text: "Correct" }
              : { tone: "info", text: "That's it." }
        );
        if (clean) playSound("correct");
      }
      advance();
      return;
    }
    if (teaching) {
      setFeedback({ tone: "info", text: `Play ${ply.san}, the move shown by the arrow.` });
      return;
    }
    // Wrong: show it briefly, then take it back.
    const shown = moveFromUci(ply.fen, move.uci);
    setMistakes((m) => m + 1);
    setFirstWrong((w) => w ?? move.san);
    if (shown) setWrong({ fen: shown.fen, from: move.from, to: move.to, san: move.san });
    playSound("wrong");
    setFeedback({ tone: "bad", text: `${move.san} isn't your move here. Try again.` });
    if (mistakes + 1 >= 2 && hint === 0) setHint(1);
    if (wrongTimer.current) window.clearTimeout(wrongTimer.current);
    wrongTimer.current = window.setTimeout(() => setWrong(null), 650);
  };

  useEffect(() => () => {
    if (wrongTimer.current) window.clearTimeout(wrongTimer.current);
  }, []);

  // Board.
  const arrows: Arrow[] = [];
  const marks: Mark[] = [];
  if (asking && ply && !wrong) {
    if (teaching || hint >= 2) arrows.push({ from: ply.from, to: ply.to, color: teaching ? "green" : "orange" });
    else if (hint === 1) marks.push({ square: ply.from, color: "hint" });
  }
  if (wrong) marks.push({ square: wrong.to, color: "bad" });
  const boardFen = wrong ? wrong.fen : position?.fen ?? replay([]).fen;
  const lastMove = wrong ? { from: wrong.from, to: wrong.to } : position?.lastMove ?? null;

  useBoard(
    session
      ? {
          fen: boardFen,
          orientation: color,
          lastMove,
          interactive: asking && !wrong,
          arrows,
          marks,
          peek: false,
          onMove,
        }
      : null
  );

  // Counter: distinct moves of yours still to finish in this session.
  const remaining = useMemo(() => {
    if (!session) return 0;
    const ids = new Set<number>();
    for (const line of session.lines) for (const p of line.plies) if (p.ask && p.moveId) ids.add(p.moveId);
    let n = 0;
    for (const id of ids) if (!finished.has(id)) n += 1;
    return n;
  }, [session, finished]);

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

  if (loadError) {
    return (
      <>
        {crumbs}
        <Back to={learnPath(id)} />
        <ErrorNote error={loadError} />
      </>
    );
  }
  if (!session) {
    return (
      <>
        {crumbs}
        <Back to={learnPath(id)} />
        <Skeleton rows={5} />
      </>
    );
  }

  if (session.lines.length === 0) {
    return (
      <>
        {crumbs}
        <Back to={learnPath(id)} />
        <PageHead title="Nothing to practice" sub={mode === "due" ? "No moves are due right now." : "There are no moves for this kind of practice."} />
        <div className="rows actions">
          <Row title="Back to practice options" to={learnPath(id)} chevron />
          <Row title="Continue building" to={buildPath(id)} chevron />
        </div>
      </>
    );
  }

  if (done) {
    return (
      <>
        {crumbs}
        <BoardCaption>
          <BoardStrip title="Session complete" />
        </BoardCaption>
        <Back to={learnPath(id)} />
        <SessionDone
          id={id}
          stats={stats}
          daily={daily}
          onAgain={() => navigate(0)}
          onExit={() => {
            forget(`/repertoires/${id}`);
            forget(`/practice/${id}`);
            forget("/dashboard");
            navigate(repertoirePath(id));
          }}
        />
      </>
    );
  }

  const sansShown = item ? item.line.sans.slice(0, pi) : [];
  const askLabel = ply ? `${Math.floor(pi / 2) + 1}${pi % 2 === 0 ? "." : "…"}` : "";

  return (
    <>
      {crumbs}
      <BoardCaption>
        <BoardStrip title={item?.line.opening?.name} fen={boardFen} orientation={color}>
          <MoveList sans={sansShown} pending={asking ? "＿" : null} />
        </BoardStrip>
      </BoardCaption>
      <Back to={learnPath(id)} />
      <PageHead
        title={MODE_TITLES[mode] || "Practicing moves"}
        right={
          <span className="counters">
            <span className="counter due">
              {remaining} <Icon name="clock" />
            </span>
            <span className="counter good">
              {stats.correct} <Icon name="check" />
            </span>
            <span className="counter bad">
              {stats.wrong} <Icon name="x" />
            </span>
          </span>
        }
        sub={
          teaching
            ? `New move: play ${ply!.san}, shown by the arrow.`
            : asking
              ? "Play the correct move on the board."
              : item?.pass === "recall" && pi === 0
                ? "Now from memory."
                : " "
        }
      />
      <div className="prompt">
        <div className="prompt-line">
          <span className={`prompt-move${asking ? "" : " dim"}`}>
            {asking
              ? `${askLabel} ${teaching ? ply!.san : "＿"}`
              : pi > 0 && item
                ? `${Math.floor((pi - 1) / 2) + 1}${(pi - 1) % 2 === 0 ? "." : "…"} ${item.line.sans[pi - 1]}`
                : "\u00a0"}
          </span>
          {teaching && <span className="tag new">New</span>}
          {asking && !teaching && item?.pass === "recall" && <span className="tag">From memory</span>}
        </div>
        <p className="prompt-note">{asking && (teaching || hint > 0) && ply?.note ? ply.note : "\u00a0"}</p>
        {feedback && <p className={`feedback ${feedback.tone}`}>{feedback.text}</p>}
      </div>

      <div className="rows actions">
        {asking && !teaching && hint < 2 && (
          <Row
            title={hint === 0 ? "I don't know, give me a hint" : "Show me the move"}
            onClick={() => setHint((h) => h + 1)}
          />
        )}
        <Row title="View in build mode" to={buildPath(id, item ? item.line.sans.slice(0, pi) : [])} />
        <Row title="Exit practice" onClick={() => {
          forget(`/practice/${id}`);
          forget(`/repertoires/${id}`);
          forget("/dashboard");
          navigate(learnPath(id));
        }} />
      </div>
    </>
  );
}

function SessionDone({
  id,
  stats,
  daily,
  onAgain,
  onExit,
}: {
  id: string;
  stats: { correct: number; wrong: number; learned: number };
  daily: Daily | null;
  onAgain: () => void;
  onExit: () => void;
}) {
  const { data } = useApi<{ counts: { due: number; fresh: number; nextDue: string | null } }>(`/practice/${id}?after=${stats.correct + stats.wrong + stats.learned}`);
  const total = stats.correct + stats.wrong;
  return (
    <>
      <PageHead title="Session complete" sub={total ? `${Math.round((stats.correct / total) * 100)}% correct on the first try.` : "Nice work."} />
      <div className="summary-grid">
        <div className="summary-cell">
          <strong>{stats.learned}</strong>
          <span>new moves learned</span>
        </div>
        <div className="summary-cell">
          <strong className="good-text">{stats.correct}</strong>
          <span>correct</span>
        </div>
        <div className="summary-cell">
          <strong className="bad-text">{stats.wrong}</strong>
          <span>to review again soon</span>
        </div>
      </div>
      {daily && (
        <p className="context-line">
          {Math.min(daily.reviewed, daily.goal)} of {daily.goal} moves today
          {daily.streak > 0 ? ` · ${daily.streak} day streak` : ""}.
          {data?.counts.nextDue && data.counts.due === 0 ? ` Next review ${relativeDue(data.counts.nextDue)}.` : ""}
        </p>
      )}
      <div className="rows actions">
        {data && data.counts.due + data.counts.fresh > 0 && (
          <Row variant="accent" title="Keep going" meta={`${data.counts.due} due · ${data.counts.fresh} new`} onClick={onAgain} chevron />
        )}
        <Row title="Continue building" to={buildPath(id)} chevron />
        <Row title="Done" onClick={onExit} />
      </div>
    </>
  );
}
