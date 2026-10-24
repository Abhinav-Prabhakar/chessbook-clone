/** Promotion-picker check. WARNING: adds a line and resets review state — use a throwaway DB. */
import { chromium } from "playwright-core";
import { Chess } from "chess.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = process.env.CB_APP || "http://localhost:5173";
const API_PORT = process.env.CB_API_PORT || "8787";
const API = `http://127.0.0.1:${API_PORT}/api`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(path) {
  const response = await fetch(`${API}${path}`);
  return response.json();
}
async function post(path, body = {}) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

await post("/repertoires/white/reset");
const created = await post("/repertoires/white/lines", {
  name: "Promotion test",
  moves: ["h4", "g5", "hxg5", "h6", "gxh6", "Bg7", "hxg7", "Nc6", "gxh8=Q"],
});
if (!created.line) {
  console.error("Could not create promotion line", JSON.stringify(created));
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  localStorage.setItem("cb_entered", "1");
  localStorage.setItem("cb_animation", "Off");
  localStorage.setItem("cb_sound", "0");
});
const page = await context.newPage();
if (API_PORT !== "8787") {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    url.protocol = "http:";
    url.hostname = "127.0.0.1";
    url.port = API_PORT;
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
}
await page.goto(`${APP}/practice/white?mode=specific&line=${created.line.id}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(1000);

async function current() {
  const { sessions } = await get("/practice/sessions?repertoire=white&status=active");
  const session = sessions.find((item) => item.mode === "specific");
  if (!session) return null;
  return (await get(`/practice/sessions/${session.id}/current`)).task;
}

for (let i = 0; i < 4; i += 1) {
  const task = await current();
  if (!task) break;
  const move = new Chess(task.fen).move(task.expectedSan);
  await page.locator(`[data-testid="square-${move.from}"]`).click();
  await page.waitForTimeout(100);
  await page.locator(`[data-testid="square-${move.to}"]`).click();
  await page.waitForTimeout(650);
}

const promotionTask = await current();
const promotionMove = new Chess(promotionTask.fen).move(promotionTask.expectedSan);
await page.locator(`[data-testid="square-${promotionMove.from}"]`).click();
await page.waitForTimeout(100);
await page.locator(`[data-testid="square-${promotionMove.to}"]`).click();
await page.waitForTimeout(200);
const picker = await page.locator('[data-testid="promotion-picker"]').count();
console.log(`${picker === 1 ? "PASS" : "FAIL"} promotion picker opens on a last-rank pawn move`);

// Underpromotion is offered (and graded against the saved queen move).
await page.locator('[data-testid="promotion-n"]').click();
await page.waitForTimeout(1100);
const notice = await page.locator(".cb-inline-note").first().innerText().catch(() => "");
console.log(
  `${/Not quite|not one of your saved moves/i.test(notice) ? "PASS" : "FAIL"} underpromotion is playable and validated :: ${notice.replace(/\n/g, " ")}`
);

// Queen completes the saved move.
await page.locator(`[data-testid="square-${promotionMove.from}"]`).click();
await page.waitForTimeout(100);
await page.locator(`[data-testid="square-${promotionMove.to}"]`).click();
await page.waitForTimeout(200);
await page.locator('[data-testid="promotion-q"]').click();
await page.waitForTimeout(900);
const body = await page.locator("body").innerText();
console.log(
  `${/Session complete|Nothing is due/.test(body) ? "PASS" : "FAIL"} queen promotion completes the line`
);

await browser.close();
