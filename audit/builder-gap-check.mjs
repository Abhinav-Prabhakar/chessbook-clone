/**
 * Builder/gap UI verification (batch 2, builder-gap).
 *
 * Usage (with the API on 8787 and Vite on 5173):
 *   node audit/builder-gap-check.mjs
 *
 * It only reads through the UI except for the explicit note/exclude/autofill
 * round-trips at the end. Screenshots and a JSON report land in
 * audit/local-builder-gap/.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const exe = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "audit/local-builder-gap";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("cb_entered", "1");
  } catch {}
});

const report = { checks: [], candidates: {}, gap: {}, screenshots: [] };
function check(name, ok, detail = "") {
  report.checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function snap(name) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  report.screenshots.push(file);
  return file;
}

async function text() {
  return await page.evaluate(() => document.body.innerText);
}

async function rows() {
  return await page.evaluate(() =>
    [...document.querySelectorAll(".cb-candidate")].map((row) => ({
      move: row.querySelector(".cb-candidate-move")?.textContent?.trim(),
      name: row.querySelector(".cb-candidate-copy > strong")?.textContent?.trim(),
      copy: row.querySelector(".cb-candidate-copy")?.textContent?.trim(),
      mastery: row.querySelector(".cb-mastery")?.textContent?.trim(),
      eval: row.querySelector(".cb-eval")?.textContent?.trim(),
      peer: row.querySelector(".cb-peer")?.textContent?.trim(),
      peerLine: row
        .querySelector(".cb-candidate-stats > span:last-child .cb-row-meta")
        ?.textContent?.trim(),
      actions: [...row.querySelectorAll(".cb-candidate-actions button")].map((b) =>
        b.textContent?.trim()
      ),
    }))
  );
}

await page.goto("http://localhost:5173/build/black", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
let body = await text();
check("builder renders the title", body.includes("Continue building"));
check("builder breadcrumb carries completion", /Build\s*>?\s*\d+% complete/.test(body.replace(/\n/g, " ")));
let r = await rows();
report.candidates.start = r;
check("builder lists the full start candidate list (not one saved line)", r.length >= 15, `${r.length} rows`);
check("start candidate stats show captured masters/eval/peers", /%/.test(r[0]?.mastery ?? "") && r[0]?.eval !== "—");
await snap("01-build-start");

await page.goto("http://localhost:5173/build/black?path=e4", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
body = await text();
r = await rows();
report.candidates.afterE4 = r;
check("builder opens the exact ?path position", body.includes("Choose a response to 1. e4"));
check(
  "Black-after-1.e4 order is c5,e5,e6,c6,d5",
  r.slice(0, 5).map((row) => row.move?.split(" ").pop()).join(",") === "c5,e5,e6,c6,d5",
  r.slice(0, 5).map((row) => row.move).join(" | ")
);
const c5 = r.find((row) => row.move?.endsWith("c5"));
check("masters shows 43% (captured 42.7)", c5?.mastery?.includes("43%"), c5?.mastery);
check("eval shows +0.45 (captured 45cp)", c5?.eval?.includes("+0.45"), c5?.eval);
check("peer results are labelled percentages", c5?.peer?.includes("49") && c5?.peerLine?.includes("49% / 5% / 46%"), `${c5?.peer} / ${c5?.peerLine}`);
check("no alphabetical ECO junk on screen", !body.includes("Amar Opening") && !body.includes("Anderssen"));
await snap("02-build-after-e4");

const line = await page.evaluate(async () => {
  const data = await (await fetch("/api/repertoires/black")).json();
  return data.lines.find((l) => l.moves.length > 3) ?? data.lines[0];
});
if (line) {
  await page.goto(`http://localhost:5173/build/black?line=${line.id}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(700);
  body = await text();
  const lastPrefixMove = line.moves[line.moves.length - 2];
  check(
    "?line= opens the quizzed position (practice 'View in build mode' contract)",
    body.includes(`Choose a response to`) && body.includes(lastPrefixMove),
    `line ${line.id}: ${line.moves.join(" ")}`
  );
  const boardLast = await page.evaluate(() =>
    document.querySelector(".cb-line-moves")?.textContent?.trim()
  );
  check(
    "?line= shows the resolved prefix, not the start position",
    Boolean(boardLast) && boardLast !== "Start position" && boardLast.includes(lastPrefixMove),
    boardLast
  );
  await snap("03-build-line-param");

  await page.goto(`http://localhost:5173/build/black?path=&line=${line.id}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(600);
  body = await text();
  const rootPrefix = await page.evaluate(() =>
    document.querySelector(".cb-line-moves")?.textContent?.trim()
  );
  check(
    "?path=&line= from a root practice task opens the start position, not the line's end",
    (body.includes("Choose a move to prepare for") || body.includes("Your first move")) &&
      rootPrefix === "Start position",
    rootPrefix
  );
} else {
  check("found a seeded line", false);
}

await page.goto("http://localhost:5173/build/black?path=e4", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.getByText("Add an alternative move", { exact: true }).first().click();
await page.waitForTimeout(500);
body = await text();
check(
  "add-alternative is inline and prefix-scoped (no database modal)",
  body.includes("continue 1. e4") &&
    !body.includes("Opening database") &&
    !body.includes("Amar Opening"),
  body.includes("Type at least part of an opening name")
);
await snap("04-build-inline-alternative");
check(
  "builder exposes Build from here / Practice from here",
  body.includes("Build from here") && body.includes("Practice from here")
);
await page.getByText("Plans", { exact: true }).first().click();
await page.waitForTimeout(900);
body = await text();
check(
  "Plans opens a real panel and a model-game destination",
  body.includes("Study plans in model games") &&
    (body.includes("No plans are captured") || body.includes("captured annotations")),
  body.includes("No plans are captured") ? "no plans captured" : "captured notes"
);
await snap("04b-build-plans");

await page.goto("http://localhost:5173/gap/black", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
body = await text();
r = await rows();
report.gap.first = r;
check("gap heading uses the server's move/side", body.includes("Choose a response to 1. e4"));
check("gap breadcrumb shows completion", /Build\s*>?\s*\d+% complete/.test(body.replace(/\n/g, " ")));
check("gap shows Expected in / coverage context", body.includes("1 in") && /Coverage \d+%/.test(body));
check("gap rows show captured descriptions", r.some((row) => /counter-attacking|sharp games|center/i.test(row.copy ?? "")));
check("gap removed clone-only 'Repertoire health' sidebar", !body.includes("Repertoire health"));
check("gap removed clone-only 'More' sidebar", !/\bMore\b/.test(body));
check("gap keeps one build action", body.includes("Build from here") && !body.includes("Open in build mode"));
const firstCount = r.length;
await page.getByText("Show more", { exact: true }).first().click();
await page.waitForTimeout(900);
r = await rows();
report.gap.afterShowMore = r.length;
check("Show more paginates", r.length > firstCount, `${firstCount} → ${r.length}`);
await page.evaluate(() => document.querySelector(".cb-sidebar")?.scrollTo(0, 0));
await page.waitForTimeout(200);
await snap("05-gap");

await page.getByText("Build from here", { exact: true }).first().click();
await page.waitForTimeout(800);
check(
  "Build from here carries the exact gap position",
  page.url().includes("/build/black?epd="),
  page.url()
);
await page.goBack();
await page.waitForTimeout(800);

await page.getByText("Practice this line", { exact: true }).first().click();
await page.waitForTimeout(1200);
check(
  "Practice this line opens a line-scoped session",
  page.url().includes("mode=line") && page.url().includes("line="),
  page.url()
);
await page.goto("http://localhost:5173/gap/black", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// Notes round-trip.
await page.getByText("Add / edit notes", { exact: true }).first().click();
await page.waitForTimeout(300);
const noteText = `Verification note ${Date.now()}`;
await page.locator("textarea").last().fill(noteText);
await page.getByText("Save note", { exact: true }).first().click();
await page.waitForTimeout(1000);
body = await text();
check("position note saves and renders", body.includes(noteText), noteText);
await snap("06-gap-note");

// Exclude/re-enable round-trip on a gap candidate.
const targetSan = (await rows())[0]?.move?.split(" ").pop();
const excludeButton = page.locator(".cb-candidate-actions button", { hasText: "Exclude" }).first();
if (targetSan && (await excludeButton.count())) {
  await excludeButton.click();
  await page.waitForTimeout(900);
  body = await text();
  check("exclude move is reversible and visible", body.includes("Excluded") && body.includes("Re-enable"), targetSan);
  await snap("07-gap-excluded");
  const reenable = page.locator(".cb-candidate-actions button", { hasText: "Re-enable" }).first();
  if (await reenable.count()) {
    await reenable.click();
    await page.waitForTimeout(900);
    body = await text();
    check("re-enable restores the move", !body.includes("Excluded"), targetSan);
  }
} else {
  check("exclude flow present", false);
}

// Autofill this gap + undo (temp DB only).
const requests = [];
page.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("/api/")) return;
  if (res.request().method() === "GET") return;
  let json = null;
  try {
    json = await res.json();
  } catch {}
  requests.push({ method: res.request().method(), url: url.replace("http://localhost:5173", ""), status: res.status(), post: res.request().postData(), json });
});
await page.getByText("Autofill this gap", { exact: true }).first().click();
await page.waitForTimeout(1200);
body = await text();
report.autofill = requests;
check(
  "autofill this gap posts the exact epd and a style, not the global flag flip",
  requests.some(
    (req) =>
      req.method === "POST" &&
      req.url.includes("/autofill") &&
      (req.post ?? "").includes('"epd"') &&
      (req.post ?? "").includes('"style"')
  ),
  requests.map((req) => `${req.method} ${req.url} ${req.post ?? ""}`).join("; ")
);
check("autofill shows an undo path", body.includes("Undo autofill"));
await snap("08-gap-autofill");

await page.getByText("Go to the next gap in this line", { exact: true }).first().click();
await page.waitForTimeout(1200);
check(
  "Go to the next gap in this line advances or reports none",
  page.url().includes("/gap/black?epd=") || (await text()).includes("no other gap"),
  page.url()
);

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
const failed = report.checks.filter((c) => !c.ok);
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
await browser.close();
