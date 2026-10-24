/**
 * Chessbook hardening E2E (audit D218/D220).
 *
 * Boots the built app on an isolated database and port 8796, drives the main
 * practice flow in real Chrome (wrong move, auto-reply, next move, reload
 * resume, build hand-off, completion and Due: 0), exercises offline write
 * queueing, then loads every route at desktop and 390x844 with console-error
 * capture. Screenshots are written under audit/e2e/.
 *
 * Run with:  npm run test:e2e
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { Chess } from "chess.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "audit", "e2e");
const PORT = 8796;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const checks = [];
const consoleErrors = [];

function check(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`  ${condition ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
  return Boolean(condition);
}

function chromePath() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Google Chrome not found. Set CHROME_PATH. Tried: ${CHROME_CANDIDATES.join(", ")}`);
  }
  return found;
}

async function apiGet(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

async function apiPost(path, body = {}) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

async function waitForHealth(attempts = 80) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${API}/health`);
      if (response.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The E2E server did not become healthy");
}

function startServer(dbPath) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      CHESSBOOK_DB: dbPath,
      CHESSBOOK_SKIP_OPENINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });
  return { child, log: () => log };
}

async function stopServer(child) {
  if (!child) return;
  if (child.exitCode == null) child.kill("SIGTERM");
  for (let index = 0; index < 40; index += 1) {
    if (child.exitCode != null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (child.exitCode == null) child.kill("SIGKILL");
  await new Promise((resolve) => {
    if (child.exitCode != null) return resolve();
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function portIsFree() {
  try {
    await fetch(`${API}/health`, { signal: AbortSignal.timeout(500) });
    return false;
  } catch {
    return true;
  }
}

function watch(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({ page: label, url: page.url(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push({ page: label, url: page.url(), text: `pageerror: ${error.message}` });
  });
}

async function newPage(browser, viewport, extra = () => {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("cb_entered", "1");
      localStorage.setItem("cb_animation", "Off");
      localStorage.setItem("cb_sound", "0");
    } catch {}
  });
  await context.addInitScript(extra);
  const page = await context.newPage();
  watch(page, viewport.width < 500 ? "mobile" : "desktop");
  return { context, page };
}

const promptText = (page) => page.locator('[data-testid="practice-prompt"]').innerText();
const lineText = (page) => page.locator(".cb-line-moves").innerText();
const subText = (page) => page.locator(".cb-page-sub").first().innerText();
const norm = (value) => String(value).replace(/\s+/g, " ").trim();

async function currentSession() {
  const { sessions } = await apiGet("/practice/sessions?repertoire=white&status=active");
  return sessions[0] ?? null;
}

async function currentPayload(sessionId) {
  return apiGet(`/practice/sessions/${sessionId}/current`);
}

async function clickSan(page, fen, san) {
  const chess = new Chess(fen);
  const move = chess.move(san);
  if (!move) throw new Error(`Cannot play ${san} from ${fen}`);
  await page.locator(`[data-testid="square-${move.from}"]`).click();
  await page.waitForTimeout(80);
  await page.locator(`[data-testid="square-${move.to}"]`).click();
  return move;
}

async function waitForTaskOrComplete(sessionId, beforeAnswered = -1, timeout = 5000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    last = await currentPayload(sessionId);
    if (
      last.session.complete ||
      !last.task ||
      last.session.answered > beforeAnswered
    ) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return last;
}

async function runMainFlow(browser) {
  console.log("\n## Main practice flow");
  const { context, page } = await newPage(browser, { width: 1440, height: 900 });
  const flowDir = join(OUT, "flow");
  mkdirSync(flowDir, { recursive: true });

  // Seed a deterministic Sicilian Open line: 1.e4 c5 2.Nf3 Nc6 3.d4 cxd4 4.Nxd4.
  await page.goto(`${BASE}/practice/white?mode=line&line=1`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="practice-prompt"]').waitFor({ timeout: 15000 });

  const session = await currentSession();
  check("practice starts a line session", Boolean(session), session ? session.id : "no session");
  if (!session) return;

  let payload = await currentPayload(session.id);
  check("session starts at 1.e4", payload.task?.expectedSan === "e4", payload.task?.expectedSan);
  check("start position is the initial position", payload.task?.fen?.startsWith("rnbqkbnr/pppppppp"), payload.task?.fen);
  check(
    "session id is remembered in the URL",
    new URL(page.url()).searchParams.get("session") === session.id,
    page.url()
  );
  await page.screenshot({ path: join(flowDir, "01-start.png") });

  // --- wrong move -------------------------------------------------------
  const beforePrompt = norm(await promptText(page));
  const beforeLine = norm(await lineText(page));
  const beforeDue = norm(await page.locator(".cb-practice-score span").first().innerText());
  const beforeSub = norm(await subText(page));
  const legal = new Chess(payload.task.fen).moves();
  const wrongSan = legal.find(
    (san) => san !== payload.task.expectedSan && !payload.task.acceptableSans.includes(san)
  );
  await clickSan(page, payload.task.fen, wrongSan);
  await page.waitForTimeout(700);
  const notice = await page.locator('[role="alert"]').first().innerText().catch(() => "");
  check("a wrong move is rejected", notice.includes("Not quite"), notice.slice(0, 120));
  check("wrong move keeps the position", norm(await promptText(page)) === beforePrompt, `${beforePrompt} -> ${norm(await promptText(page))}`);
  check("wrong move keeps the line", norm(await lineText(page)) === beforeLine, `${beforeLine} -> ${norm(await lineText(page))}`);
  const afterDue = norm(await page.locator(".cb-practice-score span").first().innerText());
  check("wrong move keeps the Due counter", afterDue === beforeDue, `${beforeDue} -> ${afterDue}`);
  const correctCount = norm(await page.locator(".cb-practice-score span").nth(1).innerText());
  check("wrong move does not count as solved", correctCount === "0", correctCount);
  check("wrong move keeps the remaining count", norm(await subText(page)) === beforeSub);
  check(
    "a wrong move shows the local refutation",
    /strongest reply|refutation/i.test(notice),
    notice.slice(0, 180)
  );
  await page.screenshot({ path: join(flowDir, "02-wrong-move.png") });

  // Pause-on-fail (the default) holds the board behind a Continue button.
  const continueButton = page.getByRole("button", { name: "Continue", exact: true });
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click();
    await page.waitForTimeout(200);
  }

  // --- correct e4 -> auto reply c5 -> next Nf3 -------------------------
  const beforeE4 = (await currentPayload(session.id)).session.answered;
  await clickSan(page, payload.task.fen, "e4");
  await waitForTaskOrComplete(session.id, beforeE4);
  await page.waitForTimeout(250);
  payload = await currentPayload(session.id);
  const afterE4 = await lineText(page);
  check("after e4 the opponent auto-replies c5", afterE4.includes("e4") && afterE4.includes("c5"), afterE4);
  check("after e4 the next move is Nf3", payload.task?.expectedSan === "Nf3", payload.task?.expectedSan);
  check(
    "the prefix shows 1.e4 c5",
    payload.task?.prefix?.map((move) => move.san).join(" ") === "e4 c5",
    JSON.stringify(payload.task?.prefix?.map((move) => move.san))
  );
  await page.screenshot({ path: join(flowDir, "03-after-e4.png") });

  // --- correct Nf3 -> auto reply Nc6 -> next d4 ------------------------
  const beforeNf3 = (await currentPayload(session.id)).session.answered;
  await clickSan(page, payload.task.fen, "Nf3");
  await waitForTaskOrComplete(session.id, beforeNf3);
  await page.waitForTimeout(250);
  payload = await currentPayload(session.id);
  const afterNf3 = await lineText(page);
  check(
    "after Nf3 the opponent auto-replies Nc6",
    afterNf3.includes("Nf3") && afterNf3.includes("Nc6"),
    afterNf3
  );
  check("after Nf3 the next move is d4", payload.task?.expectedSan === "d4", payload.task?.expectedSan);
  check(
    "the visible line is 1.e4 c5 2.Nf3 Nc6",
    /1\.\s*e4\s*c5\s*2\.\s*Nf3\s*Nc6/.test(afterNf3.replace(/\s+/g, " ")),
    afterNf3.replace(/\s+/g, " ")
  );
  await page.screenshot({ path: join(flowDir, "04-after-nf3.png") });

  // D034: the practice training-game link carries the current position.
  const practiceGameHref = await page
    .getByRole("link", { name: /Play a training game from here/ })
    .getAttribute("href");
  check(
    "practice exposes a training-game link with this FEN",
    Boolean(practiceGameHref?.includes("/training-games?fen=") && practiceGameHref?.includes("from=practice")),
    practiceGameHref ?? "missing"
  );

  // --- reload resumes the same position --------------------------------
  const beforeReload = norm(await promptText(page));
  const sessionId = session.id;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="practice-prompt"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  check("reload resumes the same position", norm(await promptText(page)) === beforeReload);
  const resumed = await currentPayload(sessionId);
  check(
    "reload resumes the same session and move",
    resumed.session.id === sessionId && resumed.task?.expectedSan === "d4",
    `${resumed.session.id} / ${resumed.task?.expectedSan}`
  );
  await page.screenshot({ path: join(flowDir, "05-resumed.png") });

  // --- view in build mode hands off the exact position -----------------
  await page.getByRole("button", { name: /View in build mode/ }).click();
  await page.waitForURL(/\/build\/white/, { timeout: 10000 });
  await page.waitForTimeout(700);
  const buildPath = await page.evaluate(() => new URL(window.location.href).searchParams.get("path"));
  check(
    "View in build mode opens the exact current position",
    buildPath === "e4,c5,Nf3,Nc6",
    buildPath ?? "no path"
  );
  const buildGameHref = await page
    .getByRole("link", { name: /Play a training game from here/ })
    .getAttribute("href");
  check(
    "builder exposes a training-game link with this FEN",
    Boolean(buildGameHref?.includes("/training-games?fen=") && buildGameHref?.includes("from=build")),
    buildGameHref ?? "missing"
  );
  await page.screenshot({ path: join(flowDir, "06-build-handoff.png") });

  await page.goBack({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="practice-prompt"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  check("returning from build restores the session position", norm(await promptText(page)) === beforeReload);

  // --- finish the session ----------------------------------------------
  let guard = 0;
  while (guard < 40) {
    const current = await currentPayload(sessionId);
    if (!current.task) break;
    const before = current.session.answered;
    await clickSan(page, current.task.fen, current.task.expectedSan);
    const next = await waitForTaskOrComplete(sessionId, before);
    if (!next?.task) break;
    guard += 1;
  }
  await page.waitForTimeout(500);
  const bodyText = await page.locator("body").innerText();
  check("the session reaches Review complete", /Session complete/i.test(bodyText));
  const finalScore = await page.locator(".cb-practice-score").innerText();
  check("Due is 0 at the end of the session", /^0 Due/m.test(finalScore.trim()), finalScore.replace(/\s+/g, " "));
  const repertoire = (await apiGet("/repertoires/white")).repertoire;
  check("the API reports Due 0 after the session", repertoire.due === 0, String(repertoire.due));
  const dueSession = await apiPost("/practice/sessions", { repertoire: "white", mode: "due" });
  check(
    "a new due session is complete when nothing is due",
    dueSession.session.complete === true && dueSession.session.remaining === 0
  );
  check("practice completion shows no error boundary", (await page.locator('[data-testid="error-boundary"]').count()) === 0);
  await page.screenshot({ path: join(flowDir, "07-complete.png") });

  await context.close();
}

async function runOfflineQueue(browser) {
  console.log("\n## Offline write queue");
  const { context, page } = await newPage(browser, { width: 1440, height: 900 });
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.locator(".cb-settings-list").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);

  await context.setOffline(true);
  await page.waitForTimeout(200);
  const haptics = page.locator("label.cb-switch-row").filter({ hasText: "Haptics" }).locator("input");
  await haptics.click({ force: true });
  await page.waitForTimeout(700);

  const banner = page.locator('[data-testid="offline-banner"]');
  check("offline banner appears", await banner.isVisible().catch(() => false));
  const bannerText = await banner.innerText().catch(() => "");
  check("offline banner explains queued writes", /queued|Offline/i.test(bannerText), bannerText);
  const queue = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("cb_offline_queue") || '{"items":[]}').items;
    } catch {
      return [];
    }
  });
  check(
    "the failed PATCH is stored in the local queue",
    queue.length === 1 && queue[0].method === "PATCH" && /\/settings$/.test(queue[0].path),
    JSON.stringify(queue)
  );
  await page.screenshot({ path: join(OUT, "offline-queued.png") });

  await context.setOffline(false);
  await page.waitForTimeout(400);
  try {
    await page.waitForFunction(
      () => {
        try {
          return JSON.parse(localStorage.getItem("cb_offline_queue") || '{"items":[]}').items.length === 0;
        } catch {
          return false;
        }
      },
      null,
      { timeout: 6000 }
    );
  } catch {
    if (await page.getByRole("button", { name: "Retry now" }).isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Retry now" }).click();
      await page.waitForTimeout(1200);
    }
  }
  const remaining = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("cb_offline_queue") || '{"items":[]}').items.length;
    } catch {
      return -1;
    }
  });
  check("queued writes replay when the API is reachable again", remaining === 0, String(remaining));
  const settings = await apiGet("/settings");
  check("the replayed PATCH reached SQLite", settings.settings.haptics === false, String(settings.settings.haptics));
  const bannerGone = !(await banner.isVisible().catch(() => false));
  check("the banner clears after the queue empties", bannerGone);
  await context.close();
}

async function runErrorBoundary(browser) {
  console.log("\n## Error boundary (D210)");
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    // A service worker can bypass page.route() for navigations; block it so
    // the injected malformed response deterministically reaches the boundary.
    serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("cb_entered", "1");
    } catch {}
  });
  const page = await context.newPage();
  let broken = true;
  await page.route("**/api/dashboard**", async (route) => {
    if (!broken) return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ repertoires: {}, daily: {} }),
    });
  });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="error-boundary"]').waitFor({ timeout: 10000 });
  const fallback = await page.locator('[data-testid="error-boundary"]').innerText();
  check("a render error shows a recoverable fallback", /Something went wrong/i.test(fallback));
  check("the app shell is not blanked", (await page.locator("body").innerText()).length > 40);
  await page.screenshot({ path: join(OUT, "error-boundary.png") });

  broken = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await page.locator(".cb-sidebar-dashboard").waitFor({ timeout: 15000 });
  check("Try again recovers the broken route", await page.locator(".cb-sidebar-dashboard").isVisible());
  await context.close();
}

async function runModelGuess(browser) {
  console.log("\n## Model game guess");
  const { context, page } = await newPage(browser, { width: 1440, height: 900 });
  const game = (await apiGet("/model-games/1")).game;
  check("model game is the captured 45-move Kamsky–Anand game", game.white === "Kamsky" && game.black === "Anand" && game.event === "Candidats FIDE sf1" && game.result === "1-0");
  const plies = game.plies ?? [];
  check("model game has 89 plies / 45 moves", plies.length === 89 && Math.max(...plies.map((move) => move.moveNumber)) === 45);
  await page.goto(`${BASE}/model/1`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="model-guess-prompt"]').waitFor({ timeout: 15000 });
  const prompt = await page.locator('[data-testid="model-guess-prompt"]').innerText();
  const first = plies[0];
  check("the model board hides the next move", !prompt.includes(first.san), prompt.replace(/\s+/g, " "));
  const legal = new Chess(first.fenBefore).moves();
  const wrongGuess = legal.find((san) => san !== first.san);
  await clickSan(page, first.fenBefore, wrongGuess);
  await page.waitForTimeout(500);
  const wrongBody = await page.locator("body").innerText();
  check("a wrong model guess is recorded as a miss", /not the move played/i.test(wrongBody), wrongBody.slice(0, 140));
  check("a wrong model guess keeps the same position", /1\. White to move/i.test(await page.locator('[data-testid="model-guess-prompt"]').innerText()));
  await clickSan(page, first.fenBefore, first.san);
  await page.waitForTimeout(900);
  const after = await page.locator("body").innerText();
  check("a correct model guess is recorded", /Correct\s*—\s*e4/i.test(after), after.slice(0, 160));
  const progress = await apiGet("/model-games/1");
  check("model progress advances after a guess", Number(progress.game.progressState?.ply ?? progress.game.progress ?? 0) >= 1);
  await page.screenshot({ path: join(OUT, "model-guess.png") });
  await context.close();
}

const ROUTES = [
  ["dashboard", "/dashboard"],
  ["repertoire-white", "/repertoire/white"],
  ["repertoire-black", "/repertoire/black"],
  ["build-white", "/build/white"],
  ["build-white-e4", "/build/white?path=e4"],
  ["gap-white", "/gap/white"],
  ["gap-black", "/gap/black"],
  ["learn-white", "/learn/white"],
  ["practice-white", "/practice/white"],
  ["settings", "/settings"],
  ["add", "/add"],
  ["model", "/model"],
  ["model-game", "/model/1"],
  ["training-games", "/training-games"],
  ["blunder-puzzles", "/blunder-puzzles"],
  ["intuition-builder", "/intuition-builder"],
  ["visualization", "/visualization"],
  ["vision", "/vision"],
  ["openings", "/openings"],
  ["opening-guide", "/openings/italian-game"],
  ["coaches", "/coaches"],
  ["coach-profile", "/coaches/blunder-man"],
  ["coach-apply", "/coaches/apply"],
  ["coach-review", "/coaches/review"],
  ["blog", "/blog"],
  ["blog-post", "/blog/spending-10-months-building-the-most-human-like-chess-bot"],
  ["repertoires", "/repertoires"],
  ["repertoire-slug", "/repertoires/white-openings"],
  ["welcome", "/welcome"],
  ["help", "/help"],
  ["help-anchor", "/help#training-games"],
  ["qr", "/qr"],
  ["legal", "/legal/privacy"],
];

async function runRouteSweep(browser, viewport, folder) {
  const label = viewport.width < 500 ? "mobile" : "desktop";
  console.log(`\n## Route sweep (${label} ${viewport.width}x${viewport.height})`);
  const { context, page } = await newPage(browser, viewport);
  const dir = join(OUT, folder);
  mkdirSync(dir, { recursive: true });

  for (const [name, path] of ROUTES) {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(name === "practice-white" ? 800 : 450);
    const status = response?.status() ?? 0;
    if (name !== "help-anchor") {
      check(`${label} ${path} responds`, status > 0 && status < 400, String(status));
    }
    if (name === "help-anchor") {
      const target = await page.evaluate(() => Boolean(document.getElementById("training-games")));
      check(`${label} help deep anchor exists`, target);
      const scrollY = await page.evaluate(() => window.scrollY);
      check(`${label} help deep anchor scrolls to the drill`, scrollY > 0, String(scrollY));
    }
    if (name === "qr") {
      check(`${label} /qr links to the Play Store`, (await page.locator('a[href*="play.google.com"]').count()) > 0);
      check(`${label} /qr stays local`, page.url().includes("/qr"), page.url());
    }
    if (name === "dashboard" && label === "mobile") {
      const box = await page.locator(".cb-board-col").first().boundingBox();
      check("mobile uses the clipped board strip", Boolean(box && box.height <= 200), box ? `${Math.round(box.height)}px` : "no box");
    }
    await page.screenshot({ path: join(dir, `${name}.png`) });
  }

  // Unknown routes redirect home (D170) instead of showing a 404 card.
  await page.goto(`${BASE}/this-route-does-not-exist`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const unknownUrl = new URL(page.url());
  const unknownBody = await page.locator("body").innerText();
  check(`${label} unknown route redirects home`, unknownUrl.pathname === "/", page.url());
  check(`${label} unknown route shows no 404 card`, !/Page not found/i.test(unknownBody));
  await page.screenshot({ path: join(dir, "unknown-redirect.png") });

  if (label === "desktop") {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    const dashboardVisible = await page.locator(".cb-sidebar-dashboard").isVisible().catch(() => false);
    check("desktop dashboard is reachable after entering", dashboardVisible, page.url());
  }

  await context.close();
}

async function runLanding(browser) {
  console.log("\n## Landing (fresh browser)");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    try {
      localStorage.removeItem("cb_entered");
    } catch {}
  });
  const page = await context.newPage();
  watch(page, "landing");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const body = await page.locator("body").innerText();
  check("fresh / shows the landing page", /Master openings|Try it for free/i.test(body));
  await page.screenshot({ path: join(OUT, "landing.png") });
  await context.close();
}

async function main() {
  if (!existsSync(join(ROOT, "app", "dist", "index.html"))) {
    throw new Error("app/dist is missing. Run `npm run build` first (npm run test:e2e does this).");
  }
  mkdirSync(OUT, { recursive: true });
  if (!(await portIsFree())) {
    throw new Error(`Port ${PORT} is already in use. Stop the process on it before running the E2E suite.`);
  }
  const temp = join(tmpdir(), `chessbook-e2e-${process.pid}`);
  mkdirSync(temp, { recursive: true });
  const dbPath = join(temp, "e2e.db");
  const server = startServer(dbPath);
  let browser;
  try {
    await waitForHealth();
    browser = await chromium.launch({ executablePath: chromePath(), headless: true });
    const only = (process.env.E2E_ONLY || "").split(",").map((item) => item.trim()).filter(Boolean);
    const wants = (name) => only.length === 0 || only.includes(name);
    if (wants("flow")) await runMainFlow(browser);
    if (wants("offline")) await runOfflineQueue(browser);
    if (wants("error")) await runErrorBoundary(browser);
    if (wants("model")) await runModelGuess(browser);
    if (wants("routes")) {
      await runRouteSweep(browser, { width: 1440, height: 900 }, "desktop");
      await runRouteSweep(browser, { width: 390, height: 844 }, "mobile");
    }
    if (wants("landing")) await runLanding(browser);
  } catch (error) {
    console.error(error);
    check("E2E run completes without an exception", false, error?.message || String(error));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server.child);
    if (!(await portIsFree())) {
      console.error(`[e2e] port ${PORT} is still responding after shutdown`);
    }
    const log = server.log();
    writeFileSync(join(OUT, "server.log"), log);
    if (log.trim()) console.log(`\n[server log tail]\n${log.split("\n").slice(-8).join("\n")}`);
    rmSync(temp, { recursive: true, force: true });
  }

  // Ignore expected offline network noise: the offline page logs a failed fetch.
  const unexpected = consoleErrors.filter(
    (entry) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(entry.text)
  );
  check("no unexpected console/page errors", unexpected.length === 0, JSON.stringify(unexpected.slice(0, 5)));
  writeFileSync(join(OUT, "console-errors.json"), JSON.stringify(consoleErrors, null, 2));

  const failed = checks.filter((entry) => !entry.ok);
  const summary = {
    ranAt: new Date().toISOString(),
    checks: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    failures: failed,
    consoleErrors,
  };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log("Failures:");
    for (const failure of failed) console.log(`  - ${failure.name} ${failure.detail}`);
    process.exitCode = 1;
  }
}

await main();
