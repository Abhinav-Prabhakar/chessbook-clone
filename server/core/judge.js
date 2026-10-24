/**
 * Judge a move that isn't in your repertoire, as production does: compare
 * the mover's winning chances before and after it with a shallow Stockfish
 * search. Losing less than 6% is a good move (an "alternative"), then
 * inaccuracy (6–9%), mistake (9–20%) and blunder (20%+). For a mistake the
 * engine's reply is returned as the refutation to show on the board.
 */
import { analyse } from "../engine.js";
import { applyMove, epdOf } from "./chess.js";
import { httpError } from "./repertoire.js";

const DEPTH = 10;

/** Lichess's win-chance curve, 0–1 for White. */
function whiteWin(result) {
  if (result.mate != null) return result.mate > 0 ? 1 : 0;
  const cp = result.evalCp ?? 0;
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

export function classify(drop) {
  if (drop > 0.2) return "blunder";
  if (drop > 0.09) return "mistake";
  if (drop > 0.06) return "inaccuracy";
  return "good";
}

export async function judgeMove(fen, uci) {
  const played = applyMove(fen, uci);
  if (!played) throw httpError(400, "Illegal move");
  const before = await analyse(fen, { depth: DEPTH, multipv: 1 });
  const after = await analyse(played.fen, { depth: DEPTH, multipv: 1 });
  if (!before.available || !after.available) {
    // Without an engine, be strict: anything outside the repertoire is wrong.
    return { san: played.san, classification: "mistake", drop: null, refutation: null, engine: false };
  }
  const mover = played.side;
  const pov = (w) => (mover === "white" ? w : 1 - w);
  const drop = Math.max(0, pov(whiteWin(before)) - pov(whiteWin(after)));
  const classification = classify(drop);
  let refutation = null;
  if (classification === "mistake" || classification === "blunder") {
    const best = after.lines?.[0];
    if (best?.san) refutation = { san: best.san, uci: best.uci, from: best.from, to: best.to };
  }
  return {
    san: played.san,
    epd: epdOf(fen),
    classification,
    drop: Math.round(drop * 1000) / 1000,
    refutation,
    engine: true,
  };
}
