import { useMemo, useState } from "react";
import { Chess } from "chess.js";
import type { Color } from "../types";
import { getBoardTheme, getCoordinates, getLegalMoves } from "../prefs";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

const THEMES = {
  green: ["#639e61", "#3f835c"],
  blue: ["#7aa7c7", "#4f7997"],
  brown: ["#b58863", "#8b5a3c"],
} as const;

export interface BoardMove {
  from: string;
  to: string;
  san: string;
  promotion?: string;
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
  onMove?: (move: BoardMove) => void;
  className?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);

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

  const clickSquare = (square: string) => {
    if (!interactive) return;
    if (selected) {
      if (selected === square) {
        setSelected(null);
        return;
      }
      if (legalTargets.has(square)) {
        try {
          const move = chess.move({ from: selected as any, to: square as any, promotion: "q" });
          setSelected(null);
          onMove?.({ from: selected, to: square, san: move.san, promotion: move.promotion });
        } catch {
          setSelected(null);
        }
        return;
      }
    }
    const piece = chess.get(square as any);
    if (piece && piece.color === chess.turn()) {
      setSelected(square);
    } else {
      setSelected(null);
    }
  };

  const themeColors = THEMES[theme] ?? THEMES.green;

  return (
    <div
      className={`cb-board ${feedback ? `cb-board-${feedback}` : ""} ${className}`}
      data-testid="chessboard"
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
        const isLast = lastMove && (lastMove.from === square || lastMove.to === square);
        const isWrong = wrongMove && (wrongMove.from === square || wrongMove.to === square);
        const edgeRank = orientation === "white" ? rank === "1" : rank === "8";
        const edgeFile = orientation === "white" ? file === "h" : file === "a";
        return (
          <button
            type="button"
            key={square}
            className={[
              "cb-square",
              isLight ? "light" : "dark",
              isSelected ? "selected" : "",
              isLegal ? "legal" : "",
              isCapture ? "capture" : "",
              isLast ? "last" : "",
              isWrong ? "wrong" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid={`square-${square}`}
            aria-label={`${square}${piece ? ` ${piece.color === "w" ? "white" : "black"} ${piece.type}` : ""}`}
            onClick={() => clickSquare(square)}
          >
            {piece && (
              <span
                className="cb-piece"
                id={`piece-${square}`}
                data-testid={`piece-${square}`}
              >
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
