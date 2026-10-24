/**
 * First-run state: a small, coherent 1.e4 repertoire for White (one move of
 * yours per position, as a real repertoire has) and an empty Black
 * repertoire. Nothing has been practised yet.
 */
import { db, getMeta, setMeta } from "./db.js";
import { addLine, createRepertoire } from "./repertoire.js";

export const STARTER_WHITE = [
  "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3",
  "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4",
  "e4 c5 Nf3 e6 d4 cxd4 Nxd4",
  "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3",
  "e4 e5 Nf3 Nc6 Bc4 Nf6 d3",
  "e4 e6 d4 d5 Nc3",
  "e4 c6 d4 d5 Nc3",
  "e4 d5 exd5 Qxd5 Nc3",
];

export function seedIfEmpty() {
  if (getMeta("seeded")) return false;
  const count = db.prepare("SELECT COUNT(*) AS n FROM repertoires").get().n;
  if (count === 0) {
    const white = createRepertoire({ name: "White openings", color: "white" });
    for (const line of STARTER_WHITE) addLine(white.id, line.split(" "), { source: "seed" });
    createRepertoire({ name: "Black openings", color: "black" });
  }
  setMeta("seeded", new Date().toISOString());
  return true;
}
