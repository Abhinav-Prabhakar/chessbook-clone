#!/usr/bin/env node
/**
 * Download every PGN Mentor player archive (https://www.pgnmentor.com/files.html),
 * de-duplicate the games, and write:
 *
 *  1. <cache>/masters.txt — compact first-24-ply lines for the masters
 *     explorer aggregate (same format as fetch-lichess-games.mjs).
 *  2. server/data/master-games.jsonl.gz — a curated set of complete
 *     master-vs-master games used for model games:
 *        [white, black, whiteElo, blackElo, event, year, result, eco, "san san …"]
 *
 *   node server/tools/fetch-master-games.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createGzip } from "node:zlib";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(homedir(), ".cache", "chessbook-data");
const zipDir = join(cache, "pgnmentor");
mkdirSync(zipDir, { recursive: true });

const MODEL_MIN_ELO = 2500;
const MODEL_LIMIT = 45000;

function listPlayers() {
  const html = execFileSync("curl", ["-s", "https://www.pgnmentor.com/files.html"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return [...new Set([...html.matchAll(/players\/([A-Za-z]+)\.zip/g)].map((m) => m[1]))];
}

function download(player) {
  const file = join(zipDir, `${player}.zip`);
  if (existsSync(file)) return file;
  execFileSync("curl", ["-s", "-f", "-o", file, `https://www.pgnmentor.com/players/${player}.zip`]);
  return file;
}

function* parsePgn(text) {
  let headers = {};
  let moves = [];
  let inMoves = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      if (inMoves) {
        yield { headers, movetext: moves.join(" ") };
        headers = {};
        moves = [];
        inMoves = false;
      }
      const m = /^\[(\w+)\s+"(.*)"\]$/.exec(line);
      if (m) headers[m[1]] = m[2];
      continue;
    }
    if (!line) continue;
    inMoves = true;
    moves.push(line);
  }
  if (moves.length) yield { headers, movetext: moves.join(" ") };
}

function sansOf(movetext) {
  const text = movetext
    .replace(/\{[^}]*\}/g, " ")
    .replace(/;[^\n]*/g, " ")
    .replace(/\$\d+/g, " ");
  // Drop variations (nested parentheses).
  let depth = 0;
  let clean = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) clean += ch;
  }
  const out = [];
  for (let token of clean.split(/\s+/)) {
    if (!token) continue;
    token = token.replace(/^\d+\.(\.\.)?/, "");
    if (!token || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) continue;
    out.push(token.replace(/[?!]+$/, "").replace(/0-0-0/, "O-O-O").replace(/0-0/, "O-O"));
  }
  return out;
}

const players = listPlayers();
console.log(`${players.length} player archives`);
const seen = new Set();
const compact = createWriteStream(join(cache, "masters.txt"));
const modelCandidates = [];
let total = 0;

for (const [index, player] of players.entries()) {
  let text;
  try {
    const file = download(player);
    text = execFileSync("unzip", ["-p", file], { encoding: "latin1", maxBuffer: 512 * 1024 * 1024 });
  } catch (error) {
    console.log(`skip ${player}: ${error.message.split("\n")[0]}`);
    continue;
  }
  let added = 0;
  for (const { headers: h, movetext } of parsePgn(text)) {
    if (h.FEN || (h.SetUp && h.SetUp !== "0")) continue;
    const sans = sansOf(movetext);
    if (sans.length < 10) continue;
    const result = h.Result === "1-0" ? 1 : h.Result === "0-1" ? 0 : h.Result === "1/2-1/2" ? 2 : -1;
    if (result < 0) continue;
    const year = Number(String(h.Date || "").slice(0, 4)) || 0;
    const key = createHash("sha1")
      .update(`${h.White}|${h.Black}|${year}|${sans.slice(0, 40).join(" ")}`)
      .digest("base64");
    if (seen.has(key)) continue;
    seen.add(key);
    total += 1;
    added += 1;
    const we = Number(h.WhiteElo) || 0;
    const be = Number(h.BlackElo) || 0;
    compact.write(`${we} ${be} ${result}\t${sans.slice(0, 24).join(" ")}\n`);

    const event = String(h.Event || "").replace(/\s+/g, " ").trim();
    const fast = /blitz|rapid|bullet|simul|blind|armageddon|960|fischerandom|chess960|exhib|odds|consult|corr|internet|online|lichess|chess\.com|ICC|playchess|titled|speed|banter|bundesliga/i.test(event);
    if (fast || sans.length < 50 || sans.length > 160) continue;
    const strongModern = we >= MODEL_MIN_ELO && be >= MODEL_MIN_ELO && year >= 1975;
    const classic = year > 1850 && year < 1975 && !we && !be;
    if (!strongModern && !classic) continue;
    modelCandidates.push([
      String(h.White || "?"),
      String(h.Black || "?"),
      we || null,
      be || null,
      event || null,
      year || null,
      result === 1 ? "1-0" : result === 0 ? "0-1" : "1/2-1/2",
      h.ECO || null,
      sans.join(" "),
    ]);
  }
  console.log(`[${index + 1}/${players.length}] ${player}: +${added} (total ${total})`);
}
compact.end();

// Classic-era games are kept only when both players have their own archive
// (i.e. the game showed up twice before de-duplication would have hidden it):
// approximate that by requiring both surnames to be in the player list.
const surnames = new Set(players.map((p) => p.toLowerCase()));
const surnameOf = (name) => String(name).split(",")[0].replace(/[^A-Za-z]/g, "").toLowerCase();
const filtered = modelCandidates.filter((g) => {
  if (g[2] && g[3]) return true;
  return surnames.has(surnameOf(g[0])) && surnames.has(surnameOf(g[1]));
});
// Prefer decisive games, then the most recent, to keep instructive material.
filtered.sort((a, b) => {
  const da = a[6] === "1/2-1/2" ? 1 : 0;
  const db = b[6] === "1/2-1/2" ? 1 : 0;
  if (da !== db) return da - db;
  return (b[5] || 0) - (a[5] || 0);
});
const chosen = filtered.slice(0, MODEL_LIMIT);
const gz = createGzip({ level: 9 });
const target = join(here, "..", "data", "master-games.jsonl.gz");
gz.pipe(createWriteStream(target));
for (const game of chosen) gz.write(`${JSON.stringify(game)}\n`);
gz.end();
writeFileSync(
  join(cache, "masters-meta.json"),
  JSON.stringify({ players: players.length, games: total, modelGames: chosen.length })
);
console.log(`done: ${total} unique games, ${chosen.length} model games → ${target}`);
