#!/usr/bin/env node
/**
 * Stage 1 of the peer explorer build.
 *
 * Streams the start of a Lichess monthly database (CC0, database.lichess.org)
 * and writes one compact line per blitz/rapid/classical game:
 *
 *   <whiteElo> <blackElo> <result 1|0|2(draw)>\t<san> <san> ... (first 24 plies)
 *
 * Only the first `--bytes` of the compressed file are downloaded, so a 30 GB
 * month never touches the disk.
 *
 *   node server/tools/fetch-lichess-games.mjs --month=2026-09 --bytes=1500000000 \
 *     --out=$TMPDIR/chessbook-data/lichess-2026-09.txt
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";

function arg(name, fallback) {
  const hit = process.argv.find((v) => v.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const month = arg("month", "2026-09");
const bytes = Number(arg("bytes", "1500000000"));
const maxPly = Number(arg("plies", "24"));
const out = arg("out", join(tmpdir(), "chessbook-data", `lichess-${month}.txt`));
mkdirSync(dirname(out), { recursive: true });

const url = `https://database.lichess.org/standard/lichess_db_standard_rated_${month}.pgn.zst`;
const curl = spawn("curl", ["-s", "-r", `0-${bytes - 1}`, url]);
const zstd = spawn("zstd", ["-dc"], { stdio: ["pipe", "pipe", "ignore"] });
curl.stdout.pipe(zstd.stdin);
zstd.stdin.on("error", () => {});

const sink = createWriteStream(out);
const rl = createInterface({ input: zstd.stdout, crlfDelay: Infinity });

let header = {};
let kept = 0;
let seen = 0;
const started = Date.now();

const keepEvent = (event) =>
  /^Rated (Blitz|Rapid|Classical) game/.test(event || "");

rl.on("line", (line) => {
  if (line.startsWith("[")) {
    const m = /^\[(\w+) "(.*)"\]$/.exec(line);
    if (m) header[m[1]] = m[2];
    return;
  }
  if (!line.trim() || !header.Event) return;
  if (!/^1\. /.test(line)) return;
  seen += 1;
  const h = header;
  header = {};
  if (!keepEvent(h.Event)) return;
  const we = Number(h.WhiteElo);
  const be = Number(h.BlackElo);
  if (!we || !be) return;
  const result = h.Result === "1-0" ? 1 : h.Result === "0-1" ? 0 : h.Result === "1/2-1/2" ? 2 : -1;
  if (result < 0) return;
  const text = line.replace(/\{[^}]*\}/g, " ");
  const sans = [];
  for (const token of text.split(/\s+/)) {
    if (!token || /^\d+\.+$/.test(token) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) continue;
    sans.push(token.replace(/[?!]+$/, ""));
    if (sans.length >= maxPly) break;
  }
  if (sans.length < 2) return;
  sink.write(`${we} ${be} ${result}\t${sans.join(" ")}\n`);
  kept += 1;
  if (kept % 200000 === 0) {
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`${kept} kept / ${seen} games · ${secs}s`);
  }
});

rl.on("close", () => {
  sink.end(() => {
    console.log(`done: ${kept} games kept of ${seen} → ${out}`);
  });
});
