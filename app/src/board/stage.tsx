import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Icon } from "../ui/Icon";
import type { Arrow, BoardMove, Mark, SquareFeedback } from "./Board";
import type { Color } from "../types";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface StageBoard {
  fen: string;
  orientation: Color;
  lastMove: { from: string; to: string } | null;
  interactive: boolean;
  arrows: Arrow[];
  marks: Mark[];
  feedback: SquareFeedback | null;
  /** On phones, show only the top of the board on pages that don't use it. */
  peek: boolean;
}

interface StageContextValue {
  board: StageBoard;
  setBoard: (board: StageBoard) => void;
  onMoveRef: MutableRefObject<((move: BoardMove) => void) | null>;
  crumbs: Crumb[];
  setCrumbs: (crumbs: Crumb[]) => void;
  captionSlot: HTMLElement | null;
  setSlots: (crumb: HTMLElement | null, caption: HTMLElement | null) => void;
}

export interface Crumb {
  label: string;
  to?: string;
  ring?: number;
}

const DEFAULT_BOARD: StageBoard = {
  fen: START_FEN,
  orientation: "white",
  lastMove: null,
  interactive: false,
  arrows: [],
  marks: [],
  feedback: null,
  peek: true,
};

const StageContext = createContext<StageContextValue | null>(null);

export function StageProvider({ children }: { children: ReactNode }) {
  const [board, setBoard] = useState<StageBoard>(DEFAULT_BOARD);
  const [slots, setSlotsState] = useState<{ crumb: HTMLElement | null; caption: HTMLElement | null }>({
    crumb: null,
    caption: null,
  });
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const onMoveRef = useRef<((move: BoardMove) => void) | null>(null);
  const value = useMemo<StageContextValue>(
    () => ({
      board,
      setBoard,
      onMoveRef,
      crumbs,
      setCrumbs,
      captionSlot: slots.caption,
      setSlots: (crumb, caption) =>
        setSlotsState((s) => (s.crumb === crumb && s.caption === caption ? s : { crumb, caption })),
    }),
    [board, slots, crumbs]
  );
  return <StageContext.Provider value={value}>{children}</StageContext.Provider>;
}

export function useStageContext() {
  const value = useContext(StageContext);
  if (!value) throw new Error("useStage outside StageProvider");
  return value;
}

/**
 * Show a position on the shared board. Only the fields you pass change; the
 * board keeps its pieces and animates to the new position.
 */
export function useBoard(
  props: (Partial<Omit<StageBoard, "fen">> & { fen?: string; onMove?: ((move: BoardMove) => void) | null }) | null
) {
  const { setBoard, onMoveRef } = useStageContext();
  // `null` keeps whatever the board shows now (e.g. while a page loads),
  // so the pieces don't jump to the start position and back.
  const { onMove = null, ...rest } = props ?? {};
  const next: StageBoard | null = props ? { ...DEFAULT_BOARD, ...rest, fen: rest.fen ?? DEFAULT_BOARD.fen } : null;
  const key = next ? JSON.stringify(next) : null;
  onMoveRef.current = props ? onMove : null;
  useLayoutEffect(() => {
    if (next) setBoard(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * Breadcrumbs above the board. They live in shared state so crumbs that stay
 * the same between pages are not redrawn; only new ones slide in.
 */
export function Crumbs({ items }: { items: Crumb[] }) {
  const { setCrumbs } = useStageContext();
  const key = JSON.stringify(items);
  useLayoutEffect(() => {
    setCrumbs(items);
    return () => setCrumbs([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

export function BoardCaption({ children }: { children: ReactNode }) {
  const { captionSlot } = useStageContext();
  if (!captionSlot) return null;
  return createPortal(children, captionSlot);
}

export function CrumbList({ items }: { items: Crumb[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link to="/" className="crumb-home" aria-label="Home">
        <img src="/chessbook-mark.svg" alt="" />
      </Link>
      {items.map((item) => (
        <span className="crumb" key={`${item.label}|${item.to ?? ""}`}>
          <Icon name="chevron-right" className="crumb-sep" />
          {item.ring != null && <MiniRing value={item.ring} />}
          {item.to ? <Link to={item.to}>{item.label}</Link> : <span>{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

function MiniRing({ value }: { value: number }) {
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <svg className="crumb-ring" width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${(c * value) / 100} ${c}`} transform="rotate(-90 7 7)" />
    </svg>
  );
}
