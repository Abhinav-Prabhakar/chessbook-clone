#!/usr/bin/env node
/**
 * Build the offline opening-explorer snapshots.
 *
 *   node server/tools/build-explorer-data.mjs
 *   node server/tools/build-explorer-data.mjs --months=2013-01,2013-02
 *   node server/tools/build-explorer-data.mjs --players=Carlsen,Kasparov
 *
 * Sources:
 *  - Masters: PGN Mentor player archives (https://www.pgnmentor.com/players/).
 *  - Peers: Lichess standard rated monthly PGN dumps
 *    (https://database.lichess.org/standard/).
 *
 * Only positions relevant to this app are aggregated: every EPD along every
 * ECO line in server/data/{a,b,c,d,e}.tsv up to `MAX_PLY` plies, plus every
 * seeded repertoire line position. That keeps the committed snapshots small
 * and makes lookups a dictionary hit.
 *
 * Output (compact JSON, no pretty-printing):
 *   server/data/explorer-masters.json
 *   server/data/explorer-lichess.json
 *
 * Downloads are cached in the OS temp directory, never in the repo.
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { createZstdDecompress } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { Chess } from "chess.js";
import { seedLineSans } from "../seed-lines.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const dataDir = join(root, "server", "data");
const cacheDir = join(tmpdir(), "chessbook-explorer-cache");
mkdirSync(cacheDir, { recursive: true });

const MAX_PLY = 14;
const MASTERS_MAX_MOVES = 24;
const LICHESS_MAX_MOVES = 16;

const DEFAULT_PLAYERS = [
  "Carlsen",
  "Kasparov",
  "Anand",
  "Karpov",
  "Fischer",
  "Tal",
  "Kramnik",
  "Caruana",
  "Nakamura",
  "Ding",
  "Firouzja",
  "So",
  "Aronian",
  "Topalov",
  "Ivanchuk",
  "Short",
];

const BANDS = ["<1200", "1200-1599", "1600-1799", "1800-1999", "2000-2399", "2400+"];

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const PLAYERS = String(arg("players", DEFAULT_PLAYERS.join(",")))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const MONTHS = String(arg("months", "2013-01"))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const FORCE = process.argv.includes("--force-download");

const EPDS = (fen) => String(fen).split(" ").slice(0, 4).join(" ");
const RESULT = {
  "1-0": { white: 1, draw: 0, black: 0, key: "white" },
  "0-1": { white: 0, draw: 0, black: 1, key: "black" },
  "1/2-1/2": { white: 0, draw: 1, black: 0, key: "draw" },
  "0.5-0.5": { white: 0, draw: 1, black: 0, key: "draw" },
};

function bandOfElo(value) {
  const elo = Number(value);
  if (!Number.isFinite(elo) || elo <= 0) return null;
  if (elo < 1200) return "<1200";
  if (elo < 1600) return "1200-1599";
  if (elo < 1800) return "1600-1799";
  if (elo < 2000) return "1800-1999";
  if (elo < 2400) return "2000-2399";
  return "2400+";
}

/* ------------------------------------------------------------- targets --- */

function readTsvLines() {
  const rows = [];
  for (const letter of ["a", "b", "c", "d", "e"]) {
    const text = readFileSync(join(dataDir, `${letter}.tsv`), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("eco\t")) continue;
      const [eco, name, pgn] = line.split("\t");
      if (!pgn) continue;
      try {
        const chess = new Chess();
        chess.loadPgn(pgn, { sloppy: true });
        const sans = chess.history();
        if (sans.length) rows.push({ eco, name, sans });
      } catch {
        // Ignore malformed ECO rows.
      }
    }
  }
  return rows;
}

function buildTargets() {
  const targets = new Map(); // epd -> {line, ply, name}
  const names = new Map(); // epd -> Map(name -> {terminal, passes, length})
  const lines = readTsvLines();

  const addName = (epd, name, terminal) => {
    if (!name) return;
    let scores = names.get(epd);
    if (!scores) {
      scores = new Map();
      names.set(epd, scores);
    }
    const entry = scores.get(name) || { terminal: 0, passes: 0, length: name.length };
    if (terminal) entry.terminal += 1;
    else entry.passes += 1;
    scores.set(name, entry);
  };

  for (const row of lines) {
    const chess = new Chess();
    for (let ply = 0; ply <= Math.min(MAX_PLY, row.sans.length); ply += 1) {
      const epd = EPDS(chess.fen());
      const existing = targets.get(epd);
      if (!existing || ply < existing.ply) {
        targets.set(epd, { name: row.name, ply, eco: row.eco });
      }
      addName(epd, row.name, ply === row.sans.length);
      if (ply === row.sans.length) break;
      try {
        chess.move(row.sans[ply]);
      } catch {
        break;
      }
    }
  }

  // Seed repertoire lines are targets even when the ECO TSV ends earlier.
  for (const sans of seedLineSans()) {
    const chess = new Chess();
    for (let ply = 0; ply <= Math.min(MAX_PLY, sans.length); ply += 1) {
      const epd = EPDS(chess.fen());
      if (!targets.has(epd)) targets.set(epd, { name: null, ply, eco: null });
      if (ply === sans.length) break;
      try {
        chess.move(sans[ply]);
      } catch {
        break;
      }
    }
  }

  // The starting position has no ECO row that ends there.
  targets.set(EPDS(new Chess().fen()), { name: "Starting position", ply: 0, eco: null });
  addName(EPDS(new Chess().fen()), "Starting position", true);

  // Choose the most common *terminal* name per EPD, then the most common
  // passing name, then the shortest/lexicographically first.
  const chosen = new Map();
  for (const [epd, scores] of names) {
    const ranked = [...scores.entries()].sort(
      ([nameA, a], [nameB, b]) =>
        b.terminal - a.terminal ||
        b.passes - a.passes ||
        a.length - b.length ||
        nameA.localeCompare(nameB)
    );
    if (ranked.length) chosen.set(epd, ranked[0][0]);
  }
  return { targets: new Set(targets.keys()), names: chosen, targetCount: targets.size, lineCount: lines.length };
}

/* --------------------------------------------------------------- PGN IO --- */

async function download(url, file, { label = url } = {}) {
  if (!FORCE && existsSync(file) && statSync(file).size > 0) {
    console.log(`[cache] ${label} (${(statSync(file).size / 1e6).toFixed(1)} MB)`);
    return { file, bytes: statSync(file).size, cached: true };
  }
  console.log(`[download] ${label}`);
  const response = await fetch(url, {
    headers: { "user-agent": "chessbook-local-explorer-builder/1.0" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`${url} -> HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
  return { file, bytes: statSync(file).size, cached: false };
}

function stripMovetext(text) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") {
      const end = text.indexOf("}", i + 1);
      i = end >= 0 ? end : text.length;
      out += " ";
      continue;
    }
    if (ch === ";") {
      const end = text.indexOf("\n", i + 1);
      i = end >= 0 ? end : text.length;
      out += " ";
      continue;
    }
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (depth > 0) continue;
    out += ch;
  }
  return out;
}

function movesOf(movetext) {
  const cleaned = stripMovetext(movetext)
    .replace(/\$\d+/g, " ")
    .replace(/[!?]+/g, "")
    .replace(/0-0-0/g, "O-O-O")
    .replace(/0-0/g, "O-O")
    .replace(/\r?\n/g, " ");
  const tokens = [];
  for (let raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    raw = raw.replace(/^\d+\.(\.\.)?/, "");
    if (!raw || raw === "..." || raw === ".." || raw === "*") continue;
    if (/^\d+-\d+$/.test(raw) || /^\d+\/\d+-\d+\/\d+$/.test(raw)) continue;
    if (raw === "e.p." || raw === "--" || raw === "Z0") continue;
    tokens.push(raw);
  }
  return tokens;
}

async function* gamesFromStream(stream) {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let headers = {};
  let movetext = [];
  let started = false;
  for await (const line of rl) {
    if (line.startsWith("[Event ")) {
      if (started) {
        yield { headers, movetext: movetext.join(" ") };
        headers = {};
        movetext = [];
      }
      started = true;
    }
    if (line.startsWith("[")) {
      const match = /^\[(\w+)\s+"(.*)"\]\s*$/.exec(line);
      if (match) headers[match[1]] = match[2];
      continue;
    }
    if (started) movetext.push(line);
  }
  if (started) yield { headers, movetext: movetext.join(" ") };
}

function readGameStream(file, { zstd = false } = {}) {
  const input = createReadStream(file);
  const stream = zstd ? input.pipe(createZstdDecompress()) : input;
  return gamesFromStream(stream);
}

function unzipPgn(zipPath) {
  // `unzip -p` writes the (single) PGN entry to stdout; archives from PGN
  // Mentor contain exactly one PGN per player.
  const buffer = execFileSync("unzip", ["-p", zipPath], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return Readable.from(buffer);
}

/* --------------------------------------------------------- aggregation --- */

function emptyAgg() {
  return { games: 0, white: 0, draw: 0, black: 0, moves: new Map() };
}

function recordPosition(agg, result, san) {
  agg.games += 1;
  agg.white += result.white;
  agg.draw += result.draw;
  agg.black += result.black;
  const key = String(san);
  let move = agg.moves.get(key);
  if (!move) {
    move = { san: key, games: 0, white: 0, draw: 0, black: 0 };
    agg.moves.set(key, move);
  }
  move.games += 1;
  move.white += result.white;
  move.draw += result.draw;
  move.black += result.black;
}

/**
 * Walk one game only as far as it stays in the target set. The first few
 * plies are the only ones that can match an opening prefix; leaving the set
 * for several plies means no later position can re-enter it in practice
 * (transpositions this deep are vanishingly rare and not worth the cost).
 */
function walkGame(game, targetSet, onPosition, { maxPly = MAX_PLY, offTargetLimit = 4 } = {}) {
  const chess = new Chess();
  const tokens = game.tokens;
  let offTarget = 0;
  for (let ply = 0; ply < tokens.length && ply <= maxPly; ply += 1) {
    const epd = EPDS(chess.fen());
    if (targetSet.has(epd)) {
      offTarget = 0;
      onPosition({ chess, epd, san: tokens[ply], ply });
    } else {
      offTarget += 1;
      if (offTarget > offTargetLimit) return ply;
    }
    try {
      chess.move(tokens[ply]);
    } catch {
      return ply;
    }
  }
  return Math.min(tokens.length, maxPly + 1);
}

function finalizeMoves(moves, limit) {
  return [...moves.values()]
    .sort((a, b) => b.games - a.games || a.san.localeCompare(b.san))
    .slice(0, limit)
    .map((move) => [move.san, move.games, move.white, move.draw, move.black]);
}

/* ----------------------------------------------------------------- main --- */

async function buildMasters(targets) {
  const positions = new Map();
  const players = [];
  const urls = [];
  let games = 0;
  let skipped = 0;

  for (const player of PLAYERS) {
    const url = `https://www.pgnmentor.com/players/${player}.zip`;
    const file = join(cacheDir, `${player}.zip`);
    let downloadInfo;
    try {
      downloadInfo = await download(url, file, { label: `${player}.zip` });
    } catch (error) {
      console.warn(`[masters] skip ${player}: ${error.message}`);
      skipped += 1;
      continue;
    }
    urls.push({ url, bytes: downloadInfo.bytes, player, cached: downloadInfo.cached });

    const stream = unzipPgn(file);
    let playerGames = 0;
    for await (const game of gamesFromStream(stream)) {
      const result = RESULT[game.headers.Result];
      if (!result) continue;
      const tokens = movesOf(game.movetext);
      if (tokens.length < 2) continue;
      walkGame({ tokens }, targets, ({ epd, san }) => {
        let agg = positions.get(epd);
        if (!agg) {
          agg = emptyAgg();
          positions.set(epd, agg);
        }
        recordPosition(agg, result, san);
      });
      playerGames += 1;
      games += 1;
    }
    players.push({ player, url, games: playerGames, bytes: downloadInfo.bytes });
    console.log(`[masters] ${player}: ${playerGames.toLocaleString()} games`);
  }

  const serialized = {};
  let moveCount = 0;
  let positionsWithData = 0;
  for (const epd of [...positions.keys()].sort()) {
    const agg = positions.get(epd);
    if (!agg.games) continue;
    positionsWithData += 1;
    const moves = finalizeMoves(agg.moves, MASTERS_MAX_MOVES);
    moveCount += moves.length;
    serialized[epd] = [agg.games, agg.white, agg.draw, agg.black, moves];
  }
  return {
    positions: serialized,
    moveCount,
    positionsWithData,
    games,
    skipped,
    provenance: {
      dataset: "masters",
      source: "PGN Mentor player archives",
      sourceUrl: "https://www.pgnmentor.com/players/",
      players,
      archives: urls,
      skippedPlayers: skipped,
    },
  };
}

async function buildLichess(targets) {
  const positions = new Map(); // epd -> Map(band -> agg)
  const months = [];
  let games = 0;

  for (const month of MONTHS) {
    const url = `https://database.lichess.org/standard/lichess_db_standard_rated_${month}.pgn.zst`;
    const file = join(cacheDir, `lichess-${month}.pgn.zst`);
    const downloadInfo = await download(url, file, { label: `lichess ${month}` });
    const stream = readGameStream(file, { zstd: true });
    let monthGames = 0;

    for await (const game of stream) {
      monthGames += 1;
      const result = RESULT[game.headers.Result];
      if (!result) continue;
      const tokens = movesOf(game.movetext);
      if (tokens.length < 2) continue;

      walkGame({ tokens }, targets, ({ chess, epd, san }) => {
        const turn = chess.turn();
        const elo = turn === "w" ? game.headers.WhiteElo : game.headers.BlackElo;
        const band = bandOfElo(elo);
        if (!band) return;
        let byBand = positions.get(epd);
        if (!byBand) {
          byBand = new Map();
          positions.set(epd, byBand);
        }
        let agg = byBand.get(band);
        if (!agg) {
          agg = emptyAgg();
          byBand.set(band, agg);
        }
        recordPosition(agg, result, san);
      });
      games += 1;
    }

    months.push({ month, url, games: monthGames, bytes: downloadInfo.bytes, cached: downloadInfo.cached });
    console.log(`[lichess] ${month}: ${monthGames.toLocaleString()} games`);
  }

  const serialized = {};
  let moveCount = 0;
  let positionsWithData = 0;
  for (const epd of [...positions.keys()].sort()) {
    const byBand = positions.get(epd);
    const bands = {};
    let any = false;
    for (const band of BANDS) {
      const agg = byBand.get(band);
      if (!agg || !agg.games) continue;
      any = true;
      const moves = finalizeMoves(agg.moves, LICHESS_MAX_MOVES);
      moveCount += moves.length;
      bands[band] = [agg.games, agg.white, agg.draw, agg.black, moves];
    }
    if (any) {
      serialized[epd] = bands;
      positionsWithData += 1;
    }
  }
  return {
    positions: serialized,
    moveCount,
    positionsWithData,
    games,
    provenance: {
      dataset: "lichess",
      source: "Lichess standard rated monthly PGN dumps",
      sourceUrl: "https://database.lichess.org/standard/",
      months,
      bands: BANDS,
      bandBasis: "rating of the side to move",
    },
  };
}

function writeSnapshot(name, payload) {
  mkdirSync(dataDir, { recursive: true });
  const text = JSON.stringify(payload);
  const file = join(dataDir, name);
  writeFileSync(file, text);
  const bytes = statSync(file).size;
  console.log(`[write] ${name} ${(bytes / 1e6).toFixed(2)} MB`);
  return { file, bytes, version: payload.meta.version };
}

async function main() {
  const started = Date.now();
  console.log(`[build] targets from ECO TSVs + seed lines (max ${MAX_PLY} plies)`);
  const { targets, names, targetCount, lineCount } = buildTargets();
  console.log(`[build] ${lineCount.toLocaleString()} ECO lines -> ${targetCount.toLocaleString()} target EPDs`);

  const generatedAt = new Date().toISOString();

  const masters = await buildMasters(targets);
  const mastersVersion = createHash("sha1")
    .update(JSON.stringify(masters.positions))
    .update(JSON.stringify(Object.fromEntries([...names.entries()].sort(([a], [b]) => a.localeCompare(b)))))
    .digest("hex")
    .slice(0, 16);
  const mastersPayload = {
    _provenance: masters.provenance,
    meta: {
      dataset: "masters",
      version: mastersVersion,
      generatedAt,
      maxPly: MAX_PLY,
      targetPositions: targetCount,
      positionsWithData: masters.positionsWithData,
      moves: masters.moveCount,
      games: masters.games,
      sources: [masters.provenance.sourceUrl],
      players: masters.provenance.players.map((item) => item.player),
      note: "Aggregated from public PGN Mentor player archives; only app-relevant EPDs are stored.",
    },
    names: Object.fromEntries([...names.entries()].sort(([a], [b]) => a.localeCompare(b))),
    positions: masters.positions,
  };
  const mastersFile = writeSnapshot("explorer-masters.json", mastersPayload);

  const lichess = await buildLichess(targets);
  const lichessVersion = createHash("sha1")
    .update(JSON.stringify(lichess.positions))
    .digest("hex")
    .slice(0, 16);
  const lichessPayload = {
    _provenance: lichess.provenance,
    meta: {
      dataset: "lichess",
      version: lichessVersion,
      generatedAt,
      maxPly: MAX_PLY,
      targetPositions: targetCount,
      positionsWithData: lichess.positionsWithData,
      moves: lichess.moveCount,
      games: lichess.games,
      months: MONTHS,
      bands: BANDS,
      sources: lichess.provenance.months.map((item) => item.url),
      note: "Aggregated from Lichess standard rated dumps; band = rating of the side to move.",
    },
    positions: lichess.positions,
  };
  const lichessFile = writeSnapshot("explorer-lichess.json", lichessPayload);

  const totalBytes = mastersFile.bytes + lichessFile.bytes;
  console.log(
    `[done] ${(totalBytes / 1e6).toFixed(2)} MB total in ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
  console.log(
    JSON.stringify(
      {
        masters: {
          version: mastersVersion,
          games: masters.games,
          positions: masters.positionsWithData,
          moves: masters.moveCount,
          bytes: mastersFile.bytes,
        },
        lichess: {
          version: lichessVersion,
          games: lichess.games,
          positions: lichess.positionsWithData,
          moves: lichess.moveCount,
          bytes: lichessFile.bytes,
        },
      },
      null,
      2
    )
  );
}

await main();
