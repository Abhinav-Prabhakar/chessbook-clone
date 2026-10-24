import { useMemo } from "react";
import { Chess } from "chess.js";
import type { Color } from "../../types";
import { getBoardTheme, getCoordinates } from "../../prefs";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];
const THEMES = {
  green: ["#639e61", "#3f835c"],
  blue: ["#7aa7c7", "#4f7997"],
  brown: ["#b58863", "#8b5a3c"],
} as const;

export type SquareMark = "selected" | "correct" | "wrong" | "missed";

const MARK_COLORS: Record<SquareMark, string> = {
  selected: "rgba(100, 160, 230, 0.55)",
  correct: "rgba(110, 190, 120, 0.55)",
  wrong: "rgba(235, 85, 85, 0.55)",
  missed: "rgba(240, 178, 72, 0.55)",
};

/**
 * A board for drills that ask the user to select squares rather than play a
 * move (Vision). It deliberately does not use move generation: every square is
 * clickable and the page owns the selection state.
 */
export function SelectBoard({
  fen,
  orientation = "white",
  selected = [],
  marks = {},
  onToggle,
  coordinates = getCoordinates(),
  theme = getBoardTheme(),
}: {
  fen: string;
  orientation?: Color;
  selected?: string[];
  marks?: Record<string, SquareMark>;
  onToggle?: (square: string) => void;
  coordinates?: boolean;
  theme?: string;
}) {
  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const order = useMemo(() => {
    const files = orientation === "white" ? FILES : [...FILES].reverse();
    const ranks = orientation === "white" ? RANKS : [...RANKS].reverse();
    return ranks.flatMap((rank) => files.map((file) => `${file}${rank}`));
  }, [orientation]);
  const themeColors = THEMES[theme as keyof typeof THEMES] ?? THEMES.green;

  return (
    <div
      className="cb-board"
      data-testid="vision-board"
      role="grid"
      aria-label="Board vision drill. Click squares to select them."
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
        const isLight = (FILES.indexOf(file) + Number(rank)) % 2 === 0;
        const piece = chess.get(square as never);
        const isSelected = selectedSet.has(square);
        const mark = marks[square];
        const edgeRank = orientation === "white" ? rank === "1" : rank === "8";
        const edgeFile = orientation === "white" ? file === "h" : file === "a";
        return (
          <button
            type="button"
            key={square}
            className={`cb-square ${isLight ? "light" : "dark"}${isSelected ? " selected" : ""}`}
            data-testid={`vision-square-${square}`}
            aria-pressed={isSelected}
            aria-label={`${square}${piece ? ` ${piece.color === "w" ? "white" : "black"} ${piece.type}` : " empty"}`}
            style={{ cursor: onToggle ? "pointer" : "default" }}
            onClick={() => onToggle?.(square)}
          >
            {mark && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  background: MARK_COLORS[mark],
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              />
            )}
            {piece && (
              <span className="cb-piece">
                <img
                  src={`/pieces/chessbook_monochrome/${piece.color}${piece.type.toUpperCase()}.svg`}
                  alt=""
                  draggable={false}
                />
              </span>
            )}
            {coordinates && edgeRank && (
              <span className={`cb-coord file ${isLight ? "on-light" : "on-dark"}`}>{file}</span>
            )}
            {coordinates && edgeFile && (
              <span className={`cb-coord rank ${isLight ? "on-light" : "on-dark"}`}>{rank}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
