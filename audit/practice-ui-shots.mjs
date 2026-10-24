import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = process.env.CB_APP || "http://localhost:5173";
const API_PORT = process.env.CB_API_PORT || "8787";
const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const post = (path, body = {}) =>
  fetch(`http://127.0.0.1:${API_PORT}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => response.json());

await post("/repertoires/white/reset");
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  localStorage.setItem("cb_entered", "1");
  localStorage.setItem("cb_animation", "Normal");
  localStorage.setItem("cb_sound", "0");
  localStorage.setItem("cb_legal_moves", "1");
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
await page.goto(`${APP}/learn/white`, { waitUntil: "domcontentloaded" });
await timeout(1200);
await page.screenshot({ path: "audit/practice-ui-learn.png", fullPage: true });
await page.goto(`${APP}/practice/white?mode=all`, { waitUntil: "domcontentloaded" });
await timeout(1200);
await page.screenshot({ path: "audit/practice-ui-start.png", fullPage: true });
await page.locator('[data-testid="square-e2"]').click();
await timeout(120);
await page.locator('[data-testid="square-e4"]').click();
await timeout(900);
await page.screenshot({ path: "audit/practice-ui-after-reply.png", fullPage: true });
await page.getByRole("button", { name: /give me a hint/ }).click();
await timeout(300);
await page.screenshot({ path: "audit/practice-ui-hint.png", fullPage: true });
await page.getByRole("button", { name: /show me the answer/ }).click();
await timeout(300);
await page.screenshot({ path: "audit/practice-ui-answer.png", fullPage: true });
await browser.close();
console.log("screenshots written");
