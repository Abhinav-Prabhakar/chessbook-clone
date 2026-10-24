import { chromium } from "playwright-core";
import fs from "node:fs";

/*
 * Live check for the rewritten model-games page (audit D094–D106, D185).
 * Requires the API on 8787 and Vite on 5173:
 *   CHESSBOOK_DB=<temp> PORT=8787 node server/index.js
 *   npm run dev:app
 */

const base = "http://localhost:5173";
const apiBase = "http://localhost:8787/api";
const out = "audit/model-games-desktop.png";

const reset = (gameId, ply = 0) =>
  fetch(`${apiBase}/model-games/${gameId}/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ply }),
  }).then((response) => response.json());

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

await reset(1, 0);

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(7000);

await page.goto(`${base}/model`, { waitUntil: "networkidle" });
await page.getByText("Kamsky", { exact: false }).first().waitFor();

const bodyText = () => page.locator("body").innerText();
let text = await bodyText();
check("daily game is Kamsky–Anand", /Kamsky/.test(text) && /Anand/.test(text));
check("event/result shown", /Candidats FIDE sf1/.test(text) && /White won/.test(text));
check("ratings shown", /2695/.test(text) && /2720/.test(text));
check("daily marker shown", /Today's model game/.test(text));

const graph = page.locator('[data-testid="model-evalgraph"]');
check("eval graph rendered", (await graph.count()) === 1);
const graphPoints = await graph.locator("path").nth(1).getAttribute("d");
check(
  "eval graph is sampled, not flat",
  Boolean(graphPoints) && (graphPoints.match(/L/g) ?? []).length > 20,
  `${(graphPoints?.match(/L/g) ?? []).length} segments`
);
const evalLabel = await graph.locator(".cb-evalgraph-label").innerText();
check("eval label is a real value", /^[+-]?\d+\.\d$/.test(evalLabel), evalLabel);

const savedLink = page.locator('a[href*="/build/black"]').first();
check("matching saved opening links to builder", (await savedLink.count()) > 0);

const moveList = page.locator(".cb-move-list");
check("next move is hidden", (await moveList.innerText()).includes("?"));
check(
  "hidden move does not leak Nf3",
  !(await moveList.innerText()).includes("Nf3")
);

async function play(from, to) {
  await page.locator(`[data-testid="square-${from}"]`).click();
  await page.waitForTimeout(120);
  await page.locator(`[data-testid="square-${to}"]`).click();
  await page.waitForTimeout(250);
}

// 1.e4 — the guess is validated and Black's c5 auto-plays.
await play("e2", "e4");
text = await bodyText();
check("correct guess is accepted", /Correct — e4/.test(text));
await page.waitForTimeout(900);
text = await bodyText();
check("opponent reply auto-played (c5)", (await moveList.innerText()).includes("c5"));
check("prompt moves on to White", /2\. White to move/.test(text));

// A legal but wrong move is recorded without revealing the answer.
await play("h2", "h3");
text = await bodyText();
check("wrong guess is recorded", /h3 is not the move played/.test(text));
check(
  "wrong guess does not reveal Nf3",
  !(await moveList.innerText()).includes("Nf3")
);

// Hint level 1 names the piece, level 2 names the origin square.
await page.getByText("Give me a hint", { exact: true }).click();
await page.waitForTimeout(300);
text = await bodyText();
check("first hint is a real partial hint", /knight/i.test(text));
await page.getByText("Give me a hint", { exact: true }).click();
await page.waitForTimeout(300);
text = await bodyText();
check("second hint reveals the origin square", /on g1/.test(text));
check(
  "second hint highlights the origin",
  (await page.locator('[data-testid="highlight-g1"]').count()) > 0
);

await page.getByText("Show me the move", { exact: true }).click();
await page.waitForTimeout(1000);
text = await bodyText();
check("reveal shows the move", /The move played was Nf3/.test(text));
check("after reveal the reply is shown", (await moveList.innerText()).includes("Nc6"));

await page.waitForTimeout(700);
const progress = await fetch(`${apiBase}/model-games/1`).then((response) => response.json());
check(
  "progress persisted to the server",
  progress.game.progressState.ply === 4,
  `ply ${progress.game.progressState.ply}`
);

// History, week + opening grouping.
await page.getByText("View previous model games", { exact: true }).click();
await page.getByText("Previous model games", { exact: true }).waitFor();
text = await bodyText();
check("history view opens", /Previous model games/.test(text));
check("history is grouped by week", /Week of \d{4}-\d{2}-\d{2}/.test(text));
check(
  "history lists both captured games",
  /Kamsky vs\. Anand/.test(text) && /Stein vs\. Myagmarsuren/.test(text)
);
await page.getByText("By opening", { exact: true }).click();
await page.waitForTimeout(1200);
text = await bodyText();
check(
  "history is grouped by opening",
  /Sicilian Defense|No matched opening/.test(text)
);

// Source setting: switching to online shows an explicit empty state.
await page.getByText("Back to the game", { exact: true }).click();
await page.getByText("Model games source", { exact: true }).click();
await page.locator(".cb-option", { hasText: "Online games" }).click();
await page.waitForTimeout(700);
text = await bodyText();
check("online source shows an explicit empty state", /No model games for this source/.test(text));
check("online empty reason is explicit", /No online games are connected/.test(text));
await page.getByText("Change source", { exact: true }).click();
await page.locator(".cb-option", { hasText: "Historical and master games" }).click();
await page.getByText("Choose another random game", { exact: true }).waitFor();

// Random game.
await page.getByText("Choose another random game", { exact: true }).click();
await page.waitForTimeout(900);
text = await bodyText();
check(
  "random game switches to the other captured game",
  /Stein/.test(text) && /Myagmarsuren/.test(text)
);
check(
  "captured completed game shows the completion/review screen",
  (await page.locator('[data-testid="model-complete"]').count()) === 1
);

// Completion flow on the daily game: resume at the last ply, reveal it.
await reset(1, 88);
await page.goto(`${base}/model/1`, { waitUntil: "networkidle" });
await page.getByText("Kamsky", { exact: false }).first().waitFor();
await page.getByText("Play next move", { exact: true }).click();
await page.waitForTimeout(1200);
check(
  "completion screen appears with a score",
  (await page.locator('[data-testid="model-complete"]').count()) === 1 &&
    /%/.test(await page.locator('[data-testid="model-complete"]').innerText())
);
await page.waitForTimeout(900);
const reviewed = await fetch(`${apiBase}/model-games/1`).then((response) => response.json());
check(
  "completion persists the review score",
  reviewed.game.progressState.reviewed === true &&
    typeof reviewed.game.progressState.score === "number",
  JSON.stringify(reviewed.game.progressState)
);

await page.screenshot({ path: out, fullPage: true });
console.log(`\nScreenshot: ${out}`);

const failed = results.filter((entry) => !entry.ok);
console.log(`\nRESULT ${results.length - failed.length} passed, ${failed.length} failed`);
await browser.close();
if (failed.length) process.exitCode = 1;
