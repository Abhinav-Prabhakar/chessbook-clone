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
  test("a due session walks lines and asks only your moves", async () => {
    const { body } = await get("/practice/1/session?mode=due");
    assert.ok(body.lines.length > 0);
    const first = body.lines[0];
    for (const ply of first.plies) {
      if (ply.ask) assert.equal(ply.side, "white");
    }
    // The open Sicilian line: e4 c5 Nf3 Nc6 d4 cxd4 Nxd4.
    const sicilian = body.lines.find((l) => l.sans.slice(0, 4).join(" ") === "e4 c5 Nf3 Nc6");
    assert.ok(sicilian);
    assert.deepEqual(
      sicilian.plies.filter((p) => p.ask).map((p) => p.san),
      ["e4", "Nf3", "d4", "Nxd4"]
    );
  });

  test("learning does not schedule; recall does; mistakes come back soon", async () => {
    const { body } = await get("/practice/1/session?mode=new");
    const ask = body.lines[0].plies.find((p) => p.ask);
    const learn = await post("/practice/1/review", { moveId: ask.moveId, correct: true, kind: "learn" });
    assert.equal(learn.body.move.reps, 0);

    const good = await post("/practice/1/review", { moveId: ask.moveId, correct: true, kind: "review", submissionId: "t-1" });
    assert.equal(good.body.move.reps, 1);
    const days = (Date.parse(good.body.move.dueAt) - Date.now()) / 86400000;
    assert.ok(days > 1 && days < 10, `first interval ${days} days`);

    const again = await post("/practice/1/review", { moveId: ask.moveId, correct: true, kind: "review", submissionId: "t-1" });
    assert.equal(again.body.duplicate, true, "same submission is ignored");

    const other = body.lines[0].plies.filter((p) => p.ask)[1];
    const miss = await post("/practice/1/review", { moveId: other.moveId, correct: false, played: "Nc3", kind: "review" });
    const hours = (Date.parse(miss.body.move.dueAt) - Date.now()) / 3600000;
    assert.ok(hours < 24, "a missed move is due again within a day");
    assert.equal(miss.body.move.lapses, 1);
  });

  test("opponent moves cannot be reviewed", async () => {
    const { body } = await get("/practice/1/session?mode=all");
    const theirs = body.lines[0].plies.find((p) => !p.ask && p.moveId && p.side === "black");
    const res = await post("/practice/1/review", { moveId: theirs.moveId, correct: true });
    assert.equal(res.status, 400);
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
