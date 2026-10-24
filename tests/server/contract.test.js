import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers.js";

/**
 * API contract suite (audit D219).
 *
 * These tests pin the shape the React client depends on. They are deliberately
 * about *contracts* (keys, types, invariants, error shapes) rather than the
 * deeper training behaviour covered by practice.test.js / modes.test.js /
 * play.test.js.
 */

let ctx;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  if (ctx) await ctx.close();
});

const FORBIDDEN_ENTITLEMENT = /^(plan|subscribed|subscription|subscriptionsource|stripe.*|betaaccess|premium|upgrade|paywall|entitlement|freemoves|movelimit|pro)$/i;

function keysDeep(value, seen = new Set()) {
  const keys = [];
  if (!value || typeof value !== "object" || seen.has(value)) return keys;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) keys.push(...keysDeep(item, seen));
    return keys;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    keys.push(...keysDeep(child, seen));
  }
  return keys;
}

test("health is a JSON envelope with no entitlement data", async () => {
  const result = await ctx.api("GET", "/health");
  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.body.ok, true);
  assert.match(result.body.time, /^\d{4}-\d{2}-\d{2}T/);
});

test("the profile and settings payloads expose no account/subscription fields", async () => {
  const me = await ctx.apiOk("GET", "/me");
  assert.equal(typeof me.user.id, "number");
  assert.equal(typeof me.user.name, "string");
  assert.ok(me.user.training && typeof me.user.training.rating === "number");
  assert.ok(me.user.profile && typeof me.user.profile.ratingSystem === "string");
  assert.ok(me.user.preferences && typeof me.user.preferences.boardTheme === "string");

  const settings = await ctx.apiOk("GET", "/settings");
  assert.ok(settings.settings && typeof settings.settings === "object");
  assert.ok(Array.isArray(settings.platforms));
  assert.ok(Array.isArray(settings.timeControls));
  assert.ok(Array.isArray(settings.boardThemes));
  assert.ok(Array.isArray(settings.reviewStyles));
  assert.ok(Array.isArray(settings.practiceModes));
  assert.ok(Array.isArray(settings.availablePieceSets));

  for (const payload of [me, settings]) {
    const offending = keysDeep(payload).filter((key) => FORBIDDEN_ENTITLEMENT.test(key));
    assert.deepEqual(offending, [], `entitlement keys leaked: ${offending.join(", ")}`);
  }

  // The fresh schema no longer carries a plan column at all (D168/D217).
  const columns = ctx.db.prepare("PRAGMA table_info(users)").all().map((row) => row.name);
  assert.ok(!columns.includes("plan"), `users.plan still exists: ${columns.join(", ")}`);
});

test("repertoire summaries and details share one stable numeric contract", async () => {
  const list = await ctx.apiOk("GET", "/repertoires");
  assert.ok(Array.isArray(list.repertoires));
  assert.ok(list.repertoires.length >= 2);
  for (const repertoire of list.repertoires) {
    assert.equal(typeof repertoire.id, "number");
    assert.ok(["white", "black"].includes(repertoire.color));
    assert.equal(typeof repertoire.name, "string");
    for (const key of [
      "lineCount",
      "moveCount",
      "positionCount",
      "saved",
      "due",
      "completion",
      "mastery",
    ]) {
      assert.equal(typeof repertoire[key], "number", `${key} must be numeric`);
    }
    assert.equal(typeof repertoire.characteristics.available, "boolean");
    assert.equal(typeof repertoire.characteristics.source, "string");
    assert.match(repertoire.characteristics.source, /^recon\//);
  }

  const detail = await ctx.apiOk("GET", "/repertoires/white");
  assert.equal(detail.repertoire.id, list.repertoires.find((r) => r.color === "white").id);
  assert.equal(typeof detail.repertoire.coverage, "number");
  assert.ok(Array.isArray(detail.lines));
  assert.ok(detail.lines.length > 0);
  assert.ok(Array.isArray(detail.lines[0].moves));
});

test("candidate rows carry captured masters/peers/eval/incidence data, not hashes", async () => {
  const result = await ctx.apiOk("GET", "/repertoires/white/candidates?path=e4");
  assert.ok(Array.isArray(result.candidates));
  const candidate = result.candidates[0];
  assert.equal(typeof candidate.san, "string");
  assert.equal(typeof candidate.masters, "number");
  assert.equal(typeof candidate.mastersAvailable, "boolean");
  assert.equal(typeof candidate.eval, "number");
  assert.equal(typeof candidate.evalAvailable, "boolean");
  assert.equal(typeof candidate.peersAvailable, "boolean");
  assert.ok(candidate.peerResults === undefined || typeof candidate.peerResults === "object");
  assert.equal(typeof candidate.probability, "number");
  assert.equal(typeof candidate.source, "string");
  assert.match(candidate.source, /^recon\//);
  assert.ok("annotation" in candidate);
});

test("gap candidates are ordered by captured incidence for Black after 1.e4", async () => {
  const gap = await ctx.apiOk("GET", "/repertoires/black/gap");
  assert.ok(Array.isArray(gap.candidates));
  const sans = gap.candidates.slice(0, 6).map((candidate) => candidate.san);
  assert.deepEqual(sans, ["c5", "e5", "e6", "c6", "d5", "d6"]);
  const incidences = gap.candidates.slice(0, 10).map((candidate) => candidate.incidence);
  for (let index = 1; index < incidences.length; index += 1) {
    assert.ok(
      incidences[index - 1] >= incidences[index],
      "the top candidates must be sorted by incidence"
    );
  }
  for (const candidate of gap.candidates.slice(0, 6)) {
    assert.ok(candidate.oneIn >= 1, "each top candidate exposes an Expected-in value");
  }
});

test("practice session and attempt responses expose the full walk contract", async () => {
  const started = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "all",
    style: "cards",
  });

  for (const key of [
    "session",
    "task",
    "autoReply",
    "resumed",
    "repertoire",
  ]) {
    assert.ok(key in started, `missing ${key}`);
  }
  const { session, task } = started;
  for (const key of [
    "id",
    "repertoireId",
    "mode",
    "status",
    "total",
    "remaining",
    "answered",
    "correct",
    "wrong",
    "skipped",
    "cursor",
    "complete",
    "style",
    "practiceMode",
    "replays",
  ]) {
    assert.ok(key in session, `session.${key} missing`);
  }
  assert.equal(session.mode, "all");
  assert.equal(session.complete, false);
  assert.equal(task.expectedSan, "e4");
  for (const key of [
    "epd",
    "fen",
    "ply",
    "moveNumber",
    "side",
    "expectedSan",
    "acceptableSans",
    "alternatives",
    "lineId",
    "prefix",
    "card",
  ]) {
    assert.ok(key in task, `task.${key} missing`);
  }
  assert.ok(Array.isArray(task.prefix));
  assert.equal(typeof task.card.difficulty, "number");
  assert.equal(typeof task.card.expectedWrongPercent, "number");

  const answered = await ctx.apiOk(
    "POST",
    `/practice/sessions/${session.id}/attempt`,
    { san: task.expectedSan, submissionId: "contract-walk-1" }
  );
  assert.equal(answered.correct, true);
  assert.equal(answered.idempotent, false);
  assert.ok(answered.next.task);
  assert.equal(answered.next.autoReply.san, "c5");
  assert.equal(answered.next.task.expectedSan, "Nf3");
  assert.equal(answered.session.answered, 1);
  assert.equal(answered.session.remaining, session.total - 1);
  assert.ok(answered.stats && typeof answered.stats.due === "number");
  assert.ok(answered.daily && typeof answered.daily.reviews === "number");

  const replayed = await ctx.apiOk(
    "POST",
    `/practice/sessions/${session.id}/attempt`,
    { san: task.expectedSan, submissionId: "contract-walk-1" }
  );
  assert.equal(replayed.correct, true);
  assert.equal(replayed.idempotent, true);
  assert.equal(replayed.session.answered, 1, "replayed submission must not double-count");
  assert.equal(replayed.session.remaining, session.total - 1);
});

test("wrong attempts return a labelled local refutation and never advance", async () => {
  const started = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "all",
  });
  const wrong = await ctx.apiOk(
    "POST",
    `/practice/sessions/${started.session.id}/attempt`,
    { san: "h3", submissionId: "contract-wrong-1" }
  );
  assert.equal(wrong.correct, false);
  assert.equal(wrong.retry, true);
  assert.equal(wrong.session.answered, 0);
  assert.equal(wrong.session.remaining, started.session.total);
  assert.equal(wrong.next.task.epd, started.task.epd);
  assert.equal(wrong.next.task.expectedSan, started.task.expectedSan);
  assert.ok(wrong.refutation);
  assert.match(wrong.refutation.engine, /Stockfish|heuristic/i);
  assert.ok(["stockfish", "heuristic"].includes(wrong.refutation.source));
  assert.equal(wrong.refutation.available, true);
  assert.equal(typeof wrong.refutation.depth, "number");
  assert.equal(typeof wrong.refutation.explanation, "string");
  assert.ok(wrong.refutation.explanation.length > 0);
});

test("error responses keep one JSON shape for 400/404/422", async () => {
  const missing = await ctx.api("GET", "/repertoires/does-not-exist");
  assert.equal(missing.status, 404);
  assert.equal(typeof missing.body.error, "string");

  const invalidBody = await fetch(`${ctx.base}/practice/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(invalidBody.status, 400);
  const invalidJson = await invalidBody.json();
  assert.equal(invalidJson.error, "Invalid request body");
  assert.equal(invalidJson.code, "entity.parse.failed");

  const session = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "all",
  });
  const illegal = await ctx.api("POST", `/practice/sessions/${session.session.id}/attempt`, {
    san: "Qxh8",
    submissionId: "contract-illegal-1",
  });
  assert.equal(illegal.status, 422);
  assert.equal(illegal.body.code, "illegal_move");
  assert.equal(typeof illegal.body.error, "string");
});

test("settings PATCH validates values and returns the canonical row", async () => {
  const before = await ctx.apiOk("GET", "/settings");
  const next = await ctx.apiOk("PATCH", "/settings", {
    boardTheme: "lichess-green",
    practiceMode: "whole-lines",
    reviewStyle: "complete-once",
    coverageGoal: 100,
    rehearsal: "ignored-key",
  });
  assert.equal(next.settings.boardTheme, "lichess-green");
  assert.equal(next.settings.practiceMode, "whole-lines");
  assert.equal(next.settings.reviewStyle, "complete-once");
  assert.equal(next.settings.coverageGoal, 100);
  assert.ok(!("rehearsal" in next.settings));

  const invalid = await ctx.apiOk("PATCH", "/settings", { boardTheme: "neon-pink" });
  assert.equal(invalid.settings.boardTheme, "lichess-green", "invalid value keeps the old one");

  await ctx.apiOk("PATCH", "/settings", {
    boardTheme: before.settings.boardTheme,
    practiceMode: before.settings.practiceMode,
    reviewStyle: before.settings.reviewStyle,
    coverageGoal: before.settings.coverageGoal,
  });
});

test("play capabilities are explicit about the missing Stockfish engine", async () => {
  const capabilities = await ctx.apiOk("GET", "/play");
  assert.deepEqual(capabilities.features, [
    "training",
    "puzzles",
    "intuition",
    "visualization",
    "vision",
  ]);
  assert.equal(capabilities.engine.stockfish, false);
  assert.equal(capabilities.engine.name, "Chessbook local heuristic");
  assert.match(capabilities.engine.note, /no Stockfish/i);

  const options = await ctx.apiOk("GET", "/play/training-games/options");
  assert.ok(Array.isArray(options.bots));
  assert.ok(options.bots.length >= 5);
  assert.ok(Array.isArray(options.timeControls));
  assert.equal(typeof options.defaultRating, "number");
  assert.equal(options.engine.stockfish, false);

  const badFen = await ctx.api("POST", "/play/training-games", { fen: "not-a-position" });
  assert.equal(badFen.status, 400);
  assert.equal(badFen.body.code, "invalid_fen");
});

test("model-game payload is the captured 45-move game with eval samples", async () => {
  const daily = await ctx.apiOk("GET", "/model-games/daily");
  const game = daily.game;
  assert.equal(game.white, "Kamsky");
  assert.equal(game.black, "Anand");
  assert.equal(game.event, "Candidats FIDE sf1");
  assert.equal(game.result, "1-0");
  assert.equal(game.moves.length, 89, "89 plies = 45 full moves");
  assert.equal(Math.max(...game.moves.map((move) => move.moveNumber)), 45);
  assert.equal(typeof game.moves[0].evalBefore, "number");
  assert.equal(typeof game.moves[0].fenBefore, "string");
  assert.ok(Array.isArray(game.evalSamples));
  assert.ok(game.evalSamples.length > 0);
});

test("the local API answers unknown API routes with JSON, not the SPA shell", async () => {
  const result = await ctx.api("GET", "/totally-unknown-api-route");
  assert.equal(result.status, 404);
  assert.match(result.body.error, /not found/i);
});
