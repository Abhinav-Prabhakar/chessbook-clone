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
  const freshBefore = (await (await fetch(`${base}/api/practice/1`)).json()).counts.fresh;
  const session = await (await fetch(`${base}/api/practice/1/session?mode=new`)).json();
  const askedByFen = new Map();
  for (const line of session.lines) for (const p of line.plies) if (p.ask) askedByFen.set(p.fen, p);
  check("session has lines to learn", session.lines.length > 0, `${session.lines.length} lines`);

  await page.goto(`${base}/repertoires/1/practice?mode=new`);
  await page.waitForSelector(".board.interactive");
  await page.screenshot({ path: join(out, "01-learn.png") });
  check("first new move is taught with an arrow", (await page.locator(".board .arrows").count()) === 1);

  let mistakeTested = false;
  let answered = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const state = await waitFor(async () => {
      if ((await page.locator("h1", { hasText: "Session complete" }).count()) > 0) return "done";
      if ((await page.locator(".board.interactive").count()) > 0) return "ask";
      return null;
    }, 20000, "next question");
    if (state === "done") break;
    const current = await fen();
    const ply = askedByFen.get(current);
    if (!ply) throw new Error(`Asked at an unexpected position ${current}`);
    const recall = (await page.locator(".tag", { hasText: "From memory" }).count()) > 0;
    if (recall && !mistakeTested) {
      // Play a legal move that is not the answer.
      const chess = new Chess(current);
      const wrong = chess.moves({ verbose: true }).find((m) => m.san !== ply.san && !ply.alternatives.includes(m.san));
      const counters = await page.locator(".counters").innerText();
      await play(wrong.from, wrong.to);
      await page.waitForSelector(".feedback.bad");
      await page.screenshot({ path: join(out, "02-wrong-move.png") });
      await waitFor(async () => (await fen()) === current, 3000, "wrong move taken back");
      check("a wrong move is shown, then taken back", true, `${wrong.san} instead of ${ply.san}`);
      check("a wrong move does not change the counters", (await page.locator(".counters").innerText()) === counters);
      await page.waitForSelector(".board.interactive");
      mistakeTested = true;
    }
    await play(ply.from, ply.to);
    answered += 1;
    await waitFor(async () => (await fen()) !== current, 5000, "move accepted");
  }
  check("every question was answered", answered > 0, `${answered} answers`);
  check("recall pass happened", mistakeTested);
  await page.screenshot({ path: join(out, "03-complete.png") });
  check("session completes", (await page.locator("h1", { hasText: "Session complete" }).count()) === 1);

  const counts = await (await fetch(`${base}/api/practice/1`)).json();
  check("learned moves are no longer new", counts.counts.fresh === freshBefore - session.total, `${freshBefore} → ${counts.counts.fresh} new`);
  const dash = await (await fetch(`${base}/api/dashboard`)).json();
  check("dashboard counts today's reviews", dash.daily.reviewed > 0, `${dash.daily.reviewed} today`);

  /* ----------------------------------------------------------- builder --- */
  await page.goto(`${base}/repertoires/2/build`);
  await page.waitForSelector(".board.interactive");
  await page.waitForSelector(".cand");
  const repBefore = (await (await fetch(`${base}/api/repertoires/2`)).json()).repertoire;
  const before = repBefore.stats.saved;
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
  check("a move played in the builder is saved", afterSave.stats.saved === before + 2, `${before} → ${afterSave.stats.saved}`);
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
