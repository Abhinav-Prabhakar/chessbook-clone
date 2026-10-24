/**
 * Practice/Learn UI verification for the per-position training engine.
 *
 * WARNING: this resets the white repertoire's review state (reviews, sessions,
 * scheduling and notes). Always run it against a throwaway database, e.g.
 *
 *   CHESSBOOK_DB=/tmp/cb-ui.db PORT=8877 node server/index.js
 *   npx vite --config app/vite.config.ts --port 5181
 *   CB_APP=http://localhost:5181 CB_API_PORT=8877 node audit/practice-ui-flow.mjs
 */
import { chromium } from "playwright-core";
import { Chess } from "chess.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = process.env.CB_APP || "http://localhost:5173";
const API_PORT = process.env.CB_API_PORT || "8787";
const API = `http://127.0.0.1:${API_PORT}/api`;

let passed = 0;
let failed = 0;
function check(name, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${extra ? ` :: ${extra}` : ""}`);
  }
}

async function apiGet(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}
async function apiPost(path, body = {}) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}
async function apiPut(path, body = {}) {
  const response = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

async function clearSessions() {
  const { sessions } = await apiGet("/practice/sessions?repertoire=white&status=all");
  for (const session of sessions) {
    await fetch(`${API}/practice/sessions/${session.id}`, { method: "DELETE" });
  }
}

async function resetAll() {
  await apiPost("/repertoires/white/reset");
  const { notes } = await apiGet("/repertoires/white/notes");
  for (const note of notes) {
    await fetch(`${API}/notes/${note.id}`, { method: "DELETE" });
  }
}

async function currentTaskFor(mode) {
  const { sessions } = await apiGet("/practice/sessions?repertoire=white&status=active");
  const session = sessions.find((item) => !mode || item.mode === mode);
  if (!session) return null;
  const current = await apiGet(`/practice/sessions/${session.id}/current`);
  return { session, task: current.task };
}

async function clickMove(page, san, fen) {
  const chess = new Chess(fen);
  const move = chess.move(san);
  await page.locator(`[data-testid="square-${move.from}"]`).click();
  await page.waitForTimeout(120);
  await page.locator(`[data-testid="square-${move.to}"]`).click();
  await page.waitForTimeout(700);
  return move;
}

function promptText(page) {
  return page.locator('[data-testid="practice-prompt"]').innerText();
}
function dueText(page) {
  return page.locator(".cb-practice-score span").first().innerText();
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function newPage(extraInit = () => {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("cb_entered", "1");
      localStorage.setItem("cb_animation", "Off");
      localStorage.setItem("cb_sound", "0");
      localStorage.setItem("cb_legal_moves", "1");
    } catch {}
  });
  await context.addInitScript(extraInit);
  const page = await context.newPage();
  if (API_PORT !== "8787") {
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      url.protocol = "http:";
      url.hostname = "127.0.0.1";
      url.port = API_PORT;
      const response = await route.fetch({ url: url.toString() });
      await route.fulfill({ response });
    });
  }
  return { context, page };
}

/* ------------------------------------------------------------------ Learn --- */
console.log("\n## Learn screen");
await resetAll();
await clearSessions();
let { context, page } = await newPage();
await page.goto(`${APP}/learn/white`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
let learnText = await page.locator("body").innerText();
check("mastery has one decimal", /\d+\.\d% mastered/.test(learnText), learnText.slice(0, 300));
const repertoire = (await apiGet("/repertoires/white")).repertoire;
check(
  "all-moves count is saved moves, not line count",
  learnText.includes(`${repertoire.moveCount} moves`) &&
    repertoire.moveCount !== repertoire.lineCount,
  `moveCount=${repertoire.moveCount} lineCount=${repertoire.lineCount}`
);
check("empty due state is reachable", /Nothing is due right now/.test(learnText));
check(
  "daily goal is shown",
  /Daily goal \d+\/\d+/.test(learnText),
  learnText.split("\n").slice(0, 20).join(" | ")
);
check(
  "resume card absent when no session",
  (await page.locator('[data-testid="resume-session"]').count()) === 0
);

// Only saved openings are listed.
await page.getByRole("button", { name: /A specific opening/ }).click();
await page.waitForTimeout(250);
const openingRows = await page.locator(".cb-opening-row").count();
check(
  "specific-opening list only saved lines",
  openingRows === Number(repertoire.saved ?? 0),
  `rows=${openingRows} saved=${repertoire.saved} lines=${repertoire.lineCount}`
);
await page.getByRole("button", { name: "Close", exact: true }).click();
await page.waitForTimeout(200);

/* --------------------------------------------------------------- Practice --- */
console.log("\n## Practice walk (all moves)");
await page.getByRole("button", { name: /All moves, even/ }).click();
await page.waitForTimeout(900);
let text = await promptText(page);
check("starts at 1. with full-width blank", /1\./.test(text) && text.includes("＿"), text);
check("empty note line renders", text.includes("No notes added"), text);
check(
  "alternate-response indicator is shown",
  (await page.locator(".cb-inline-note").innerText()).includes("saved moves"),
  await page.locator(".cb-inline-note").innerText()
);

// Hint reveals note/origin, never the answer.
await page.getByRole("button", { name: /I don't know, give me a hint/ }).click();
await page.waitForTimeout(250);
check(
  "hint does not reveal the answer",
  (await page.locator('[data-testid="practice-expected-glyph"]').innerText()) === "＿",
  await page.locator('[data-testid="practice-expected-glyph"]').innerText()
);
check(
  "hint highlights the origin square without an answer arrow",
  (await page.locator('[data-testid="highlight-e2"]').count()) === 1 &&
    (await page.locator('[data-testid="arrow-e2-e4"]').count()) === 0,
  "origin highlight"
);
check(
  "hint text is present",
  /Look at your pawn on e2|There is no saved note/.test(
    await page.locator(".cb-inline-note").first().innerText()
  ),
  await page.locator(".cb-inline-note").first().innerText()
);

// Keyboard move: focus e2, select, arrow up twice to e4, activate.
await page.locator('[data-testid="square-e2"]').focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(120);
await page.keyboard.press("ArrowUp");
await page.keyboard.press("ArrowUp");
const focusedSquare = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
check("keyboard focus follows arrow keys", focusedSquare === "square-e4", String(focusedSquare));
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
text = await promptText(page);
const footer = await page.locator(".cb-line-moves").innerText();
check("correct answer advances to 2.", /2\./.test(text), text);
const taskBeforeWrong = (await currentTaskFor("all")).task;
const autoReply = taskBeforeWrong.autoReply;
check(
  "opponent auto-reply is in the line",
  Boolean(autoReply) &&
    footer.includes("e4") &&
    footer.includes(autoReply.san) &&
    taskBeforeWrong.prefix.length === 2,
  `autoReply=${JSON.stringify(autoReply)} footer=${footer}`
);
check(
  "auto-played opponent piece is on the board",
  Boolean(autoReply) &&
    (await page.locator(`[data-testid="piece-${autoReply.to}"]`).count()) === 1,
  autoReply ? `${autoReply.san} ${autoReply.to}` : "no autoReply"
);

// Wrong answer: counters and position are unchanged, then the board resets.
const dueBeforeWrong = await dueText(page);
const wrongProbe = new Chess(taskBeforeWrong.fen);
const wrongMove = wrongProbe
  .moves({ verbose: true })
  .find((move) => !taskBeforeWrong.acceptableSans.includes(move.san));
await clickMove(page, wrongMove.san, taskBeforeWrong.fen);
check(
  "wrong answer shows a retry/refutation notice",
  /Not quite/.test(await page.locator(".cb-inline-note").first().innerText()),
  await page.locator(".cb-inline-note").first().innerText()
);
check("wrong answer keeps the Due counter", (await dueText(page)) === dueBeforeWrong, `${dueBeforeWrong}`);
check("wrong answer keeps the same prompt", /2\./.test(await promptText(page)), await promptText(page));
check(
  "wrong answer does not change the next task",
  (await currentTaskFor("all")).task.epd === taskBeforeWrong.epd
);
check(
  "wrong move is shown as a refutation arrow",
  (await page.locator(`[data-testid="arrow-${wrongMove.from}-${wrongMove.to}"]`).count()) === 1,
  `${wrongMove.from}-${wrongMove.to}`
);
await page.waitForTimeout(1200);
check(
  "board resets to the same position",
  (await page.locator(`[data-testid="piece-${wrongMove.from}"]`).count()) === 1 &&
    (await page.locator(`[data-testid="piece-${wrongMove.to}"]`).count()) === 0,
  `${wrongMove.from}-${wrongMove.to}`
);

// Correct answer.
const task2 = (await currentTaskFor("all")).task;
await clickMove(page, task2.expectedSan, task2.fen);
const task3 = (await currentTaskFor("all")).task;
check("correct answer advances again", task3.epd !== task2.epd, await promptText(page));

// Start over resets the session counters and returns to 1.
await page.getByRole("button", { name: /start over/ }).click();
await page.waitForTimeout(700);
check("start over returns to the first position", /1\./.test(await promptText(page)));

// Alternate saved move.
const startTask = (await currentTaskFor("all")).task;
const alternate = startTask.acceptableSans.find((san) => san !== startTask.expectedSan);
await clickMove(page, alternate, startTask.fen);
const alternateNotices = await page.locator(".cb-inline-note").allInnerTexts();
check(
  "alternate saved move is accepted",
  alternateNotices.some((value) => /Accepted alternate/.test(value)),
  `played ${alternate}; expected ${startTask.expectedSan}; notices=${JSON.stringify(alternateNotices)}`
);

// Skip and keep.
const beforeSkip = await promptText(page);
await page.getByRole("button", { name: /skip this one/ }).click();
await page.waitForTimeout(700);
check("skip advances the session", (await promptText(page)) !== beforeSkip);
const beforeKeep = (await currentTaskFor("all")).task;
await page.getByRole("button", { name: /Keep this position/ }).click();
await page.waitForTimeout(700);
check(
  "keep schedules the position for review",
  (await apiGet("/repertoires/white")).repertoire.due >= 1,
  "due"
);

// Exit + resume card.
await page.getByRole("button", { name: /Exit practice/ }).click();
await page.waitForTimeout(800);
check("exit returns to Learn", page.url().endsWith("/learn/white"), page.url());
check(
  "resume card appears after leaving",
  (await page.locator('[data-testid="resume-session"]').count()) === 1
);
await page.locator('[data-testid="resume-session"]').click();
await page.waitForTimeout(900);
check(
  "resume restores the session",
  /Resumed where you left off/.test(await page.locator("body").innerText()),
  page.url()
);

/* -------------------------------------------------------- wrong-answer due --- */
console.log("\n## Due counter invariant");
await page.getByRole("button", { name: /Exit practice/ }).click();
await page.waitForTimeout(700);
await page.getByRole("button", { name: /Everything that's due/ }).click();
await page.waitForTimeout(900);
const dueTask = await currentTaskFor("due");
check("due session starts with the kept position", Boolean(dueTask?.task));
const dueBefore = await dueText(page);
const probe = new Chess(dueTask.task.fen);
const wrongCandidate = probe
  .moves({ verbose: true })
  .find((move) => !dueTask.task.acceptableSans.includes(move.san));
await clickMove(page, wrongCandidate.san, dueTask.task.fen);
check("wrong move keeps Due in a due session", (await dueText(page)) === dueBefore, `${dueBefore}`);
check("due session prompt is unchanged", /＿/.test(await promptText(page)));
await page.waitForTimeout(500);
await clickMove(page, dueTask.task.expectedSan, dueTask.task.fen);
await page.waitForTimeout(700);
check(
  "due session completes after the correct answer",
  /Session complete|Nothing is due/.test(await page.locator("body").innerText()),
  (await page.locator(".cb-page-title").first().innerText())
);
check(
  "completing a due session drops Due to zero",
  (await dueText(page)).startsWith("0"),
  await dueText(page)
);

/* ------------------------------------------------- whole-line practice mode --- */
console.log("\n## Whole-line setting");
await resetAll();
await clearSessions();
const keepSeed = await apiPost("/practice/sessions", {
  repertoire: "white",
  mode: "all",
});
await apiPost(`/practice/sessions/${keepSeed.session.id}/keep`);
await page.evaluate(() => localStorage.setItem("cb_practice_mode", "Whole lines"));
await page.goto(`${APP}/learn/white`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
await page.getByRole("button", { name: /Everything that's due/ }).click();
await page.waitForTimeout(900);
check(
  "whole-line style expands due practice to complete lines",
  /mode=specific/.test(page.url()) && /lines=/.test(page.url()),
  page.url()
);
await page.evaluate(() => localStorage.removeItem("cb_practice_mode"));

/* ----------------------------------------------------------------- Notes --- */
console.log("\n## Notes + empty due");
await resetAll();
await clearSessions();
const { task: firstTask } = await apiPost("/practice/sessions", {
  repertoire: "white",
  mode: "all",
});
await apiPut("/repertoires/white/notes", {
  epd: firstTask.epd,
  note: "Breaking in the center, the main line.",
});
await clearSessions();
await page.goto(`${APP}/practice/white?mode=all`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
check(
  "saved position note replaces 'No notes added'",
  (await page.locator('[data-testid="practice-prompt"]').innerText()).includes(
    "Breaking in the center"
  ),
  await promptText(page)
);
await page.goto(`${APP}/practice/white?mode=due`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
check(
  "direct due route shows the empty-due state",
  /Nothing is due/.test(await page.locator("body").innerText()),
  await page.locator(".cb-page-title").first().innerText()
);
await context.close();

/* ------------------------------------------------------- Drag + animation --- */
console.log("\n## Drag/drop and animation preference");
await resetAll();
await clearSessions();
({ context, page } = await newPage());
await page.goto(`${APP}/practice/white?mode=all`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
try {
  await page.dragAndDrop('[data-testid="square-e2"]', '[data-testid="square-e4"]');
  await page.waitForTimeout(900);
  check("drag-and-drop plays a move", /2\./.test(await promptText(page)), await promptText(page));
} catch (error) {
  check("drag-and-drop plays a move", false, String(error).slice(0, 160));
}
await context.close();

// Animation off: no moving-piece class ever appears.
await resetAll();
await clearSessions();
({ context, page } = await newPage());
await page.goto(`${APP}/practice/white?mode=all`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
await page.evaluate(() => {
  window.__sawAnimation = false;
  const board = document.querySelector('[data-testid="chessboard"]');
  const observer = new MutationObserver(() => {
    if (document.querySelector(".cb-piece.cb-piece-move")) window.__sawAnimation = true;
  });
  observer.observe(board, { subtree: true, childList: true, attributes: true });
});
const offAnimationTask = (await currentTaskFor("all")).task;
await clickMove(page, offAnimationTask.expectedSan, offAnimationTask.fen);
check(
  "piece animation is off when the setting is Off",
  (await page.evaluate(() => window.__sawAnimation)) === false
);
await context.close();

// Animation on (default Fast) produces the moving-piece class.
await resetAll();
await clearSessions();
({ context, page } = await newPage(() => {
  try {
    localStorage.setItem("cb_animation", "Fast");
  } catch {}
}));
await page.goto(`${APP}/practice/white?mode=all`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
await page.evaluate(() => {
  window.__sawAnimation = false;
  const board = document.querySelector('[data-testid="chessboard"]');
  const observer = new MutationObserver(() => {
    if (document.querySelector(".cb-piece.cb-piece-move")) window.__sawAnimation = true;
  });
  observer.observe(board, { subtree: true, childList: true, attributes: true });
});
const animationTask = (await currentTaskFor("all")).task;
await clickMove(page, animationTask.expectedSan, animationTask.fen);
check(
  "piece animation plays when enabled",
  (await page.evaluate(() => window.__sawAnimation)) === true
);
await context.close();

await browser.close();
console.log(`\nRESULT ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
