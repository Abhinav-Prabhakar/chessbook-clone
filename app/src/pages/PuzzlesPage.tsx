import { useCallback, useEffect, useState } from "react";
import { Chess } from "chess.js";
import { api } from "../api";
import { BoardCaption, Crumbs, useBoard } from "../board/stage";
import type { Arrow, Mark } from "../board/Board";
import { useApi } from "../useApi";
import { Back, ErrorNote, Icon, PageHead, Row, Section, Skeleton } from "../ui";
import { BoardStrip } from "../ui/MoveList";
import { playSound } from "../sounds";
import type { Color } from "../types";

interface Puzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
  opening: string | null;
  family: string | null;
}

interface Stats {
  rating: number;
  attempts: number;
  solved: number;
  streak: number;
  total: number;
  recent: { id: string; correct: boolean; rating: number; opening: string; at: string }[];
}

type Status = "loading" | "intro" | "solving" | "solved" | "failed";

const THEME_NAMES: Record<string, string> = {
  fork: "Fork",
  pin: "Pin",
  skewer: "Skewer",
  mateIn1: "Mate in 1",
  mateIn2: "Mate in 2",
  mateIn3: "Mate in 3",
  hangingPiece: "Hanging piece",
  discoveredAttack: "Discovered attack",
  trappedPiece: "Trapped piece",
  sacrifice: "Sacrifice",
  attraction: "Attraction",
  deflection: "Deflection",
  doubleCheck: "Double check",
  kingsideAttack: "Kingside attack",
  advantage: "Win material",
  crushing: "Decisive",
};

function apply(fen: string, uci: string) {
  const chess = new Chess(fen);
  const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
  return { fen: chess.fen(), san: m.san, from: m.from, to: m.to, mate: chess.isCheckmate() };
}

export function PuzzlesPage() {
  const [scope, setScope] = useState<"repertoire" | "all">("repertoire");
  const stats = useApi<Stats>("/puzzles/stats");
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [matched, setMatched] = useState<string>("all");
  const [status, setStatus] = useState<Status>("loading");
  const [step, setStep] = useState(0); // index into puzzle.moves already played
  const [fen, setFen] = useState<string>("");
  const [last, setLast] = useState<{ from: string; to: string } | null>(null);
  const [sans, setSans] = useState<string[]>([]);
  const [wrong, setWrong] = useState<{ from: string; to: string } | null>(null);
  const [change, setChange] = useState<number | null>(null);
  const [hint, setHint] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setChange(null);
    setHint(false);
    try {
      const data = await api.get<{ puzzle: Puzzle | null; matched: string }>(`/puzzles/next?scope=${scope}`);
      if (!data.puzzle) {
        setError("No puzzles found.");
        return;
      }
      setPuzzle(data.puzzle);
      setMatched(data.matched);
      setFen(data.puzzle.fen);
      setLast(null);
      setSans([]);
      setStep(0);
      setStatus("intro");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  // The opponent plays their mistake, then the replies after each correct move.
  useEffect(() => {
    if (!puzzle) return;
    const opponentTurn = step % 2 === 0 && step < puzzle.moves.length;
    if (!(status === "intro" || (status === "solving" && opponentTurn))) return;
    const t = window.setTimeout(() => {
      const m = apply(fen, puzzle.moves[step]);
      setFen(m.fen);
      setLast({ from: m.from, to: m.to });
      setSans((s) => [...s, m.san]);
      setStep(step + 1);
      setStatus("solving");
    }, status === "intro" ? 700 : 450);
    return () => window.clearTimeout(t);
  }, [puzzle, status, step, fen]);

  const finish = async (correct: boolean) => {
    if (!puzzle) return;
    setStatus(correct ? "solved" : "failed");
    playSound(correct ? "correct" : "wrong");
    try {
      const result = await api.post<{ rating: number; change: number }>(`/puzzles/${puzzle.id}/attempt`, { correct: correct && !hint });
      setChange(result.change);
      void stats.reload();
    } catch {
      // ignore
    }
  };

  const onMove = (move: { uci: string; from: string; to: string }) => {
    if (!puzzle || status !== "solving" || step % 2 !== 1) return;
    const expected = puzzle.moves[step];
    const m = apply(fen, move.uci);
    if (move.uci === expected || m.mate) {
      setFen(m.fen);
      setLast({ from: m.from, to: m.to });
      setSans((s) => [...s, m.san]);
      const next = step + 1;
      setStep(next);
      setHint(false);
      if (next >= puzzle.moves.length || m.mate) void finish(true);
      return;
    }
    setWrong({ from: move.from, to: move.to });
    window.setTimeout(() => setWrong(null), 600);
    void finish(false);
  };

  const showSolution = () => {
    if (!puzzle) return;
    let f = fen;
    let s = step;
    const more: string[] = [];
    let lastMove = last;
    while (s < puzzle.moves.length) {
      const m = apply(f, puzzle.moves[s]);
      f = m.fen;
      lastMove = { from: m.from, to: m.to };
      more.push(m.san);
      s += 1;
    }
    setFen(f);
    setLast(lastMove);
    setSans((x) => [...x, ...more]);
    setStep(s);
  };

  const solver: Color = puzzle ? (puzzle.fen.split(" ")[1] === "w" ? "black" : "white") : "white";
  const expected = puzzle && status === "solving" && step % 2 === 1 ? puzzle.moves[step] : null;
  const arrows: Arrow[] = [];
  const marks: Mark[] = [];
  if (expected && hint) marks.push({ square: expected.slice(0, 2), color: "hint" });
  if (wrong) marks.push({ square: wrong.to, color: "bad" });
  if (status === "failed" && puzzle && step < puzzle.moves.length) {
    const u = puzzle.moves[step];
    arrows.push({ from: u.slice(0, 2), to: u.slice(2, 4), color: "orange" });
  }

  useBoard({
    fen: fen || "8/8/8/8/8/8/8/8 w - - 0 1",
    orientation: solver,
    lastMove: last,
    interactive: Boolean(expected),
    arrows,
    marks,
    peek: false,
    onMove,
  });

  const themes = (puzzle?.themes || []).map((t) => THEME_NAMES[t]).filter(Boolean).slice(0, 3);
  return (
    <>
      <Crumbs items={[{ label: "Puzzles" }]} />
      <BoardCaption>
        <BoardStrip title={puzzle?.opening ?? ""} fen={fen || undefined} orientation={solver}>
          <span className="muted">{puzzle ? `Puzzle rating ${puzzle.rating}` : ""}</span>
        </BoardStrip>
      </BoardCaption>
      <Back to="/" />
      <PageHead
        title="Opening puzzles"
        right={
          stats.data && (
            <span className="counters">
              <span className="counter">{stats.data.rating}</span>
              {stats.data.streak > 0 && (
                <span className="counter due">
                  {stats.data.streak} <Icon name="fire" />
                </span>
              )}
            </span>
          )
        }
        sub="Positions from real games in your openings. Your opponent just made a mistake: find the move that punishes it."
      />
      <div className="segmented small pad-x">
        <button type="button" className={scope === "repertoire" ? "selected" : ""} onClick={() => setScope("repertoire")}>
          My openings
        </button>
        <button type="button" className={scope === "all" ? "selected" : ""} onClick={() => setScope("all")}>
          All openings
        </button>
      </div>

      {error && <ErrorNote error={error} retry={load} />}
      {!puzzle && !error && <Skeleton rows={3} />}
      {puzzle && (
        <div className="prompt">
          <div className="prompt-line">
            <span className="prompt-move">
              {status === "solved"
                ? "Solved"
                : status === "failed"
                  ? "Not quite"
                  : status === "intro"
                    ? "Watch your opponent's move…"
                    : `Find the best move for ${solver}`}
            </span>
            {status === "solved" && <span className="tag good">✓</span>}
          </div>
          <p className="prompt-note">
            {status === "failed"
              ? "The arrow shows the right move. Play through the solution, then try another."
              : status === "solved"
                ? themes.length
                  ? `Theme: ${themes.join(", ")}.`
                  : "Well found."
                : matched === "variation" || matched === "family"
                  ? `From your ${puzzle.family} games.`
                  : " "}
          </p>
          {change != null && (
            <p className={`feedback ${change >= 0 ? "good" : "bad"}`}>
              Rating {change >= 0 ? "+" : ""}
              {change}
            </p>
          )}
          {sans.length > 0 && <p className="prompt-note mono">{sans.join(" ")}</p>}
        </div>
      )}
      <div className="rows actions">
        {status === "solving" && expected && !hint && <Row title="Give me a hint" meta="Counts as a miss" onClick={() => setHint(true)} />}
        {status === "failed" && puzzle && step < puzzle.moves.length && <Row title="Show the solution" onClick={showSolution} />}
        {(status === "solved" || status === "failed") && <Row variant="accent" title="Next puzzle" onClick={load} chevron />}
        {status === "solving" && <Row title="Skip this puzzle" onClick={() => void finish(false).then(load)} />}
      </div>

      {stats.data && stats.data.recent.length > 0 && (
        <Section title="Recent" right={<span className="muted">{stats.data.solved} of {stats.data.attempts} solved</span>}>
          <div className="recent-dots">
            {stats.data.recent.map((r) => (
              <span key={r.id + r.at} className={`dot-result ${r.correct ? "good" : "bad"}`} title={`${r.opening} · ${r.rating}`} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
