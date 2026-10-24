import { Chess } from "chess.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function afterMove(fen: string, san: string) {
  const chess = new Chess(fen);
  const move = chess.move(san);
  return { fen: chess.fen(), from: move.from, to: move.to, san: move.san };
}

export function afterMoves(fen: string, sans: string[]) {
  const chess = new Chess(fen);
  let from = "";
  let to = "";
  for (const san of sans) {
    const move = chess.move(san);
    from = move.from;
    to = move.to;
  }
  return { fen: chess.fen(), from, to };
}

export function pgnTimeline(pgn: string) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const sans = chess.history();
  const fens = [new Chess().fen()];
  const moves: { san: string; from: string; to: string; fen: string }[] = [];
  const replay = new Chess();
  for (const san of sans) {
    const move = replay.move(san);
    fens.push(replay.fen());
    moves.push({ san: move.san, from: move.from, to: move.to, fen: replay.fen() });
  }
  return { sans, fens, moves };
}

export function legalSan(fen: string, from: string, to: string) {
  try {
    const chess = new Chess(fen);
    const move = chess.move({ from: from as any, to: to as any, promotion: "q" });
    return move.san;
  } catch {
    return null;
  }
}

/** Resolve a SAN to its squares (used for hints and last-move highlights). */
export function findMove(fen: string, san: string) {
  try {
    const chess = new Chess(fen);
    const move = chess.move(san);
    return {
      from: move.from as string,
      to: move.to as string,
      san: move.san as string,
      promotion: move.promotion as string | undefined,
    };
  } catch {
    return null;
  }
}

/** Side to move, or null when the FEN cannot be loaded. */
export function sideToMove(fen: string): "white" | "black" | null {
  try {
    const chess = new Chess(fen);
    return chess.turn() === "w" ? "white" : "black";
  } catch {
    return null;
  }
}
