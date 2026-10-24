import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { startTestServer } from "./helpers.js";

const q = (value) => encodeURIComponent(value);

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -";

function epdOfPath(path) {
  const chess = new Chess();
  for (const san of path.split(" ").filter(Boolean)) chess.move(san);
  return chess.fen().split(" ").slice(0, 4).join(" ");
}

let ctx;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  if (ctx) await ctx.close();
});

test("the committed explorer snapshots are imported with provenance", async () => {
  const { explorerStatus, explorerPosition, explorerMoveShare } = await import(
    "../../server/explorer-data.js"
  );
  const status = explorerStatus(ctx.db);
  assert.equal(status.available, true);
  assert.equal(status.imports.length, 2);
  const masters = status.imports.find((row) => row.dataset === "masters");
  const lichess = status.imports.find((row) => row.dataset === "lichess");
  assert.ok(masters.games > 50_000);
  assert.ok(lichess.games > 300_000);
  assert.ok(masters.positions > 4_000);
  assert.ok(lichess.positions > 4_000);
  assert.match(masters.source, /pgnmentor/);
  assert.match(lichess.source, /lichess/);
  assert.ok(masters.version);
  assert.ok(lichess.version);

  const position = explorerPosition(ctx.db, AFTER_E4, { band: "1800-1999" });
  assert.equal(position.available, true);
  assert.ok(position.masters.games > 10_000);
  assert.ok(position.band.games > 1_000);
  assert.ok(position.masters.moves.get("c5"));
  assert.ok(position.band.moves.get("c5"));
  const share = explorerMoveShare(ctx.db, AFTER_E4, "c5", { band: "1800-1999" });
  assert.ok(share > 0 && share < 1);
});

test("captured production data stays authoritative for Black after 1.e4", async () => {
  const body = await ctx.apiOk(
    "GET",
    `/repertoires/black/candidates?moves=e4`
  );
  assert.equal(body.available, true);
  assert.deepEqual(
    body.candidates.slice(0, 5).map((candidate) => candidate.san),
    ["c5", "e5", "e6", "c6", "d5"]
  );
  const c5 = body.candidates[0];
  // Captured values (recon) win over the larger offline corpus.
  assert.match(c5.source, /^recon\//);
  assert.equal(c5.masters, 42.7);
  assert.equal(c5.peers.white, 48.5);
  assert.equal(c5.incidence, 0.2938162088394165);
  assert.equal(c5.eval, 45);
  assert.equal(body.sources.captured, c5.source);
  assert.ok(body.position.ratingBand.profile.matches);
});

test("a seeded position without a capture gets real masters, peers, incidence and Stockfish eval", async () => {
  const body = await ctx.apiOk(
    "GET",
    `/repertoires/black/candidates?moves=${q("d4 d5 c4")}`
  );
  assert.equal(body.available, true);
  assert.equal(body.position.epd, epdOfPath("d4 d5 c4"));
  assert.ok(body.candidates.length >= 5);
  assert.ok(body.sources.masters);
  assert.ok(body.sources.lichess);
  assert.equal(body.sources.engine, "stockfish");
  assert.ok(body.position.stockfish.eval != null);
  assert.equal(body.position.stockfish.source, "stockfish");
  assert.ok(body.position.games.masters > 0);
  assert.ok(body.position.games.band > 0);

  const top = body.candidates[0];
  assert.ok(["e6", "c6", "dxc4"].includes(top.san));
  assert.ok(top.masters > 0);
  assert.ok(top.peers);
  assert.ok(top.peers.white + top.peers.draw + top.peers.black > 99);
  assert.ok(top.incidence > 0);
  assert.ok(top.oneIn >= 1);
  assert.ok(top.evalAvailable);
  assert.equal(top.evalSource, "stockfish");
  assert.ok(Number.isFinite(top.eval));
  assert.ok(top.openingName);
  assert.equal(top.games > 0, true);
  // Candidate evals are persisted for repeat views.
  const cached = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM engine_evals")
    .get().n;
  assert.ok(cached > 0);
  const stored = ctx.db
    .prepare("SELECT * FROM engine_evals ORDER BY created_at DESC LIMIT 1")
    .get();
  assert.equal(stored.engine, "Stockfish 19 Lite WASM (Stockfish 19)");
  assert.ok(Number.isFinite(Number(stored.cp)));
});

test("gap and position detail use the same merged data", async () => {
  const gap = await ctx.apiOk(
    "GET",
    `/repertoires/black/gap?moves=${q("d4 d5 c4")}`
  );
  assert.equal(gap.available, true);
  assert.ok(gap.candidates.length > 0);
  assert.ok(gap.candidates[0].evalAvailable);
  assert.equal(gap.candidateSource, "lichess-band");
  assert.ok(gap.position.incidence > 0);
  assert.ok(gap.position.oneIn >= 1);

  const position = await ctx.apiOk(
    "GET",
    `/repertoires/black/position?epd=${q(epdOfPath("d4 d5 c4"))}`
  );
  assert.ok(position.position.candidates.length > 0);
  assert.ok(position.position.stockfish.eval != null);
  assert.equal(position.position.engineAvailable, true);
});

test("learn merges captured common moves with the offline explorer", async () => {
  const learn = await ctx.apiOk("GET", "/repertoires/white/learn");
  assert.ok(learn.common > 0);
  assert.match(learn.commonSource, /captured-position-incidence/);
  assert.match(learn.commonSource, /offline-explorer/);
  assert.ok(learn.commonMoves.some((entry) => entry.source === "offline-explorer"));
});

test("positions absent from every source are explicitly unavailable", async () => {
  const composed = "8/8/8/8/8/8/8/K6k w - - 0 1";
  const body = await ctx.apiOk(
    "GET",
    `/repertoires/white/candidates?fen=${q(composed)}`
  );
  assert.equal(body.available, false);
  assert.deepEqual(body.candidates, []);
  assert.ok(body.unavailableReason);
});

test("engine status and eval endpoints expose real Stockfish output", async () => {
  const state = await ctx.apiOk("GET", "/engine/status");
  assert.equal(state.stockfish, true);
  assert.match(state.engine.name, /Stockfish 19/);
  assert.ok(state.explorer.available);

  const evaluation = await ctx.apiOk(
    "GET",
    `/engine/eval?fen=${q(START)}&depth=8&multipv=3`
  );
  assert.equal(evaluation.stockfish, true);
  assert.equal(evaluation.source, "stockfish");
  assert.match(evaluation.engine.name, /Stockfish 19/);
  assert.equal(evaluation.lines.length, 3);
  const chess = new Chess(START);
  const best = chess.move(evaluation.bestSan);
  assert.ok(best.from && best.to);
  assert.ok(Number.isFinite(evaluation.evalCp));

  const invalid = await ctx.api("GET", "/engine/eval?fen=not-a-fen");
  assert.equal(invalid.status, 400);
});
