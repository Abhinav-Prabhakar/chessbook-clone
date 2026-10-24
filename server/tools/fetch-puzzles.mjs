#!/usr/bin/env node
/**
 * Build server/data/puzzles.csv.gz from the Lichess puzzle database
 * (CC0, https://database.lichess.org/#puzzles).
 *
 * The full file is ~300 MB compressed; it is streamed, never stored. We keep
 * well-rated, popular puzzles that arise early enough to belong to an opening
 * (Lichess tags each puzzle with the opening of the source game), capped per
 * opening family so every family is represented.
 *
 * Output columns (no header):
 *   id,fen,moves,rating,popularity,plays,themes,openingTags
 *
 * `fen` is the position *before* the opponent's blundering move; `moves[0]`
 * is that blunder and the remaining moves are the solution (UCI).
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "data", "puzzles.csv.gz");
const PER_FAMILY = Number(process.env.PER_FAMILY || 400);
const MAX_FULLMOVE = 22;

const url = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const curl = spawn("curl", ["-s", url]);
const zstd = spawn("zstd", ["-dc"], { stdio: ["pipe", "pipe", "ignore"] });
curl.stdout.pipe(zstd.stdin);
zstd.stdin.on("error", () => {});

const gzip = createGzip({ level: 9 });
gzip.pipe(createWriteStream(out));

const perFamily = new Map();
let kept = 0;
let seen = 0;
const rl = createInterface({ input: zstd.stdout, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (line.startsWith("PuzzleId")) return;
  seen += 1;
  const c = line.split(",");
  if (c.length < 10) return;
  const [id, fen, moves, rating, deviation, popularity, plays, themes, , openingTags] = c;
  if (!openingTags) return;
  if (Number(popularity) < 88 || Number(plays) < 400 || Number(deviation) > 90) return;
  const fullmove = Number(fen.split(" ")[5]);
  if (!(fullmove <= MAX_FULLMOVE)) return;
  const family = openingTags.split(" ")[0];
  const count = perFamily.get(family) || 0;
  if (count >= PER_FAMILY) return;
  perFamily.set(family, count + 1);
  gzip.write(`${id},${fen},${moves},${rating},${popularity},${plays},${themes},${openingTags}\n`);
  kept += 1;
});
rl.on("close", () => {
  gzip.end();
  console.log(`kept ${kept} of ${seen} puzzles across ${perFamily.size} opening families → ${out}`);
});
