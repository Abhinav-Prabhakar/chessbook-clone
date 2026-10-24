/**
 * Short explanations for common opening moves (server/data/move-notes.json),
 * keyed by the position before the move and the move itself.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./db.js";
import { replay } from "./chess.js";

let notes = null;

function load() {
  notes = new Map();
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, "move-notes.json"), "utf8"));
    for (const [path, note] of Object.entries(raw)) {
      try {
        const { steps } = replay(path.split(" "));
        const last = steps[steps.length - 1];
        notes.set(`${last.epdBefore}|${last.san}`, note);
      } catch {
        // skip malformed keys
      }
    }
  } catch {
    // no notes file
  }
}

export function builtinNote(epd, san) {
  if (!notes) load();
  return notes.get(`${epd}|${san}`) || null;
}
