import { Chess } from "chess.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface Replayed {
  fen: string;
  lastMove: { from: string; to: string } | null;
  moves: { san: string; from: string; to: string; fen: string }[];
  valid: boolean;
}

export function replay(path: string[], fen = START_FEN): Replayed {
  const chess = new Chess(fen);
  const moves: Replayed["moves"] = [];
  try {
    for (const san of path) {
      const m = chess.move(san);
      moves.push({ san: m.san, from: m.from, to: m.to, fen: chess.fen() });
    }
  } catch {
    return { fen: chess.fen(), lastMove: moves.length ? moves[moves.length - 1] : null, moves, valid: false };
  }
  const last = moves[moves.length - 1];
  return { fen: chess.fen(), lastMove: last ? { from: last.from, to: last.to } : null, moves, valid: true };
}

export function turnOf(fen: string) {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

/** "1. e4 c5 2. Nf3" from a list of SANs. */
export function movesText(sans: string[]) {
  return sans
    .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
    .join(" ");
}

export function lichessAnalysis(fen: string, orientation: string) {
  return `https://lichess.org/analysis/${fen.replace(/ /g, "_")}?color=${orientation}`;
}

export function moveFromUci(fen: string, uci: string) {
  const chess = new Chess(fen);
  try {
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    return { san: m.san, from: m.from, to: m.to, fen: chess.fen(), captured: Boolean(m.captured) };
  } catch {
    return null;
  }
}
