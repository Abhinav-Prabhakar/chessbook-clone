import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Chess } from "chess.js";
import type { Square } from "chess.js";
import type { Color } from "../types";
import { playMoveSound } from "../sounds";

export interface BoardMove {
  from: string;
  to: string;
  san: string;
  uci: string;
  promotion?: string;
}

export interface Arrow {
  from: string;
  to: string;
  color?: "green" | "blue" | "orange" | "red" | "gray";
}

export interface Mark {
  square: string;
  color: "good" | "bad" | "hint" | "focus";
}

export interface BoardProps {
  fen: string;
  orientation?: Color;
  lastMove?: { from: string; to: string } | null;
  interactive?: boolean;
  onMove?: (move: BoardMove) => void;
  arrows?: Arrow[];
  marks?: Mark[];
  showLegal?: boolean;
  coordinates?: boolean;
  theme?: string;
  pieceSet?: string;
  animationMs?: number;
}

const FILES = "abcdefgh";
const THEMES: Record<string, [string, string]> = {
  green: ["#6aa169", "#3f835c"],
  blue: ["#8fb3cf", "#577a96"],
  brown: ["#d9b48c", "#a77852"],
  gray: ["#b9bec4", "#7c858d"],
  purple: ["#a99bc7", "#7465a0"],
};

interface Piece {
  id: number;
  color: "w" | "b";
  type: string;
  square: string;
}

let nextId = 1;

function parsePieces(fen: string): Omit<Piece, "id">[] {
  const rows = fen.split(" ")[0].split("/");
  const out: Omit<Piece, "id">[] = [];
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        f += Number(ch);
        continue;
      }
      const color = ch === ch.toUpperCase() ? "w" : "b";
      out.push({ color, type: ch.toLowerCase(), square: `${FILES[f]}${8 - r}` });
      f += 1;
    }
  });
  return out;
}

function distance(a: string, b: string) {
  const dx = FILES.indexOf(a[0]) - FILES.indexOf(b[0]);
  const dy = Number(a[1]) - Number(b[1]);
  return dx * dx + dy * dy;
}

/** Give each piece in the new position the id of the piece that moved there. */
function matchPieces(prev: Piece[], fen: string, lastMove?: { from: string; to: string } | null): Piece[] {
  const next = parsePieces(fen);
  const pool = [...prev];
  const result: (Piece | null)[] = next.map(() => null);
  const take = (index: number) => pool.splice(index, 1)[0];

  // 1. Pieces that did not move.
  next.forEach((p, i) => {
    const k = pool.findIndex((q) => q.square === p.square && q.color === p.color && q.type === p.type);
    if (k >= 0) result[i] = { ...take(k), square: p.square };
  });
  // 2. The piece that made the last move (including promotions).
  if (lastMove) {
    const i = next.findIndex((p, idx) => !result[idx] && p.square === lastMove.to);
    const k = pool.findIndex((q) => q.square === lastMove.from && q.color === next[i]?.color);
    if (i >= 0 && k >= 0) result[i] = { ...take(k), type: next[i].type, square: next[i].square };
  }
  // 3. Everything else: nearest piece of the same kind.
  next.forEach((p, i) => {
    if (result[i]) return;
    let best = -1;
    let bestD = Infinity;
    pool.forEach((q, k) => {
      if (q.color !== p.color || q.type !== p.type) return;
      const d = distance(q.square, p.square);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    result[i] = best >= 0 ? { ...take(best), square: p.square } : { ...p, id: nextId++ };
  });
  return result as Piece[];
}

function squareXY(square: string, orientation: Color) {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]);
  return orientation === "white" ? { x: f, y: 8 - r } : { x: 7 - f, y: r - 1 };
}

function squareAt(x: number, y: number, orientation: Color) {
  if (x < 0 || x > 7 || y < 0 || y > 7) return null;
  return orientation === "white" ? `${FILES[x]}${8 - y}` : `${FILES[7 - x]}${y + 1}`;
}

const ARROW_COLORS: Record<string, string> = {
  green: "rgba(98, 196, 98, 0.85)",
  blue: "rgba(70, 160, 230, 0.85)",
  orange: "rgba(245, 170, 60, 0.9)",
  red: "rgba(232, 80, 80, 0.88)",
  gray: "rgba(220, 220, 220, 0.55)",
};

export function Board({
  fen,
  orientation = "white",
  lastMove = null,
  interactive = false,
  onMove,
  arrows = [],
  marks = [],
  showLegal = true,
  coordinates = true,
  theme = "green",
  pieceSet = "chessbook_monochrome",
  animationMs = 200,
}: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const piecesRef = useRef<Piece[]>([]);
  const [pieces, setPieces] = useState<Piece[]>(() => {
    const initial = matchPieces([], fen, null);
    piecesRef.current = initial;
    return initial;
  });
  const [leaving, setLeaving] = useState<Piece[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; from: string } | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const pointer = useRef<{ square: string; x: number; y: number; started: boolean; wasSelected: boolean } | null>(null);
  const lastFen = useRef(fen);

  // Re-identify pieces when the position changes, so they slide.
  useLayoutEffect(() => {
    if (lastFen.current === fen) return;
    const before = piecesRef.current;
    const after = matchPieces(before, fen, lastMove);
    const kept = new Set(after.map((p) => p.id));
    const gone = before.filter((p) => !kept.has(p.id));
    piecesRef.current = after;
    setPieces(after);
    setSelected(null);
    setPromotion(null);
    if (gone.length && animationMs > 0) {
      setLeaving(gone);
      const t = window.setTimeout(() => setLeaving([]), animationMs);
      lastFen.current = fen;
      return () => window.clearTimeout(t);
    }
    setLeaving([]);
    lastFen.current = fen;
  }, [fen, lastMove, animationMs]);

  // Move sound when a move lands on the board.
  const soundKey = lastMove ? `${fen}|${lastMove.from}${lastMove.to}` : null;
  const prevSound = useRef<string | null>(soundKey);
  useEffect(() => {
    if (!soundKey || soundKey === prevSound.current) {
      prevSound.current = soundKey;
      return;
    }
    prevSound.current = soundKey;
    try {
      const chess = new Chess(fen);
      const captured = leavingCountRef.current > 0;
      playMoveSound(captured, chess.inCheck());
    } catch {
      // ignore
    }
  }, [soundKey, fen]);
  const leavingCountRef = useRef(0);
  leavingCountRef.current = leaving.length;

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);
  const turn = chess?.turn() ?? "w";

  const legalFrom = (square: string) => {
    if (!chess) return [];
    try {
      return chess.moves({ square: square as Square, verbose: true });
    } catch {
      return [];
    }
  };

  const targets = useMemo(() => {
    if (!selected || !interactive) return new Map<string, boolean>();
    return new Map(legalFrom(selected).map((m) => [m.to, Boolean(m.captured)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, interactive, fen]);

  const commit = (from: string, to: string, promo?: string) => {
    if (!chess) return;
    const options = legalFrom(from).filter((m) => m.to === to);
    if (!options.length) {
      setSelected(null);
      return;
    }
    if (options.some((m) => m.promotion) && !promo) {
      setPromotion({ from, to });
      return;
    }
    const probe = new Chess(fen);
    const move = probe.move({ from: from as Square, to: to as Square, promotion: promo as any });
    setSelected(null);
    setPromotion(null);
    // Slide the piece optimistically; the parent decides the real position.
    onMove?.({ from, to, san: move.san, uci: `${from}${to}${move.promotion || ""}`, promotion: move.promotion });
  };

  const pointToSquare = (clientX: number, clientY: number) => {
    const rect = boardRef.current!.getBoundingClientRect();
    const size = rect.width / 8;
    return squareAt(Math.floor((clientX - rect.left) / size), Math.floor((clientY - rect.top) / size), orientation);
  };

  const ownPieceAt = (square: string) => {
    const piece = pieces.find((p) => p.square === square);
    return piece && piece.color === turn ? piece : null;
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    if (!interactive || promotion || event.button !== 0) return;
    const square = pointToSquare(event.clientX, event.clientY);
    if (!square) return;
    if (selected && targets.has(square)) {
      commit(selected, square);
      return;
    }
    if (ownPieceAt(square)) {
      boardRef.current?.setPointerCapture(event.pointerId);
      pointer.current = { square, x: event.clientX, y: event.clientY, started: false, wasSelected: selected === square };
      setSelected(square);
    } else {
      setSelected(null);
    }
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const p = pointer.current;
    if (!p) return;
    if (!p.started && Math.hypot(event.clientX - p.x, event.clientY - p.y) < 4) return;
    p.started = true;
    const piece = ownPieceAt(p.square);
    if (!piece) return;
    const rect = boardRef.current!.getBoundingClientRect();
    setDrag({
      id: piece.id,
      from: p.square,
      x: event.clientX - rect.left - rect.width / 16,
      y: event.clientY - rect.top - rect.width / 16,
    });
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    const p = pointer.current;
    pointer.current = null;
    if (!p) return;
    if (p.started) {
      const square = pointToSquare(event.clientX, event.clientY);
      setDrag(null);
      if (square && square !== p.square) commit(p.square, square);
      return;
    }
    if (p.wasSelected) setSelected(null);
  };

  const [light, dark] = THEMES[theme] || THEMES.green;
  const style = { "--sq-light": light, "--sq-dark": dark, "--anim": `${animationMs}ms` } as CSSProperties;

  const squares = [];
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const square = squareAt(x, y, orientation)!;
      const isLight = (FILES.indexOf(square[0]) + Number(square[1])) % 2 === 1;
      const classes = ["sq", isLight ? "light" : "dark"];
      if (lastMove && (lastMove.from === square || lastMove.to === square)) classes.push("last");
      if (selected === square && interactive) classes.push("selected");
      const mark = marks.find((m) => m.square === square);
      if (mark) classes.push(`mark-${mark.color}`);
      const target = targets.get(square);
      squares.push(
        <div key={square} className={classes.join(" ")}>
          {showLegal && target !== undefined && <span className={target ? "dot capture" : "dot"} />}
          {coordinates && y === 7 && <span className="coord file">{square[0]}</span>}
          {coordinates && x === 7 && <span className="coord rank">{square[1]}</span>}
        </div>
      );
    }
  }

  const renderPiece = (piece: Piece, extra = "") => {
    const { x, y } = squareXY(piece.square, orientation);
    const dragging = drag?.id === piece.id;
    const transform = dragging ? `translate(${drag!.x}px, ${drag!.y}px)` : `translate(${x * 100}%, ${y * 100}%)`;
    return (
      <div
        key={piece.id}
        className={`piece${dragging ? " dragging" : ""}${extra}`}
        style={{ transform, backgroundImage: `url(/pieces/${pieceSet}/${piece.color}${piece.type.toUpperCase()}.svg)` }}
      />
    );
  };

  return (
    <div
      ref={boardRef}
      className={`board${interactive ? " interactive" : ""}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        pointer.current = null;
        setDrag(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
      role="img"
      aria-label={`Chess board, ${turn === "w" ? "white" : "black"} to move`}
      data-fen={fen}
      data-orientation={orientation}
    >
      <div className="squares">{squares}</div>
      <div className="pieces">
        {leaving.map((p) => renderPiece(p, " leaving"))}
        {pieces.map((p) => renderPiece(p))}
      </div>
      {arrows.length > 0 && (
        <svg className="arrows" viewBox="0 0 8 8">
          {arrows.map((a, i) => {
            const s = squareXY(a.from, orientation);
            const e = squareXY(a.to, orientation);
            const x1 = s.x + 0.5;
            const y1 = s.y + 0.5;
            const x2 = e.x + 0.5;
            const y2 = e.y + 0.5;
            const len = Math.hypot(x2 - x1, y2 - y1) || 1;
            const ux = (x2 - x1) / len;
            const uy = (y2 - y1) / len;
            const head = 0.42;
            const bx = x2 - ux * head;
            const by = y2 - uy * head;
            const w = 0.25;
            const color = ARROW_COLORS[a.color || "green"];
            return (
              <g key={`${a.from}${a.to}${i}`} opacity={0.95}>
                <line x1={x1 + ux * 0.2} y1={y1 + uy * 0.2} x2={bx} y2={by} stroke={color} strokeWidth={0.17} strokeLinecap="round" />
                <polygon points={`${x2},${y2} ${bx - uy * w},${by + ux * w} ${bx + uy * w},${by - ux * w}`} fill={color} />
              </g>
            );
          })}
        </svg>
      )}
      {promotion && (
        <div className="promotion" onPointerDown={(e) => e.stopPropagation()}>
          <div className="promotion-box">
            {["q", "r", "b", "n"].map((type) => (
              <button
                key={type}
                type="button"
                aria-label={`Promote to ${type}`}
                style={{ backgroundImage: `url(/pieces/${pieceSet}/${turn}${type.toUpperCase()}.svg)` }}
                onClick={() => commit(promotion.from, promotion.to, type)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
