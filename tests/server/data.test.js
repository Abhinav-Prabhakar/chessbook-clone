import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers.js";

const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -";
const AFTER_E4_C5 = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -";
const AFTER_A3 = "rnbqkbnr/pppppppp/8/8/8/P7/1PPPPPPP/RNBQKBNR b KQkq -";

const q = (value) => encodeURIComponent(value);

let ctx;
let clone;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  if (ctx) await ctx.close();
});

test("Black after 1.e4 returns the full real candidate list in incidence order", async () => {
  const body = await ctx.apiOk(
    "GET",
    `/repertoires/black/gap?epd=${q(AFTER_E4)}`
  );
  assert.equal(body.available, true);
  assert.deepEqual(
    body.candidates.slice(0, 5).map((candidate) => candidate.san),
    ["c5", "e5", "e6", "c6", "d5"]
  );
  const c5 = body.candidates[0];
  assert.ok(Math.abs(c5.incidence - 0.2938162088394165) < 1e-9);
  assert.equal(c5.oneIn, 3);
  assert.equal(c5.eval, 45);
  assert.equal(c5.masters, 42.7);
  assert.equal(c5.peers.white, 48.5);
  assert.equal(c5.peers.black, 46.1);
  assert.equal(c5.name, "Sicilian Defense");
  assert.equal(c5.saved, true);
  // Missing moves are in the same ranked list, not hidden.
  const d6 = body.candidates.find((candidate) => candidate.san === "d6");
  assert.ok(d6);
  assert.equal(d6.saved, false);
  assert.equal(d6.needed, true);
  assert.equal(body.candidates.length, 20);
});

test("the default gap is the captured biggest miss (Black: answer 1.e4)", async () => {
  const body = await ctx.apiOk("GET", "/repertoires/black/gap");
  assert.equal(body.position.epd, AFTER_E4);
  assert.equal(body.position.prefixMoves[0], "e4");
  assert.deepEqual(
    body.candidates.slice(0, 5).map((candidate) => candidate.san),
    ["c5", "e5", "e6", "c6", "d5"]
  );
  assert.ok(body.gaps.length > 0);
  assert.ok(body.gaps[0].weight > 0);
});

test("gap heading names the previous move and the side to move correctly", async () => {
  const body = await ctx.apiOk(
    "GET",
    `/repertoires/white/gap?epd=${q(AFTER_E4_C5)}`
  );
  assert.equal(body.position.heading.moveNumber, 2);
  assert.equal(body.position.heading.side, "white");
  assert.equal(body.position.heading.lastMove.san, "c5");
  assert.equal(body.position.heading.lastMove.side, "black");
  assert.equal(body.position.heading.prompt, "Choose a response to 1… c5");
});

test("a position without a captured report now uses the offline explorer and Stockfish", async () => {
  const body = await ctx.apiOk(
    "GET",
    `/repertoires/white/candidates?epd=${q(AFTER_A3)}`
  );
  assert.equal(body.available, true);
  assert.ok(body.candidates.length > 0);
  assert.ok(body.position.stockfish.eval != null);
  assert.ok(body.position.stockfish.pawns != null);
  assert.equal(body.position.stockfish.source, "stockfish");
  assert.ok(body.total > 0);
  const first = body.candidates[0];
  assert.ok(first.masters != null);
  assert.ok(first.peersAvailable || first.peers != null);
  assert.ok(first.incidence != null);
  assert.equal(first.oneIn >= 1, true);
  assert.ok(first.evalAvailable);
  assert.equal(first.evalSource, "stockfish");
  assert.ok(body.sources.masters);
  assert.ok(body.sources.lichess);

  const opening = await ctx.apiOk(
    "GET",
    `/openings/position?epd=${q(AFTER_A3)}`
  );
  assert.equal(opening.available, true);
  assert.equal(opening.position.reportAvailable, false);
  assert.ok(opening.candidates.length > 0);
  assert.ok(opening.position.stockfish.eval != null);
  assert.equal(opening.position.stockfish.source, "stockfish");
});

test("autofill inserts a real saved branch and respects exclusions", async () => {
  const created = await ctx.apiOk("POST", "/repertoires/black/clone", {
    name: "Autofill test",
  });
  clone = created.repertoire;
  const before = clone.saved;

  const result = await ctx.apiOk(
    "POST",
    `/repertoires/${clone.id}/autofill`,
    {
      epd: AFTER_E4,
      style: "expected",
      maxMoves: 1,
      excludeMoves: [{ epd: AFTER_E4, san: "d6" }],
    }
  );
  assert.equal(result.style, "expected");
  assert.equal(result.filled, 1);
  assert.equal(result.inserted[0].san, "g6");
  assert.equal(result.inserted[0].created, true);
  assert.equal(result.repertoire.saved, before + 1);

  const candidates = await ctx.apiOk(
    "GET",
    `/repertoires/${clone.id}/candidates?epd=${q(AFTER_E4)}`
  );
  assert.equal(candidates.candidates.find((candidate) => candidate.san === "g6").saved, true);
  assert.equal(candidates.candidates.find((candidate) => candidate.san === "d6").excluded, true);

  const exclusions = await ctx.apiOk(
    "GET",
    `/repertoires/${clone.id}/exclusions?epd=${q(AFTER_E4)}`
  );
  assert.equal(exclusions.count, 1);
  assert.equal(exclusions.exclusions[0].san, "d6");

  const styled = await ctx.apiOk("POST", `/repertoires/${clone.id}/autofill`, {
    epd: AFTER_E4,
    style: "aggressive",
    maxMoves: 1,
    dryRun: true,
  });
  assert.equal(styled.style, "aggressive");
  assert.equal(styled.styleSource, "heuristic-from-captured-fields");
  assert.ok(styled.inserted.length >= 1);
});

test("trim can remove autofilled moves", async () => {
  const result = await ctx.apiOk("POST", `/repertoires/${clone.id}/trim`, {
    mode: "autofilled",
    dryRun: false,
  });
  assert.ok(result.removed.length >= 1);
  assert.ok(result.repertoire.saved >= 1);
});

test("chapters, clone, rename and export round-trip", async () => {
  const white = await ctx.apiOk("GET", "/repertoires/white");
  const chapter = await ctx.apiOk("POST", "/repertoires/white/chapters", {
    name: "Main lines",
    description: "Openings I actually play",
  });
  assert.ok(chapter.chapter.id);

  const line = white.lines[0];
  await ctx.apiOk("PATCH", `/lines/${line.id}`, { chapterId: chapter.chapter.id });

  const repertoire = await ctx.apiOk("GET", "/repertoires/white");
  assert.equal(repertoire.chapters.length, 1);
  assert.equal(repertoire.chapters[0].lineCount, 1);
  assert.equal(repertoire.lines.find((row) => row.id === line.id).chapterId, chapter.chapter.id);

  const pgn = await ctx.apiOk("GET", "/repertoires/white/export?format=pgn");
  assert.match(pgn.raw ?? "", /\[Event "Repertoire: White openings"\]/);
  assert.match(pgn.raw ?? "", /1\. e4 c5/);

  const json = await ctx.apiOk("GET", "/repertoires/white/export?format=json");
  assert.equal(json.format, "chessbook-repertoire");
  assert.ok(json.lines.length >= 16);
  assert.equal(json.chapters.length, 1);

  const renamed = await ctx.apiOk("PATCH", "/repertoires/white", {
    name: "White repertoire",
  });
  assert.equal(renamed.repertoire.name, "White repertoire");

  const cloned = await ctx.apiOk("POST", "/repertoires/white/clone", {
    name: "Cloned white",
  });
  assert.ok(cloned.repertoire.id);
  assert.equal(cloned.cloned.lines, json.lines.length);
  const deleted = await ctx.apiOk("DELETE", `/repertoires/${cloned.repertoire.id}`);
  assert.equal(deleted.ok, true);
});

test("PGN import merges by final EPD (transposition) and rejects illegal input", async () => {
  const text = `[Event "Import test"]
[White "A"]
[Black "B"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O 1-0
`;
  const imported = await ctx.apiOk("POST", "/repertoires/white/import", {
    pgn: text,
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.total, 1);
  assert.ok(imported.results[0].ok);

  const raw = await fetch(`${ctx.base}/repertoires/white/import`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: text,
  });
  assert.equal(raw.status, 200);
  const rawBody = await raw.json();
  assert.equal(rawBody.total, 1);
  assert.equal(rawBody.imported, 0);

  const again = await ctx.apiOk("POST", "/repertoires/white/import", {
    pgn: text,
  });
  assert.equal(again.imported, 0);
  assert.equal(again.results[0].created, false);

  const rejected = await ctx.api("POST", "/repertoires/white/import", {
    pgn: "1. e4 e5 2. Qh9",
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.results[0].ok, false);
});

test("real openings supplementary data, stats and guides are available", async () => {
  const supplementary = await ctx.apiOk(
    "GET",
    `/openings/supplementary?epd=${q("rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -")}`
  );
  assert.equal(supplementary.count, 1);
  assert.equal(supplementary.positions[0].fullName, "Caro-Kann Defense");

  const position = await ctx.apiOk(
    "GET",
    `/openings/position?epd=${q(AFTER_E4)}`
  );
  assert.equal(position.available, true);
  assert.equal(position.candidates[0].san, "c5");
  assert.equal(position.position.reportAvailable, true);
  assert.equal(position.position.ratingBand.band, "1800-2000");
  assert.equal(position.position.bandsAvailable, true);
  assert.ok(position.position.masterResults.white > 0);
  assert.ok(position.position.peerResults.white > 0);
  assert.ok(position.position.stockfish.eval != null);
  assert.equal(position.position.plansAvailable, false);
  assert.deepEqual(position.position.plans, []);

  const guides = await ctx.apiOk("GET", "/openings/guides");
  assert.ok(guides.total >= 100);
  const guide = await ctx.apiOk("GET", "/openings/guides/sicilian-defense");
  assert.equal(guide.guide.eco, "B20");
  assert.deepEqual(guide.guide.moves.slice(0, 2), ["e4", "c5"]);
  assert.ok(guide.guide.steps.length >= 2);
  assert.ok(Object.hasOwn(guide.guide, "notesAvailable"));

  const courses = await ctx.apiOk("GET", "/courses");
  assert.equal(courses.total, 21);
  const course = await ctx.apiOk("GET", "/courses/hp-spanish-black");
  assert.equal(course.course.side, "black");
  assert.equal(course.course.chaptersAvailable, false);
  assert.equal(course.course.characteristics.available, true);
  assert.ok(course.course.guide);

  const coaches = await ctx.apiOk("GET", "/coaches");
  assert.equal(coaches.total, 3);
  assert.equal(coaches.coaches[0].source, "recon/live6/04-coaches.json");

  const blog = await ctx.apiOk("GET", "/blog");
  assert.equal(blog.total, 9);
  const post = await ctx.apiOk("GET", `/blog/${blog.posts[0].slug}`);
  assert.ok(post.post.title);
});

test("repertoire characteristics and coverage come from captured reports", async () => {
  const white = await ctx.apiOk("GET", "/repertoires/white");
  assert.equal(white.repertoire.characteristics.available, true);
  assert.ok(white.repertoire.characteristics.soundness > 0.9);
  assert.equal(white.repertoire.characteristics.source, "recon/live4/network.json#3");
  assert.ok(white.repertoire.coverage != null);

  const coverage = await ctx.apiOk("GET", "/repertoires/black/coverage");
  assert.equal(coverage.available, true);
  assert.ok(coverage.coverage != null);
  assert.ok(coverage.positionsWithReport > 0);
  // The offline explorer covers the positions the production capture did not.
  assert.equal(coverage.positionsWithoutReport, 0);
});

test("model games use the real daily game, history, evals and review state", async () => {
  const daily = await ctx.apiOk("GET", "/model-games/daily");
  assert.equal(daily.game.white, "Kamsky");
  assert.equal(daily.game.black, "Anand");
  assert.equal(daily.game.event, "Candidats FIDE sf1");
  assert.equal(daily.game.outcome, "white");
  assert.equal(daily.game.moveCount, 89);
  assert.equal(daily.game.players.white.elo, 2695);
  assert.equal(daily.game.players.black.elo, 2720);
  assert.equal(daily.game.evalGraph.available, true);
  assert.equal(daily.game.evalSamples.length, 90);
  assert.equal(daily.game.evalSamples[0].evalCp, 32);

  const forced = await ctx.apiOk("POST", "/model-games/daily", {
    force_new_game: true,
  });
  assert.notEqual(forced.game.id, daily.game.id);
  assert.equal(forced.daily.selection, "forced");

  const history = await ctx.apiOk("GET", "/model-games/history");
  assert.equal(history.total, 2);
  assert.equal(history.weeks.length, 2);
  const historyOnly = await ctx.apiOk("GET", "/model-games/history?includeDaily=0");
  assert.equal(historyOnly.total, 1);

  const detail = await ctx.apiOk("GET", `/model-games/${daily.game.id}`);
  assert.equal(detail.game.moves.length, 89);
  assert.equal(detail.game.plies[0].san, "e4");
  assert.ok(detail.game.plies[0].epdAfter);
  assert.equal(detail.game.evals.length, 90);
  assert.equal(detail.game.evalsAvailable, true);
  assert.ok(detail.game.openingMatch.available);
  assert.equal(detail.game.analysis.engineReviewAvailable, true);
  assert.equal(detail.game.analysis.engineReviewSource, "stockfish");

  const progress = await ctx.apiOk(
    "POST",
    `/model-games/${daily.game.id}/progress`,
    { ply: 20 }
  );
  assert.equal(progress.progress.ply, 20);
  assert.equal(progress.progress.total, 89);
  const reviewed = await ctx.apiOk(
    "POST",
    `/model-games/${daily.game.id}/review`,
    { reviewed: true, score: 82 }
  );
  assert.equal(reviewed.progress.reviewed, true);
  assert.equal(reviewed.progress.score, 82);
  assert.equal(reviewed.engineReviewAvailable, true);
  assert.ok(reviewed.engineReview?.available);
  assert.equal(reviewed.engineReview.summary.plies, 89);
  assert.ok(reviewed.engineReview.summary.blunders >= 0);

  const engineReview = await ctx.apiOk(
    "GET",
    `/model-games/${daily.game.id}/review?depth=6`
  );
  assert.equal(engineReview.engineReviewAvailable, true);
  assert.equal(engineReview.source, "stockfish");
  assert.equal(engineReview.engineReview.moves.length, 89);
  assert.ok(
    engineReview.engineReview.moves.every((move) =>
      ["best", "good", "inaccuracy", "mistake", "blunder", "unavailable"].includes(
        move.classification
      )
    )
  );
  // The captured graph remains historical data, not overwritten by the review.
  assert.equal(engineReview.capturedEvalGraph.source, "captured");

  const tooFar = await ctx.api(
    "POST",
    `/model-games/${daily.game.id}/progress`,
    { ply: 1000 }
  );
  assert.equal(tooFar.status, 400);
  assert.equal(tooFar.body.code, "ply_out_of_range");
});

test("openings report is honest with no reviews and reports local weak lines later", async () => {
  const empty = await ctx.apiOk("GET", "/openings/report?timeRange=90d");
  assert.equal(empty.available, true);
  assert.deepEqual(empty.weak, []);
  assert.deepEqual(empty.worst, []);
  assert.equal(empty.capturedAvailable, false);
});

test("opening import versioning is exposed", async () => {
  const imports = await ctx.apiOk("GET", "/openings/imports");
  assert.ok(Array.isArray(imports.imports));
  assert.ok(Array.isArray(imports.current));
});
