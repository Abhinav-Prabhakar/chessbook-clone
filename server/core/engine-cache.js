import { db } from "./db.js";
import { analyse } from "../engine.js";
import { epdOf } from "./chess.js";

const pending = new Map();
const DEPTH = 14;
const MULTIPV = 8;

/** Stockfish multi-line analysis of a position, cached in SQLite by EPD. */
export async function positionEval(fen) {
  const epd = epdOf(fen);
  const row = db.prepare("SELECT json, depth FROM engine_cache WHERE epd = ?").get(epd);
  if (row && row.depth >= DEPTH) return JSON.parse(row.json);
  if (pending.has(epd)) return pending.get(epd);
  const job = (async () => {
    const result = await analyse(fen, { depth: DEPTH, multipv: MULTIPV });
    if (!result.available) return null;
    const value = {
      depth: result.depth,
      // Evaluations are from White's point of view, in pawns.
      eval: result.mate != null ? null : (result.evalCp ?? 0) / 100,
      mate: result.mate ?? null,
      best: result.bestSan,
      moves: result.lines.map((line) => ({
        san: line.san,
        eval: line.mate != null ? null : (line.cp ?? 0) / 100,
        mate: line.mate ?? null,
        pv: (line.pvSans || []).slice(0, 6),
      })),
    };
    db.prepare(
      "INSERT INTO engine_cache (epd, depth, json) VALUES (?, ?, ?) ON CONFLICT(epd) DO UPDATE SET depth = excluded.depth, json = excluded.json"
    ).run(epd, result.depth, JSON.stringify(value));
    return value;
  })().finally(() => pending.delete(epd));
  pending.set(epd, job);
  return job;
}

export function cachedEval(fen) {
  const row = db.prepare("SELECT json FROM engine_cache WHERE epd = ?").get(epdOf(fen));
  return row ? JSON.parse(row.json) : null;
}
