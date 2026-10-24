import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Color } from "../types";
import { getBoardTheme, getCoordinates, getLegalMoves } from "../prefs";
import { playMoveSound } from "../sounds";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

const THEMES = {
  green: ["#639e61", "#3f835c"],
  blue: ["#7aa7c7", "#4f7997"],
  brown: ["#b58863", "#8b5a3c"],
} as const;

const PROMOTIONS = [
  { piece: "q", label: "Queen" },
  { piece: "r", label: "Rook" },
  { piece: "b", label: "Bishop" },
  { piece: "n", label: "Knight" },
] as const;

const ARROW_COLORS: Record<string, string> = {
  plan: "rgba(110, 190, 120, 0.85)",
  hint: "rgba(240, 178, 72, 0.92)",
  refutation: "rgba(235, 85, 85, 0.92)",
  last: "rgba(100, 160, 230, 0.88)",
  wrong: "rgba(235, 85, 85, 0.92)",
};

function animationPreference(): { enabled: boolean; duration: number } {
  let value = "Fast";
  try {
    value = localStorage.getItem("cb_animation") ?? "Fast";
  } catch {
    // A blocked storage API keeps the fast default.
  }
  if (value === "Off") return { enabled: false, duration: 0 };
  return { enabled: true, duration: value === "Normal" ? 240 : 120 };
}

function moveOffset(
  from: string,
  to: string,
  orientation: Color
): { x: number; y: number } {
  const fromFile = FILES.indexOf(from[0]);
  const toFile = FILES.indexOf(to[0]);
  const fromRank = Number(from[1]);
  const toRank = Number(to[1]);
  if (orientation === "white") {
    return { x: (fromFile - toFile) * 100, y: (toRank - fromRank) * 100 };
  }
  return { x: (toFile - fromFile) * 100, y: (fromRank - toRank) * 100 };
}

/** Convert a square to its centre inside the 8×8 arrow viewBox. */
function squareCentre(square: string, orientation: Color) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  if (file < 0 || !rank) return { x: 0, y: 0 };
  if (orientation === "white") {
    return { x: file + 0.5, y: 8 - rank + 0.5 };
  }
  return { x: 7 - file + 0.5, y: rank - 1 + 0.5 };
}

interface ArrowGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  head: string;
}

function arrowGeometry(from: string, to: string, orientation: Color): ArrowGeometry | null {
  const start = squareCentre(from, orientation);
  const end = squareCentre(to, orientation);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) return null;
  const ux = dx / length;
  const uy = dy / length;
  const headLength = 0.38;
  const headWidth = 0.23;
  const x1 = start.x + ux * 0.24;
  const y1 = start.y + uy * 0.24;
  const tipX = end.x - ux * 0.06;
  const tipY = end.y - uy * 0.06;
  const baseX = tipX - ux * headLength;
  const baseY = tipY - uy * headLength;
  const leftX = baseX - uy * headWidth;
  const leftY = baseY + ux * headWidth;
  const rightX = baseX + uy * headWidth;
  const rightY = baseY - ux * headWidth;
  return {
    x1,
    y1,
    x2: baseX,
    y2: baseY,
    head: `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`,
  };
}

export interface BoardMove {
  from: string;
  to: string;
  san: string;
  promotion?: string;
}

export interface BoardArrow {
  from: string;
  to: string;
  kind?: "plan" | "hint" | "refutation" | "last" | "wrong";
  color?: string;
}

export interface BoardHighlight {
  square: string;
  kind?: "plan" | "hint" | "refutation" | "last" | "wrong";
  color?: string;
}

export function Board({
  fen,
  orientation = "white",
  coordinates = getCoordinates(),
  interactive = false,
  showLegalMoves = getLegalMoves(),
  lastMove = null,
  wrongMove = null,
  feedback = null,
  theme = getBoardTheme(),
  lastMoveTint = null,
  arrows = [],
  highlights = [],
  onMove,
  className = "",
}: {
  fen: string;
  orientation?: Color;
  coordinates?: boolean;
  interactive?: boolean;
  showLegalMoves?: boolean;
  lastMove?: { from: string; to: string } | null;
  wrongMove?: { from: string; to: string } | null;
  feedback?: "correct" | "wrong" | null;
  theme?: "green" | "blue" | "brown";
  /** Colour painted over both squares of the previous move (production blue). */
  lastMoveTint?: string | null;
  arrows?: BoardArrow[];
  highlights?: BoardHighlight[];
  onMove?: (move: BoardMove) => void;
  className?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [focused, setFocused] = useState<string>(orientation === "white" ? "a8" : "h1");
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: string;
    to: string;
    color: "w" | "b";
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [animateMove, setAnimateMove] = useState(false);
  const previousMove = useRef<string | null>(null);
  const animateTimer = useRef<number | null>(null);
  const squareRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const animation = animationPreference();

  useEffect(() => {
    const signature = lastMove ? `${lastMove.from}-${lastMove.to}` : "";
    if (animation.enabled && signature && signature !== previousMove.current) {
      setAnimateMove(true);
      if (animateTimer.current) window.clearTimeout(animateTimer.current);
      animateTimer.current = window.setTimeout(
        () => setAnimateMove(false),
        animation.duration + 40
      );
    }
    previousMove.current = signature;
    return () => {
      if (animateTimer.current) window.clearTimeout(animateTimer.current);
    };
  }, [lastMove, animation.enabled, animation.duration]);

  useEffect(() => {
    setSelected(null);
    setDragFrom(null);
    setPendingPromotion(null);
  }, [fen]);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  const order = useMemo(() => {
    const files = orientation === "white" ? FILES : [...FILES].reverse();
    const ranks = orientation === "white" ? RANKS : [...RANKS].reverse();
    return ranks.flatMap((rank) => files.map((file) => `${file}${rank}`));
  }, [orientation]);

  const legalTargets = useMemo(() => {
    if (!selected || !interactive) return new Map<string, boolean>();
    const map = new Map<string, boolean>();
    try {
      const moves = chess.moves({ square: selected as any, verbose: true });
      for (const move of moves) {
        map.set(move.to, Boolean(move.captured));
      }
    } catch {
      // ignore
    }
    return map;
  }, [chess, selected, interactive]);

  const highlightMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const highlight of highlights) {
      map.set(
        highlight.square,
        highlight.color ?? ARROW_COLORS[highlight.kind ?? "plan"]
      );
    }
    return map;
  }, [highlights]);

  /** Validate and play a move; asks for a promotion piece when needed. */
  const tryMove = (from: string, to: string, promotion?: string) => {
    if (!interactive) return;
    let probe: Chess;
    try {
      probe = new Chess(fen);
    } catch {
      return;
    }
    const legal = probe
      .moves({ square: from as any, verbose: true })
      .filter((move) => move.to === to);
    if (!legal.length) {
      setSelected(null);
      return;
    }
    const needsPromotion = legal.some((move) => Boolean(move.promotion));
    if (needsPromotion && !promotion) {
      setPendingPromotion({ from, to, color: probe.turn() === "w" ? "w" : "b" });
      return;
    }
    try {
      const move = probe.move({
        from: from as any,
        to: to as any,
        ...(promotion ? { promotion: promotion as any } : {}),
      });
      setSelected(null);
      setPendingPromotion(null);
      setFocused(to);
      setAnnouncement(`Played ${move.san}`);
      playMoveSound(Boolean(move.captured), probe.isCheck());
      onMove?.({
        from,
        to,
        san: move.san,
        promotion: move.promotion as string | undefined,
      });
    } catch {
      setSelected(null);
    }
  };

  const choosePromotion = (piece: string) => {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;
    setPendingPromotion(null);
    tryMove(from, to, piece);
  };

  const clickSquare = (square: string) => {
    if (!interactive) return;
    setFocused(square);
    if (pendingPromotion) return;
    if (selected) {
      if (selected === square) {
        setSelected(null);
        setAnnouncement("Selection cleared");
        return;
      }
      if (legalTargets.has(square)) {
        tryMove(selected, square);
        return;
      }
    }
    const piece = chess.get(square as any);
    if (piece && piece.color === chess.turn()) {
      setSelected(square);
      setAnnouncement(`Selected ${square}`);
    } else {
      setSelected(null);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent, square: string) => {
    if (event.key === "Escape") {
      setSelected(null);
      setPendingPromotion(null);
      return;
    }
    let fileDelta = 0;
    let rankDelta = 0;
    if (event.key === "ArrowUp") rankDelta = orientation === "white" ? 1 : -1;
    else if (event.key === "ArrowDown") rankDelta = orientation === "white" ? -1 : 1;
    else if (event.key === "ArrowLeft") fileDelta = orientation === "white" ? -1 : 1;
    else if (event.key === "ArrowRight") fileDelta = orientation === "white" ? 1 : -1;
    else if (event.key === "Home") fileDelta = orientation === "white" ? -8 : 8;
    else if (event.key === "End") fileDelta = orientation === "white" ? 8 : -8;
    else return;
    event.preventDefault();
    const fileIndex = FILES.indexOf(square[0]);
    const rank = Number(square[1]);
    const nextFile = Math.max(0, Math.min(7, fileIndex + fileDelta));
    const nextRank = Math.max(1, Math.min(8, rank + rankDelta));
    const target = `${FILES[nextFile]}${nextRank}`;
    setFocused(target);
    squareRefs.current[target]?.focus();
  };

  const themeColors = THEMES[theme] ?? THEMES.green;

  return (
    <div
      className={`cb-board ${feedback ? `cb-board-${feedback}` : ""} ${className}`}
      data-testid="chessboard"
      role="group"
      aria-label="Chess board. Use arrow keys to move between squares, Enter to select, Escape to cancel."
      style={
        {
          "--cb-light": themeColors[0],
          "--cb-dark": themeColors[1],
        } as React.CSSProperties
      }
    >
      {order.map((square) => {
        const file = square[0];
        const rank = square[1];
        const fileIndex = FILES.indexOf(file);
        const rankIndex = Number(rank);
        const isLight = (fileIndex + rankIndex) % 2 === 0;
        const piece = chess.get(square as any);
        const isSelected = selected === square;
        const isLegal = legalTargets.has(square);
        const isCapture = Boolean(legalTargets.get(square));
        const isLast = Boolean(
          lastMove && (lastMove.from === square || lastMove.to === square)
        );
        const isWrong = Boolean(
          wrongMove && (wrongMove.from === square || wrongMove.to === square)
        );
        const edgeRank = orientation === "white" ? rank === "1" : rank === "8";
        const edgeFile = orientation === "white" ? file === "h" : file === "a";
        const isMovingPiece =
          animateMove && lastMove != null && lastMove.to === square && Boolean(piece);
        const offset = isMovingPiece
          ? moveOffset(lastMove!.from, lastMove!.to, orientation)
          : null;
        const ownPiece = Boolean(piece && piece.color === chess.turn());
        const canDrag = interactive && ownPiece;
        const highlight = highlightMap.get(square);
        const tint =
          lastMoveTint && isLast
            ? lastMoveTint
            : isWrong
              ? "rgba(235, 85, 85, 0.32)"
              : null;
        const cursor = !interactive
          ? "default"
          : dragFrom === square
            ? "grabbing"
            : isLegal
              ? "pointer"
              : ownPiece
                ? "grab"
                : "default";
        return (
          <button
            type="button"
            key={square}
            ref={(element) => {
              squareRefs.current[square] = element;
            }}
            className={[
              "cb-square",
              isLight ? "light" : "dark",
              isSelected ? "selected" : "",
              isLegal && showLegalMoves ? "legal" : "",
              isCapture && showLegalMoves ? "capture" : "",
              isLast ? "last" : "",
              isWrong ? "wrong" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid={`square-${square}`}
            aria-label={`${square}${
              piece
                ? ` ${piece.color === "w" ? "white" : "black"} ${piece.type}`
                : " empty"
            }`}
            aria-pressed={isSelected}
            tabIndex={focused === square ? 0 : -1}
            draggable={canDrag}
            style={{ cursor }}
            onClick={() => clickSquare(square)}
            onFocus={() => setFocused(square)}
            onKeyDown={(event) => handleKeyDown(event, square)}
            onDragStart={(event) => {
              if (!canDrag) {
                event.preventDefault();
                return;
              }
              setDragFrom(square);
              setSelected(square);
              setFocused(square);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", square);
            }}
            onDragEnd={() => setDragFrom(null)}
            onDragOver={(event) => {
              if (!interactive || !dragFrom) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              if (!interactive) return;
              event.preventDefault();
              const from = dragFrom || event.dataTransfer.getData("text/plain");
              setDragFrom(null);
              if (from) tryMove(from, square);
            }}
          >
            {tint && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  background: tint,
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              />
            )}
            {highlight && (
              <span
                aria-hidden
                data-testid={`highlight-${square}`}
                style={{
                  position: "absolute",
                  inset: 0,
                  background: highlight,
                  pointerEvents: "none",
                  zIndex: 3,
                }}
              />
            )}
            {piece && (
              <span
                className={`cb-piece ${isMovingPiece ? "cb-piece-move" : ""}`}
                id={`piece-${square}`}
                data-testid={`piece-${square}`}
                style={{
                  cursor: canDrag ? "grab" : "inherit",
                  ...(offset
                    ? ({
                        "--cb-from-x": `${offset.x}%`,
                        "--cb-from-y": `${offset.y}%`,
                        animationDuration: `${animation.duration}ms`,
                      } as React.CSSProperties)
                    : {}),
                }}
              >
                <img
                  src={`/pieces/chessbook_monochrome/${piece.color}${piece.type.toUpperCase()}.svg`}
                  alt=""
                  draggable={false}
                />
              </span>
            )}
            {coordinates && edgeRank && (
              <span className={`cb-coord file ${isLight ? "on-light" : "on-dark"}`}>
                {file}
              </span>
            )}
            {coordinates && edgeFile && (
              <span className={`cb-coord rank ${isLight ? "on-light" : "on-dark"}`}>
                {rank}
              </span>
            )}
          </button>
        );
      })}

      {arrows.length > 0 && (
        <svg
          aria-hidden
          viewBox="0 0 8 8"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 7,
          }}
        >
          {arrows.map((arrow, index) => {
            const geometry = arrowGeometry(arrow.from, arrow.to, orientation);
            if (!geometry) return null;
            const color = arrow.color ?? ARROW_COLORS[arrow.kind ?? "plan"];
            return (
              <g
                key={`${arrow.from}-${arrow.to}-${arrow.kind ?? "arrow"}-${index}`}
                data-testid={`arrow-${arrow.from}-${arrow.to}`}
              >
                <line
                  x1={geometry.x1}
                  y1={geometry.y1}
                  x2={geometry.x2}
                  y2={geometry.y2}
                  stroke={color}
                  strokeWidth={0.16}
                  strokeLinecap="round"
                />
                <polygon points={geometry.head} fill={color} />
              </g>
            );
          })}
        </svg>
      )}

      {pendingPromotion && (
        <div
          data-testid="promotion-picker"
          role="dialog"
          aria-label="Choose a promotion piece"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingPromotion(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setPendingPromotion(null);
            }
          }}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 30,
            display: "grid",
            placeItems: "center",
            background: "rgba(10, 14, 12, 0.42)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: 8,
              borderRadius: 8,
              background: "var(--cb-bg-raised, #20262a)",
              border: "1px solid var(--cb-border, #343c41)",
              boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
            }}
          >
            {PROMOTIONS.map((option) => (
              <button
                key={option.piece}
                type="button"
                autoFocus={option.piece === "q"}
                data-testid={`promotion-${option.piece}`}
                aria-label={`Promote to ${option.label}${option.piece === "q" ? " (default)" : ""}`}
                title={`${option.label}${option.piece === "q" ? " (default)" : ""}`}
                onClick={() => choosePromotion(option.piece)}
                style={{
                  width: 52,
                  height: 52,
                  padding: 2,
                  borderRadius: 6,
                  border:
                    option.piece === "q"
                      ? "2px solid var(--cb-green, #79c46b)"
                      : "1px solid var(--cb-border, #343c41)",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <img
                  src={`/pieces/chessbook_monochrome/${pendingPromotion.color}${option.piece.toUpperCase()}.svg`}
                  alt=""
                  style={{ width: "100%", height: "100%", pointerEvents: "none" }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        {announcement}
      </div>
    </div>
  );
}
