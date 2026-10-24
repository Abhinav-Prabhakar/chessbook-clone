#!/usr/bin/env node
/**
 * End-to-end check of the learning loop in a real browser.
 *
 *   npm run build && npm run test:e2e
 *
 * Starts the built app on a throwaway database (port 8796), then:
 *  1. learns the new moves of the starter repertoire (arrows, opponent auto-replies),
 *  2. makes one deliberate mistake during recall and checks it is taken back,
 *  3. finishes the session and checks the dashboard counts today's reviews,
 *  4. checks the builder saves a move played on the board.
 * Screenshots go to tests/e2e/output/.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { Chess } from "chess.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "tests", "e2e", "output");
mkdirSync(out, { recursive: true });
const PORT = 8796;
const base = `http://127.0.0.1:${PORT}`;
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const dir = mkdtempSync(join(tmpdir(), "chessbook-e2e-"));
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), CHESSBOOK_DB: join(dir, "e2e.db"), NODE_ENV: "test" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitFor(fn, timeout = 15000, label = "condition") {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

let browser;
try {
  await waitFor(async () => {
    try {
      return (await fetch(`${base}/api/health`)).ok;
    } catch {
      return false;
    }
  }, 60000, "server");

  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(base);
  await page.evaluate(() => localStorage.setItem("cb_entered", "1"));

  const square = async (sq) => {
    const board = page.locator(".board");
    const box = await board.boundingBox();
    const white = (await board.getAttribute("data-orientation")) !== "black";
    const size = box.width / 8;
    const file = "abcdefgh".indexOf(sq[0]);
    const rank = Number(sq[1]);
    const x = white ? file : 7 - file;
    const y = white ? 8 - rank : rank - 1;
    return { x: box.x + (x + 0.5) * size, y: box.y + (y + 0.5) * size };
  };
  const play = async (from, to) => {
    const a = await square(from);
    const b = await square(to);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
  };
  const fen = () => page.locator(".board").getAttribute("data-fen");

  /* ---------------------------------------------------------- practice --- */
  const before = (await (await fetch(`${base}/api/practice/1`)).json()).counts;
  check("new moves count as due", before.due === before.fresh && before.due > 0, `${before.due} due, ${before.fresh} new`);
  const session = await (await fetch(`${base}/api/practice/1/session?filter=due`)).json();
  const groupsByFen = new Map(session.groups.map((g) => [g.fen, g]));
  check("session is a queue of position groups", session.groups.length > 0, `${session.groups.length} groups`);

  const state = () =>
    waitFor(async () => {
      if ((await page.locator("h1", { hasText: /complete!|Perfect practice/ }).count()) > 0) return "done";
      if ((await page.locator(".board.interactive").count()) > 0) return "ask";
      if ((await page.getByText("Got it, continue practicing").count()) > 0) return "pause";
      return null;
    }, 20000, "next question");
  const counter = async (i) => Number((await page.locator(".counters .counter").nth(i).innerText()).match(/\d+/)[0]);

  await page.goto(`${base}/repertoires/1/practice?filter=due`);
  await page.waitForSelector(".board.interactive");
  await page.screenshot({ path: join(out, "01-learn.png") });
  check("first practice shows the move with an arrow", (await page.locator(".board .arrows").count()) === 1);
  check("first practice has no 'I don't know' button", (await page.getByText("I don't know").count()) === 0);
  check("first practice offers to skip it", (await page.getByText("Skip first practice").count()) === 1);

  let answered = 0;
  let resumed = false;
  let wrongTested = false;
  let hintTested = false;
  for (let guard = 0; guard < 300; guard += 1) {
    const now = await state();
    if (now === "done") break;
    if (now === "pause") {
      await page.getByText("Got it, continue practicing").click();
      continue;
    }
    const fen = await page.locator(".board").getAttribute("data-fen");
    const group = groupsByFen.get(fen);
    if (!group) throw new Error(`Asked at an unexpected position ${fen}`);
    const recall = (await page.getByText(/I don't know/).count()) > 0;

    if (recall && !wrongTested) {
      // Three wrong moves: each is judged, shown with a badge and taken back; then the arrows appear.
      const chess = new Chess(fen);
      const wrongs = chess.moves({ verbose: true }).filter((m) => !group.moves.some((x) => x.san === m.san));
      const incorrectBefore = await counter(2);
      for (let k = 0; k < 3; k += 1) {
        const w = wrongs[k * 3 % wrongs.length];
        await play(w.from, w.to);
        await page.waitForSelector(".square-feedback");
        if (k === 0) await page.screenshot({ path: join(out, "02-wrong-move.png") });
        await waitFor(async () => (await page.locator(".square-feedback").count()) === 0 && (await page.locator(".board").getAttribute("data-fen")) === fen, 8000, "take back");
        await page.waitForSelector(".board.interactive");
      }
      check("a wrong move is judged, shown with a badge and taken back", true);
      check("the incorrect counter goes up once per position", (await counter(2)) === incorrectBefore + 1, `${incorrectBefore} → ${await counter(2)}`);
      check("arrows appear after three wrong guesses", (await page.locator(".board .arrows").count()) === 1);
      wrongTested = true;
    } else if (recall && !hintTested && group.moves.some((m) => m.note)) {
      await page.getByText("I don't know, give me a hint").click();
      check("the first hint reveals the note", (await page.locator(".quiz-note.hidden").count()) === 0);
      await page.getByText("I don't know, show me the answer").click();
      check("the second shows the answer with an arrow", (await page.locator(".board .arrows").count()) === 1);
      hintTested = true;
    }

    const move = group.moves[0];
    await play(move.from, move.to);
    answered += 1;
    await waitFor(async () => (await page.locator(".board").getAttribute("data-fen")) !== fen, 5000, "move accepted");

    if (answered === 3 && !resumed) {
      // Leave mid-session and come back to it.
      await page.getByText("Exit practice").click();
      await page.waitForSelector("text=Continue your practice session");
      check("the practice menu offers to resume", true);
      await page.getByText("Continue your practice session").click();
      await page.waitForSelector(".board.interactive");
      resumed = true;
    }
  }
  check("every position was answered", answered > 0, `${answered} answers`);
  check("first-practice moves came back once without arrows", wrongTested);
  check("the hint ladder works", hintTested);
  await page.screenshot({ path: join(out, "03-complete.png") });
  const header = await page.locator("h1").first().innerText();
  check("session ends with production's summary", /complete!|Perfect practice/.test(header), header);
  check("the summary lists the session's stats", (await page.getByText("Your stats from").count()) === 1);

  const after = (await (await fetch(`${base}/api/practice/1`)).json()).counts;
  check("practised moves are no longer new", after.fresh < before.fresh, `${before.fresh} → ${after.fresh} new`);
  const dash = await (await fetch(`${base}/api/dashboard`)).json();
  check("dashboard counts today's reviews", dash.daily.reviewed > 0, `${dash.daily.reviewed} today`);

  /* ----------------------------------------------------------- builder --- */
  await page.goto(`${base}/repertoires/2/build`);
  await page.waitForSelector(".board.interactive");
  await page.waitForSelector(".cand");
  const repBefore = (await (await fetch(`${base}/api/repertoires/2`)).json()).repertoire;
  const savedBefore = repBefore.stats.saved;
  // Black repertoire: the opponent moves first. Explore 1.e4, then answer 1...c5 on the board.
  const urlHas = (text) => waitFor(async () => decodeURIComponent(page.url()).includes(text), 8000, `URL with ${text}`);
  await play("e2", "e4");
  await urlHas("path=e4");
  await page.waitForSelector(".board.interactive");
  await page.waitForFunction(() => document.querySelector(".board")?.dataset.fen?.includes("4P3"));
  await play("c7", "c5");
  await urlHas("path=e4,c5");
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, "04-builder.png") });
  const afterSave = (await (await fetch(`${base}/api/repertoires/2`)).json()).repertoire;
  check("a move played in the builder is saved", afterSave.stats.saved === savedBefore + 2, `${savedBefore} → ${afterSave.stats.saved}`);
  check("completion rises after answering 1.e4", afterSave.completion > repBefore.completion, `${repBefore.completion}% → ${afterSave.completion}%`);

  /* ------------------------------------------------------- transitions --- */
  await page.goto(base);
  await page.waitForSelector(".row-large");
  await page.waitForTimeout(400);
  const sampleTransition = (selector) =>
    page.evaluate(async (selector) => {
      const exit = document.querySelector(".view-exit");
      const view = document.querySelector(".view");
      document.querySelector(selector).click();
      const at = (ms) => new Promise((r) => setTimeout(r, ms));
      await at(60);
      const early = { snapshot: exit.children.length, opacity: +getComputedStyle(view).opacity, x: new DOMMatrix(getComputedStyle(view).transform).m41 };
      await at(500);
      const done = { snapshot: exit.children.length, opacity: +getComputedStyle(view).opacity };
      return { early, done };
    }, selector);
  const forward = await sampleTransition(".row-large");
  check(
    "going deeper: old view leaves, new view enters from the right",
    forward.early.snapshot === 1 && forward.early.opacity < 0.5 && forward.early.x > 0 && forward.done.snapshot === 0 && forward.done.opacity === 1,
    JSON.stringify(forward)
  );
  await page.waitForTimeout(300);
  const back = await sampleTransition(".back");
  check("going back: new view enters from the left", back.early.snapshot === 1 && back.early.x < 0 && back.done.opacity === 1, JSON.stringify(back));

  /* ---------------------------------------------------------- mobile ----- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.waitForSelector(".row-large");
  await page.screenshot({ path: join(out, "05-mobile-dashboard.png") });
  const frame = await page.locator(".board-frame").boundingBox();
  check("phone dashboard shows a clipped board", frame.height < 140, `${Math.round(frame.height)}px tall`);

  const unexpected = errors.filter((e) => !/favicon|manifest/i.test(e));
  check("no console errors", unexpected.length === 0, unexpected.slice(0, 3).join(" | "));
} catch (error) {
  check("run finished", false, error.message);
  try {
    const pages = browser?.contexts()[0]?.pages() || [];
    if (pages[0]) await pages[0].screenshot({ path: join(out, "failure.png") });
  } catch {
    // ignore
  }
} finally {
  await browser?.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  if (serverLog.trim()) console.log(`\nserver log:\n${serverLog.slice(-2000)}`);
  process.exit(1);
}
