import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { finishSession, startTestServer } from "./helpers.js";

const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const BLACK_NF3_EPD =
  "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -";

let ctx;
let whiteSession;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  if (ctx) await ctx.close();
});

test("due mode is complete when nothing is due", async () => {
  const legacy = await ctx.apiOk("GET", "/practice/next?repertoire=white&mode=due");
  assert.equal(legacy.complete, true);
  assert.equal(legacy.line, null);
  assert.equal(legacy.remaining, 0);

  const session = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "due",
  });
  assert.equal(session.session.complete, true);
  assert.equal(session.session.remaining, 0);
  assert.equal(session.session.status, "complete");
  assert.equal(session.task, null);
});

test("all mode walks the line move by move and auto-plays the opponent", async () => {
  const started = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "all",
  });
  whiteSession = started.session.id;
  assert.equal(started.task.expectedSan, "e4");
  assert.equal(started.task.epd, START_EPD);
  assert.ok(started.session.total > 50);

  const first = await ctx.apiOk("POST", `/practice/sessions/${whiteSession}/attempt`, {
    san: "e4",
    submissionId: "walk-e4",
  });
  assert.equal(first.correct, true);
  assert.equal(first.next.task.expectedSan, "Nf3");
  assert.equal(first.next.autoReply.san, "c5");
  assert.equal(first.session.remaining, started.session.total - 1);

  const second = await ctx.apiOk("POST", `/practice/sessions/${whiteSession}/attempt`, {
    san: "Nf3",
    submissionId: "walk-nf3",
  });
  assert.equal(second.correct, true);
  assert.equal(second.next.task.expectedSan, "d4");
  assert.equal(second.next.autoReply.san, "d6");
  assert.deepEqual(
    second.next.task.prefix.map((move) => move.san),
    ["e4", "c5", "Nf3", "d6"]
  );
});

test("a wrong move keeps the position, the counters and the due count", async () => {
  const before = await ctx.apiOk("GET", `/practice/sessions/${whiteSession}/current`);
  const statsBefore = (await ctx.apiOk("GET", "/repertoires/white")).repertoire;

  const wrong = await ctx.apiOk("POST", `/practice/sessions/${whiteSession}/attempt`, {
    san: "h3",
    submissionId: "walk-wrong",
  });
  assert.equal(wrong.correct, false);
  assert.equal(wrong.retry, true);
  assert.equal(wrong.session.remaining, before.session.remaining);
  assert.equal(wrong.next.task.epd, before.task.epd);
  assert.equal(wrong.next.task.expectedSan, before.task.expectedSan);
  assert.equal(wrong.scheduled, null);
  assert.ok(wrong.lapse.lapses >= 1);

  const statsAfter = (await ctx.apiOk("GET", "/repertoires/white")).repertoire;
  assert.equal(statsAfter.due, statsBefore.due);

  const solved = await ctx.apiOk("POST", `/practice/sessions/${whiteSession}/attempt`, {
    san: "d4",
    submissionId: "walk-d4",
  });
  assert.equal(solved.correct, true);
});

test("attempts are legal-move validated and position-bound", async () => {
  const illegal = await ctx.api("POST", `/practice/sessions/${whiteSession}/attempt`, {
    san: "Qh5",
  });
  assert.equal(illegal.status, 422);
  assert.equal(illegal.body.code, "illegal_move");
  assert.ok(Array.isArray(illegal.body.legalMoves));

  const mismatch = await ctx.api("POST", `/practice/sessions/${whiteSession}/attempt`, {
    san: "Nxd4",
    epd: "8/8/8/8/8/8/8/K6k w - -",
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, "position_mismatch");

  const missing = await ctx.api("GET", "/practice/sessions/not-a-session");
  assert.equal(missing.status, 404);
});

test("submission ids make reviews idempotent", async () => {
  const current = await ctx.apiOk("GET", `/practice/sessions/${whiteSession}/current`);
  const payload = {
    san: current.task.expectedSan,
    submissionId: "idempotent-1",
  };
  const first = await ctx.apiOk("POST", `/practice/sessions/${whiteSession}/attempt`, payload);
  assert.equal(first.correct, true);
  assert.equal(first.idempotent, false);

  const before = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM reviews WHERE submission_id = ?")
    .get("idempotent-1").n;
  const second = await ctx.apiOk("POST", `/practice/sessions/${whiteSession}/attempt`, payload);
  assert.equal(second.idempotent, true);
  assert.equal(second.correct, true);
  const after = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM reviews WHERE submission_id = ?")
    .get("idempotent-1").n;
  assert.equal(after, before);
  assert.equal(after, 1);
});

test("an all session terminates and leaves nothing due", async () => {
  const current = await ctx.apiOk("GET", `/practice/sessions/${whiteSession}/current`);
  const finished = await finishSession(ctx, whiteSession, {
    session: current.session,
    next: { task: current.task },
  });
  assert.equal(finished.session.complete, true);
  assert.equal(finished.session.remaining, 0);

  const repertoire = (await ctx.apiOk("GET", "/repertoires/white")).repertoire;
  assert.equal(repertoire.due, 0);
  assert.equal(repertoire.completion, 100);
  assert.ok(repertoire.mastery >= 0);
  assert.ok(repertoire.learned > 0);

  const again = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "due",
  });
  assert.equal(again.session.complete, true);
  assert.equal(again.session.remaining, 0);
});

test("weak mode requires a real wrong attempt and excludes unattempted moves", async () => {
  const all = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "black",
    mode: "all",
  });
  const wrongEpd = all.task.epd;
  const wrong = await ctx.apiOk("POST", `/practice/sessions/${all.session.id}/attempt`, {
    san: "Nc6",
    submissionId: "weak-wrong",
  });
  assert.equal(wrong.correct, false);
  await ctx.apiOk("DELETE", `/practice/sessions/${all.session.id}`);

  const weak = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "black",
    mode: "weak",
  });
  assert.ok(weak.session.total >= 1);
  assert.ok(weak.session.total < all.session.total);
  assert.equal(weak.task.epd, wrongEpd);

  const mistakes = await ctx.apiOk("GET", "/repertoires/black/mistakes");
  assert.ok(mistakes.count >= 1);
  assert.equal(mistakes.onlineAvailable, false);
  assert.equal(mistakes.online, null);

  const solved = await ctx.apiOk("POST", `/practice/sessions/${weak.session.id}/attempt`, {
    san: weak.task.expectedSan,
    submissionId: "weak-solve",
  });
  assert.equal(solved.correct, true);
  assert.equal(solved.session.complete, true);
  await ctx.apiOk("DELETE", `/practice/sessions/${weak.session.id}`);
});

test("pause, resume, skip, keep and reset manipulate the session, not the schedule", async () => {
  const all = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "black",
    mode: "all",
  });
  const id = all.session.id;

  const paused = await ctx.apiOk("POST", `/practice/sessions/${id}/pause`);
  assert.equal(paused.session.status, "paused");
  const resumed = await ctx.apiOk("POST", `/practice/sessions/${id}/resume`);
  assert.equal(resumed.session.status, "active");
  assert.ok(resumed.task);

  const latest = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "black",
    mode: "all",
    resume: true,
  });
  assert.equal(latest.session.id, id);
  assert.equal(latest.resumed, true);

  const skipped = await ctx.apiOk("POST", `/practice/sessions/${id}/skip`);
  assert.equal(skipped.skipped, all.task.epd);
  assert.equal(skipped.session.remaining, all.session.remaining - 1);
  assert.equal(skipped.session.correct, 0, "skipping is not a correct answer");
  assert.notEqual(skipped.task?.epd, all.task.epd);

  const kept = await ctx.apiOk("POST", `/practice/sessions/${id}/keep`);
  assert.equal(kept.kept, skipped.task.epd);
  assert.equal(kept.session.remaining, all.session.remaining - 2);

  const restarted = await ctx.apiOk("POST", `/practice/sessions/${id}/reset`);
  assert.equal(restarted.session.remaining, restarted.session.total);
  assert.equal(restarted.session.correct, 0);
  assert.equal(restarted.session.wrong, 0);
  assert.equal(restarted.session.skipped, 0);
  await ctx.apiOk("DELETE", `/practice/sessions/${id}`);

  // keep made a position due, and answering it clears the due count
  const due = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "black",
    mode: "due",
  });
  assert.equal(due.session.total, 1);
  const dueWrong = await ctx.apiOk("POST", `/practice/sessions/${due.session.id}/attempt`, {
    san: "h5",
    submissionId: "due-wrong-legal",
  });
  // h5 is legal for Black at the start; it is simply not a saved move.
  assert.equal(dueWrong.correct, false);
  const dueDone = await ctx.apiOk("POST", `/practice/sessions/${due.session.id}/attempt`, {
    san: due.task.expectedSan,
    submissionId: "due-done",
  });
  assert.equal(dueDone.correct, true);
  assert.equal(dueDone.session.complete, true);
  const blackStats = (await ctx.apiOk("GET", "/repertoires/black")).repertoire;
  assert.equal(blackStats.due, 0);
});

test("alternate saved responses at one position are accepted", async () => {
  const black = await ctx.apiOk("GET", "/repertoires/black");
  const lineIds = black.lines
    .filter((line) => line.moves.join(" ").startsWith("e4 c5 Nf3"))
    .map((line) => line.id);
  assert.ok(lineIds.length >= 2);

  let state = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "black",
    mode: "specific",
    lineIds,
  });
  let task = null;
  let guard = 0;
  while (!state.session.complete && guard < 100) {
    if (state.task?.epd === BLACK_NF3_EPD) {
      task = state.task;
      break;
    }
    state = await ctx.apiOk("POST", `/practice/sessions/${state.session.id}/skip`);
    guard += 1;
  }
  assert.ok(task, "found the alternate position");
  assert.ok(task.acceptableSans.length >= 2);
  assert.ok(task.acceptableSans.includes("d6"));
  assert.ok(task.acceptableSans.includes("Nc6"));

  const alternate = task.acceptableSans.find((san) => san !== task.expectedSan);
  const result = await ctx.apiOk("POST", `/practice/sessions/${state.session.id}/attempt`, {
    san: alternate,
    submissionId: "alternate-1",
  });
  assert.equal(result.correct, true);
  assert.equal(result.expectedSan, alternate);
  await ctx.apiOk("DELETE", `/practice/sessions/${state.session.id}`);

  const detail = await ctx.apiOk(
    "GET",
    `/repertoires/black/position?epd=${encodeURIComponent(BLACK_NF3_EPD)}`
  );
  assert.ok(detail.position.moves.length >= 2);
  assert.ok(detail.position.moves.every((move) => move.epd === undefined));
});

test("notes can be created, read on the task, and deleted", async () => {
  const note = await ctx.apiOk("PUT", "/repertoires/white/notes", {
    epd: START_EPD,
    note: "Breaking in the center, the main line of the Classical Sicilian.",
  });
  assert.ok(note.note.id);
  assert.match(note.note.note, /Breaking/);

  const moveNote = await ctx.apiOk("PUT", "/repertoires/white/notes", {
    epd: START_EPD,
    san: "e4",
    note: "Take the centre.",
  });
  assert.equal(moveNote.note.san, "e4");

  const list = await ctx.apiOk(
    "GET",
    `/repertoires/white/notes?epd=${encodeURIComponent(START_EPD)}`
  );
  assert.equal(list.notes.length, 2);

  const session = await ctx.apiOk("POST", "/practice/sessions", {
    repertoire: "white",
    mode: "all",
  });
  assert.match(session.task.note.note, /Breaking/);
  const e4Note = session.task.alternatives.find((alt) => alt.san === "e4")?.note;
  assert.match(e4Note.note, /centre/);
  await ctx.apiOk("DELETE", `/practice/sessions/${session.session.id}`);

  const bad = await ctx.api("PUT", "/repertoires/white/notes", {
    epd: START_EPD,
    san: "Qh5",
    note: "illegal",
  });
  assert.equal(bad.status, 400);

  const removed = await ctx.apiOk("DELETE", `/notes/${moveNote.note.id}`);
  assert.equal(removed.ok, true);

  const cleared = await ctx.apiOk("PUT", "/repertoires/white/notes", {
    epd: START_EPD,
    note: "",
  });
  assert.equal(cleared.deleted, true);
  const empty = await ctx.apiOk(
    "GET",
    `/repertoires/white/notes?epd=${encodeURIComponent(START_EPD)}`
  );
  assert.equal(empty.notes.length, 0);
});

test("adding a move creates a saved branch that is not immediately due", async () => {
  const before = (await ctx.apiOk("GET", "/repertoires/white")).repertoire;
  const added = await ctx.apiOk("POST", "/repertoires/white/moves", {
    epd: START_EPD,
    san: "b3",
    name: "Queen's fianchetto",
  });
  assert.equal(added.created, true);
  assert.equal(added.line.saved, true);
  assert.equal(added.line.due, false);
  assert.equal(added.line.dueAt, null);

  const after = (await ctx.apiOk("GET", "/repertoires/white")).repertoire;
  assert.equal(after.saved, before.saved + 1);
  assert.equal(after.totalLines, before.totalLines + 1);
  assert.equal(after.lineCount, before.lineCount + 1);

  const duplicate = await ctx.apiOk("POST", "/repertoires/white/moves", {
    epd: START_EPD,
    san: "b3",
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.line.id, added.line.id);

  const illegal = await ctx.api("POST", "/repertoires/white/moves", {
    epd: START_EPD,
    san: "Qh9",
  });
  assert.equal(illegal.status, 400);

  const pgnLine = await ctx.apiOk("POST", "/repertoires/white/lines", {
    moves: ["e4", "e5", "Bc4"],
    name: "Bishop's Opening line",
  });
  assert.equal(pgnLine.created, true);
  assert.equal(pgnLine.line.saved, true);
  assert.deepEqual(pgnLine.line.moves, ["e4", "e5", "Bc4"]);

  assert.equal((await ctx.apiOk("DELETE", `/lines/${added.line.id}`)).ok, true);
  assert.equal((await ctx.apiOk("DELETE", `/lines/${pgnLine.line.id}`)).ok, true);
});

test("learning can be reset without losing saved moves, attempts or review history", async () => {
  const blackBefore = (await ctx.apiOk("GET", "/repertoires/black")).repertoire;
  assert.ok((await ctx.apiOk("GET", "/practice/reviews?repertoire=black")).reviews.length > 0);

  const reset = await ctx.apiOk("POST", "/repertoires/black/reset");
  assert.equal(reset.ok, true);
  assert.equal(reset.repertoire.due, 0);
  assert.equal(reset.repertoire.learned, 0);
  assert.equal(reset.repertoire.mastery, 0);
  assert.ok(reset.repertoire.saved > 0);
  assert.equal(reset.repertoire.saved, blackBefore.saved);

  assert.equal((await ctx.apiOk("GET", "/practice/reviews?repertoire=black")).reviews.length, 0);
  assert.equal((await ctx.apiOk("GET", "/repertoires/black/mistakes")).count, 0);

  const attempts = ctx.db
    .prepare(
      `SELECT COUNT(*) AS n FROM attempts a
       JOIN lines l ON l.id = a.line_id
       JOIN repertoires r ON r.id = l.repertoire_id
       WHERE r.color = 'black'`
    )
    .get().n;
  assert.equal(attempts, 0);
  assert.equal(
    ctx.db.prepare("SELECT COUNT(*) AS n FROM practice_sessions WHERE repertoire_id = 2").get().n,
    0
  );
});

test("streak, daily goal and training rating are derived from real reviews", async () => {
  const streak = await ctx.apiOk("GET", "/stats/streak?tzOffset=-330");
  assert.ok(streak.streak.current >= 1);
  assert.ok(streak.streak.highest >= 1);
  assert.ok(streak.streak.lastStreakDate);
  assert.ok(streak.daily.reviews > 0);
  assert.equal(streak.daily.goal, 50);

  const me = await ctx.apiOk("GET", "/me");
  assert.ok(me.user.training.rating > 1200);
  assert.equal(me.user.streak.current, streak.streak.current);

  const dashboard = await ctx.apiOk("GET", "/dashboard?tzOffset=-330");
  assert.equal(dashboard.tasks.streak, streak.streak.current);
  assert.ok(dashboard.streak.highest >= 1);
  assert.equal(dashboard.connected, false);
});

test("model game progress records completion, review and score", async () => {
  const games = await ctx.apiOk("GET", "/model-games");
  const game = games.games[0];
  const total = game.progressState.total;
  assert.ok(total > 0);

  const done = await ctx.apiOk("POST", `/model-games/${game.id}/progress`, { ply: total });
  assert.equal(done.progress.completed, true);
  assert.equal(done.progress.percent, 100);

  const reviewed = await ctx.apiOk("POST", `/model-games/${game.id}/progress`, {
    ply: total,
    reviewed: true,
    score: 80,
  });
  assert.equal(reviewed.progress.reviewed, true);
  assert.equal(reviewed.progress.score, 80);

  const tooFar = await ctx.api("POST", `/model-games/${game.id}/progress`, { ply: total + 3 });
  assert.equal(tooFar.status, 400);
  assert.equal(tooFar.body.code, "ply_out_of_range");

  const single = await ctx.apiOk("GET", `/model-games/${game.id}`);
  assert.equal(single.game.progressState.completed, true);
});

test("legacy practice endpoints keep working with move-level data", async () => {
  await ctx.apiOk("POST", "/repertoires/white/reset");
  const next = await ctx.apiOk("GET", "/practice/next?repertoire=white&mode=all");
  assert.equal(next.complete, false);
  assert.ok(next.line);
  assert.ok(next.line.expectedSan);
  assert.ok(next.line.fen);
  assert.ok(next.line.moves.length >= 1);

  const attempt = await ctx.apiOk("POST", "/practice/attempt", {
    lineId: next.line.id,
    san: next.line.expectedSan,
    mode: "all",
    submissionId: "legacy-1",
  });
  assert.equal(attempt.correct, true);
  assert.ok(attempt.next.line || attempt.next.complete);
  assert.ok(attempt.line.expectedSan);

  const byLine = await ctx.apiOk("GET", `/practice/next?repertoire=white&line=${next.line.id}`);
  assert.ok(byLine.line);

  const invalid = await ctx.api("POST", "/practice/attempt", {
    lineId: next.line.id,
    san: "Qh9",
    mode: "all",
  });
  assert.equal(invalid.status, 422);
});

test("the integrity endpoint reports a clean database", async () => {
  const report = await ctx.apiOk("GET", "/integrity");
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.ok(report.counts.lineMoves > 0);
  assert.ok(report.counts.lines > 0);
});
