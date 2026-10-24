#!/usr/bin/env node
/**
 * Stage 2: aggregate compact game lines into an opening explorer snapshot.
 *
 *   node --max-old-space-size=6144 server/tools/build-explorer.mjs \
 *     --dataset=lichess --in=~/.cache/chessbook-data/lichess-2026-09.txt
 *   node server/tools/build-explorer.mjs --dataset=masters --in=~/.cache/chessbook-data/masters.txt
 *
 * Input lines: "<whiteElo> <blackElo> <1|0|2>\t<san> <san> …"
 *
 * Memory stays bounded by walking the tree one depth at a time: a position at
 * depth k is only expanded when it was reached by at least `--min` games, so
 * the long tail of unique games is never held in memory.
 *
 * Output (gzip JSON) matches server/explorer-data.js:
 *   masters: positions[epd] = [games, white, draw, black, [[san, games, w, d, b], …]]
 *   lichess: positions[epd][band] = [games, white, draw, black, [[san, games, w, d, b], …]]
 * Lichess bands use the rating of the player to move.
 */
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";

const here = dirname(fileURLToPath(import.meta.url));
function arg(name, fallback) {
  const hit = process.argv.find((v) => v.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).replace(/^~/, homedir()) : fallback;
}

const dataset = arg("dataset", "lichess");
const input = arg("in", join(homedir(), ".cache", "chessbook-data", `${dataset}.txt`));
const MIN = Number(arg("min", dataset === "masters" ? "4" : "40"));
const MAX_DEPTH = Number(arg("depth", dataset === "masters" ? "24" : "20"));
const MOVE_MIN = Number(arg("moveMin", "2"));
const out = arg("out", join(here, "..", "data", `explorer-${dataset}.json.gz`));
const source = arg("source", dataset === "masters" ? "PGN Mentor player archives" : "Lichess open database");

const BANDS = ["<1200", "1200-1599", "1600-1799", "1800-1999", "2000-2399", "2400+"];
const bandOf = (elo) =>
  elo < 1200 ? 0 : elo < 1600 ? 1 : elo < 1800 ? 2 : elo < 2000 ? 3 : elo < 2400 ? 4 : 5;
const isMasters = dataset === "masters";
const NB = isMasters ? 1 : BANDS.length;

const epdOf = (fen) => fen.split(" ").slice(0, 4).join(" ");

async function eachLine(fn) {
  const rl = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  for await (const line of rl) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    fn(line.slice(0, tab), line.slice(tab + 1));
  }
}

// prefix -> fen for the qualified frontier
let frontier = new Map([["", new Chess().fen()]]);
// epd -> per band: { g, w, d, b, moves: Map(san -> [g,w,d,b]) }
const positions = new Map();
let games = 0;

for (let depth = 0; depth < MAX_DEPTH && frontier.size; depth += 1) {
  const stats = new Map(); // prefix -> Array(NB) of Map(san -> [g,w,d,b])
  const nextCount = new Map();
  await eachLine((meta, movesText) => {
    if (depth === 0) games += 1;
    const sans = movesText.split(" ");
    if (sans.length <= depth) return;
    const prefix = depth === 0 ? "" : sans.slice(0, depth).join(" ");
    if (!frontier.has(prefix)) return;
    const [we, be, r] = meta.split(" ").map(Number);
    const mover = depth % 2 === 0 ? we : be;
    if (isMasters && mover && mover < 2200) return;
    const band = isMasters ? 0 : bandOf(mover);
    let entry = stats.get(prefix);
    if (!entry) {
      entry = Array.from({ length: NB }, () => new Map());
      stats.set(prefix, entry);
    }
    const san = sans[depth];
    let row = entry[band].get(san);
    if (!row) {
      row = [0, 0, 0, 0];
      entry[band].set(san, row);
    }
    row[0] += 1;
    if (r === 1) row[1] += 1;
    else if (r === 2) row[2] += 1;
    else row[3] += 1;
    const key = prefix ? `${prefix} ${san}` : san;
    nextCount.set(key, (nextCount.get(key) || 0) + 1);
  });

  const nextFrontier = new Map();
  for (const [prefix, entry] of stats) {
    const fen = frontier.get(prefix);
    const epd = epdOf(fen);
    let pos = positions.get(epd);
    if (!pos) {
      pos = Array.from({ length: NB }, () => ({ g: 0, w: 0, d: 0, b: 0, moves: new Map() }));
      positions.set(epd, pos);
    }
    const chess = new Chess(fen);
    for (let band = 0; band < NB; band += 1) {
      for (const [san, row] of entry[band]) {
        let normalized = san;
        let childFen = null;
        try {
          const move = chess.move(san);
          normalized = move.san;
          childFen = chess.fen();
          chess.undo();
        } catch {
          continue;
        }
        const p = pos[band];
        p.g += row[0];
        p.w += row[1];
        p.d += row[2];
        p.b += row[3];
        const m = p.moves.get(normalized) || [0, 0, 0, 0];
        for (let i = 0; i < 4; i += 1) m[i] += row[i];
        p.moves.set(normalized, m);
        const key = prefix ? `${prefix} ${san}` : san;
        if (!nextFrontier.has(key) && (nextCount.get(key) || 0) >= MIN) nextFrontier.set(key, childFen);
      }
    }
  }
  console.log(`depth ${depth}: ${stats.size} positions expanded, ${nextFrontier.size} qualify next (${positions.size} epds)`);
  frontier = nextFrontier;
}

const payloadPositions = {};
let moveRows = 0;
for (const [epd, bands] of positions) {
  const encode = (p) => {
    const moves = [...p.moves.entries()]
      .filter(([, m]) => m[0] >= MOVE_MIN || m[0] / Math.max(1, p.g) >= 0.02)
      .sort((a, b) => b[1][0] - a[1][0])
      .slice(0, 16)
      .map(([san, m]) => [san, ...m]);
    moveRows += moves.length;
    return [p.g, p.w, p.d, p.b, moves];
  };
  if (isMasters) {
    if (bands[0].g >= MIN) payloadPositions[epd] = encode(bands[0]);
  } else {
    const total = bands.reduce((sum, p) => sum + p.g, 0);
    if (total < MIN) continue;
    const entry = {};
    bands.forEach((p, i) => {
      if (p.g > 0) entry[BANDS[i]] = encode(p);
    });
    payloadPositions[epd] = entry;
  }
}

const body = JSON.stringify(payloadPositions);
const version = createHash("sha1").update(body).digest("hex").slice(0, 16);
let extraMeta = {};
try {
  extraMeta = JSON.parse(readFileSync(input.replace(/\.txt$/, "-meta.json"), "utf8"));
} catch {}
const payload = {
  meta: {
    dataset,
    version,
    source,
    games,
    positions: Object.keys(payloadPositions).length,
    moves: moveRows,
    minGames: MIN,
    maxDepth: MAX_DEPTH,
    bands: isMasters ? null : BANDS,
    bandBasis: isMasters ? null : "rating of the player to move",
    generatedAt: new Date().toISOString(),
    ...extraMeta,
  },
  positions: payloadPositions,
};
const gz = gzipSync(JSON.stringify(payload), { level: 9 });
writeFileSync(out, gz);
console.log(`wrote ${out}: ${payload.meta.positions} positions, ${moveRows} moves, ${games} games, ${(gz.length / 1e6).toFixed(1)} MB`);
