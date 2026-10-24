/**
 * API tests against a real server and a throwaway database.
 * The bundled opening data is imported (≈10 s); master games are skipped.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "chessbook-test-"));
process.env.CHESSBOOK_DB = join(dir, "test.db");
process.env.NODE_ENV = "test";

let server;
let base;

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
const get = (p) => call("GET", p);
const post = (p, b) => call("POST", p, b ?? {});

before(async () => {
  const { createApp } = await import("../server/index.js");
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  const { close } = await import("../server/engine.js");
  await close();
  rmSync(dir, { recursive: true, force: true });
});

describe("starter repertoires", () => {
  test("white has one move of yours per position; black starts empty", async () => {
    const { body } = await get("/repertoires");
    const [white, black] = body.repertoires;
    assert.equal(white.color, "white");
    assert.equal(black.color, "black");
    assert.equal(black.stats.saved, 0);
    assert.equal(black.started, false);
    assert.ok(white.stats.mine >= 15);
    assert.equal(white.stats.fresh, white.stats.mine, "nothing practised yet");

    // Walk every position of the white repertoire: at most one White move each.
    const seen = new Set();
    const queue = [[]];
    while (queue.length) {
      const path = queue.shift();
      const { body: view } = await get(`/repertoires/${white.id}/position?path=${path.join(",")}`);
      if (seen.has(view.epd)) continue;
      seen.add(view.epd);
      if (view.mine) assert.ok(view.mySaved.length <= 1, `two White moves after ${path.join(" ")}`);
      for (const s of view.saved) queue.push([...path, s.san]);
    }
  });
});

describe("builder", () => {
  test("first move shows the saved move with real statistics", async () => {
    const { body } = await get("/repertoires/1/position?path=");
    assert.equal(body.mine, true);
    assert.deepEqual(body.mySaved, ["e4"]);
    const e4 = body.candidates.find((c) => c.san === "e4");
    assert.ok(e4.saved);
    assert.ok(e4.masters.share > 0.3 && e4.masters.share < 0.6, "masters share of 1.e4");
    assert.ok(e4.peers.games > 100000);
    assert.ok(e4.note, "has an explanation");
  });

  test("opponent replies are ordered by how often they are played", async () => {
    const { body } = await get("/repertoires/1/position?path=e4");
    assert.equal(body.mine, false);
    const top = body.candidates.slice(0, 5).map((c) => c.san);
    for (const san of ["e5", "c5", "e6", "c6", "d5"]) assert.ok(top.includes(san), `${san} in top five`);
    const e5 = body.candidates.find((c) => c.san === "e5");
    assert.ok(e5.expectedIn >= 2 && e5.expectedIn <= 4);
    assert.ok(typeof e5.coverage === "number");
  });

  test("an illegal path is rejected", async () => {
    const { status } = await get("/repertoires/1/position?path=e4,e4");
    assert.equal(status, 400);
  });
});

describe("coverage and gaps", () => {
  test("black's biggest gap is the first move it has to answer", async () => {
    const { body } = await get("/repertoires/2/gaps?limit=3");
    assert.ok(body.completion < 10);
    assert.deepEqual(body.gaps[0].path, ["e4"]);
    assert.equal(body.gaps[1].path[0], "d4");
  });

  test("adding a move raises completion; removing it lowers it again", async () => {
    const before = (await get("/repertoires/2/gaps")).body.completion;
    const added = await post("/repertoires/2/moves", { path: ["e4"], san: "c5" });
    assert.equal(added.status, 200);
    assert.equal(added.body.added, 2, "saves 1.e4 and 1...c5");
    const mid = (await get("/repertoires/2/gaps")).body;
    assert.ok(mid.completion > before);
    assert.notDeepEqual(mid.gaps[0].path, ["e4"]);

    await post("/repertoires/2/moves", { path: ["e4", "c5", "Nf3"], san: "d6" });
    const removed = await call("DELETE", "/repertoires/2/moves", { path: ["e4"], san: "c5" });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.removed, 3, "c5 and everything after it");
    const after = (await get("/repertoires/2/gaps")).body.completion;
    assert.ok(after <= mid.completion);
  });

  test("autofill adds moves and closes gaps", async () => {
    const before = (await get("/repertoires/2/gaps")).body.completion;
    const { body } = await post("/repertoires/2/autofill", { limit: 6 });
    assert.ok(body.added.length > 0);
    assert.ok(body.completion > before);
  });
});

describe("practice", () => {
  test("new moves count as due and are in first practice", async () => {
    const { body } = await get("/practice/1");
    assert.equal(body.counts.due, body.counts.fresh, "every never-practised move is due");
    assert.ok(body.counts.due > 0);
    assert.equal(body.counts.batch, 10);
  });

  test("a session is a depth-first queue of position groups", async () => {
    const { body } = await get("/practice/1/session?filter=due");
    assert.equal(body.style, "selective");
    assert.deepEqual(body.groups[0].line, [], "starts with your first move");
    assert.deepEqual(body.groups[0].moves.map((m) => m.san), ["e4"]);
    for (const group of body.groups) {
      assert.equal(group.side, "white");
      for (const m of group.moves) assert.equal(m.learning, true);
    }
    // Every position of the open Sicilian with ...Nc6 is a group.
    const lines = body.groups.map((g) => g.line.join(" "));
    for (const line of ["e4 c5", "e4 c5 Nf3 Nc6", "e4 c5 Nf3 Nc6 d4 cxd4"]) assert.ok(lines.includes(line), line);
    const leaf = body.groups.find((g) => g.line.join(" ") === "e4 c5 Nf3 Nc6 d4 cxd4");
    assert.equal(leaf.moves[0].san, "Nxd4");
    assert.equal(leaf.moves[0].leaf, true);
  });

  test("practising a line covers the positions along and after it", async () => {
    const { body } = await get("/practice/1/session?filter=line&path=e4,c5");
    const lines = body.groups.map((g) => g.line.join(" "));
    assert.ok(lines.includes("") && lines.includes("e4 c5"));
    assert.ok(lines.every((l) => l === "" || l.startsWith("e4 c5")));
  });

  test("results are reported once per group, idempotently", async () => {
    const { body } = await get("/practice/1/session?filter=due");
    const group = body.groups[0];
    const results = group.moves.map((m) => ({ moveId: m.moveId, correct: true }));
    const first = await post("/practice/1/reviews", { submissionId: "group-1", results });
    assert.equal(first.status, 200);
    const srs = first.body.srs[0];
    assert.equal(srs.firstReview, false);
    assert.ok(srs.interval > 1 && srs.interval < 10, `first interval ${srs.interval}`);
    assert.ok(srs.mastery > 0 && srs.mastery < 1);
    const again = await post("/practice/1/reviews", { submissionId: "group-1", results });
    assert.deepEqual(again.body.srs, first.body.srs, "same submission is ignored");
    const counts = (await get("/practice/1")).body.counts;
    assert.equal(counts.fresh, counts.all - group.moves.length);
  });

  test("a missed move comes back soon and counts as difficult after repeated misses", async () => {
    const { body } = await get("/practice/1/session?filter=due");
    const move = body.groups[1].moves[0];
    let res;
    for (let i = 0; i < 3; i += 1) {
      res = await post("/practice/1/reviews", { submissionId: `miss-${i}`, results: [{ moveId: move.moveId, correct: false, played: "Nc3" }] });
    }
    const srs = res.body.srs[0];
    assert.ok(srs.interval < 1, "due again within a day");
    assert.ok(srs.difficulty > 0.6, `difficulty ${srs.difficulty}`);
    const counts = (await get("/practice/1")).body.counts;
    assert.ok(counts.difficult >= 1);
  });

  test("opponent moves cannot be reviewed", async () => {
    // The starter repertoire saves 1.e4 first, then Black's 1...c5 (id 2).
    const res = await post("/practice/1/reviews", { results: [{ moveId: 2, correct: true }] });
    assert.equal(res.status, 400);
  });

  test("moves outside the repertoire are judged by the engine", async () => {
    const fen = "r1bqkbnr/pp1ppppp/2n5/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    const good = await post("/practice/judge", { fen, uci: "f1b5" });
    assert.equal(good.body.classification, "good");
    assert.equal(good.body.refutation, null);
    const blunder = await post("/practice/judge", { fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5Q2/PPPP1PPP/RNB1KBNR w KQkq - 2 3", uci: "f3f7" });
    assert.equal(blunder.body.classification, "blunder");
    assert.equal(blunder.body.refutation.san, "Kxf7");
  });

  test("daily progress counts today's reviews", async () => {
    const { body } = await get("/dashboard");
    assert.ok(body.daily.reviewed >= 2);
    assert.equal(body.daily.streak, 1);
  });
});

describe("import, settings, puzzles", () => {
  test("PGN import keeps variations", async () => {
    const created = await post("/repertoires", { name: "Test", color: "black" });
    const id = created.body.repertoire.id;
    const pgn = '[Event "x"]\n\n1. d4 Nf6 2. c4 (2. Nf3 d5) 2... e6 3. Nc3 Bb4 *';
    const res = await post(`/repertoires/${id}/import`, { pgn });
    assert.equal(res.body.lines, 2);
    const view = (await get(`/repertoires/${id}/position?path=d4,Nf6`)).body;
    assert.deepEqual(view.saved.map((m) => m.san).sort(), ["Nf3", "c4"]);
    assert.equal((await call("DELETE", `/repertoires/${id}`)).status, 200);
  });

  test("settings are validated", async () => {
    assert.equal((await call("PATCH", "/settings", { coverageGoal: 7 })).status, 400);
    assert.equal((await call("PATCH", "/settings", { reviewStyle: "sometimes" })).status, 400);
    assert.equal((await call("PATCH", "/settings", { reviewStyle: "every", reviewPauseBehavior: "when-wrong" })).status, 200);
    const lineStyle = await get("/practice/1/session?filter=all");
    const deep = lineStyle.body.groups.find((g) => g.line.length > 4);
    assert.ok(deep.preceding.length > 0, "complete-lines style includes the positions before");
    assert.ok(deep.preceding.every((p) => p.synthetic));
    await call("PATCH", "/settings", { reviewStyle: "selective", reviewPauseBehavior: "never" });
    const ok = await call("PATCH", "/settings", { rating: 1900, ratingSystem: "lichess" });
    assert.equal(ok.body.band, "1800-1999");
    await call("PATCH", "/settings", { rating: 1500, ratingSystem: "chesscom" });
  });

  test("puzzles come with a solution and update the rating", async () => {
    const { body } = await get("/puzzles/next?scope=all");
    assert.ok(body.puzzle.moves.length >= 2);
    const res = await post(`/puzzles/${body.puzzle.id}/attempt`, { correct: true });
    assert.ok(res.body.rating >= 1500);
  });
});

describe("training games", () => {
  test("the bot answers with a legal move", async () => {
    const start = await post("/training", { color: "white", botRating: 1400, path: ["e4"] });
    assert.equal(start.status, 200);
    assert.equal(start.body.turn, "white", "bot already replied to 1.e4");
    assert.equal(start.body.sans.length, 2);
    const move = await post(`/training/${start.body.id}/move`, { san: "Nf3" });
    assert.equal(move.body.sans.length, 4);
    const illegal = await post(`/training/${start.body.id}/move`, { san: "Ke8" });
    assert.equal(illegal.status, 400);
  });
});
