import { chromium } from 'playwright-core';
import { Chess } from 'chess.js';
import fs from 'fs';
const exe = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'audit/local';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await ctx.addInitScript(() => { try { localStorage.setItem('cb_entered','1'); } catch {} });
const apis = [];
page.on('response', async (res) => {
  const u = res.url();
  if (!u.includes('/api/')) return;
  let body = '';
  try { body = (await res.text()).slice(0, 2000); } catch {}
  apis.push({ method: res.request().method(), url: u.replace('http://localhost:5173', ''), post: res.request().postData()?.slice(0, 800), status: res.status(), body });
});
let step = 0;
async function snap(name) {
  const info = await page.evaluate(() => ({
    url: location.href,
    text: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 12000),
    buttons: [...document.querySelectorAll('button')].map(b => ({ t: b.innerText.trim().replace(/\s+/g, ' '), vis: !!b.offsetParent })).filter(b => b.t && b.vis),
    inputs: [...document.querySelectorAll('input,select,textarea')].map(i => ({ type: i.type, ph: i.placeholder, name: i.name, id: i.id, value: i.value })),
  }));
  fs.writeFileSync(`${OUT}/${String(++step).padStart(2, '0')}-${name}.json`, JSON.stringify(info, null, 2));
  await page.screenshot({ path: `${OUT}/${String(step).padStart(2, '0')}-${name}.png`, fullPage: true });
  console.log(`\n### ${step} ${name} :: ${info.url}`);
  console.log(info.text.slice(0, 1800));
  console.log('BUTTONS:', info.buttons.map(b => b.t).join(' | ').slice(0, 700));
  return info;
}
async function click(text) {
  try { await page.getByText(text, { exact: true }).first().click({ force: true, timeout: 4000 }); await page.waitForTimeout(1200); return true; }
  catch (e) { console.log('CLICK FAIL', text); return false; }
}
async function api(path) { return await page.evaluate(async (p) => (await fetch(p)).json(), path); }
async function play(fen, san) {
  const c = new Chess(fen); const m = c.move(san);
  await page.locator(`[data-testid="square-${m.from}"]`).click();
  await page.waitForTimeout(200);
  await page.locator(`[data-testid="square-${m.to}"]`).click();
  await page.waitForTimeout(900);
  return m;
}
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await snap('landing');
// enter app if landing
if (await page.getByText('Enter Chessbook', { exact: false }).count()) { await page.getByText('Enter Chessbook', { exact: false }).first().click(); await page.waitForTimeout(1200); }
await snap('dashboard');
await click('Practice moves');
await snap('practice');
const next = await api('/api/practice/next?repertoire=white&mode=due');
console.log('NEXT API', JSON.stringify(next).slice(0, 1200));
if (next.line) {
  const m = await play(next.line.fen, next.line.expectedSan);
  console.log('PLAYED CORRECT', m.from, m.to, m.san);
  await snap('practice-after-correct');
  const btns = await page.locator('button').allInnerTexts();
  if (btns.some(t => t.includes('Next line'))) { await page.getByText('Next line', { exact: true }).first().click(); await page.waitForTimeout(1200); await snap('practice-next-line'); }
}
// wrong move attempt on fresh practice
await page.goto('http://localhost:5173/practice/white?mode=due', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1400);
const n2 = await api('/api/practice/next?repertoire=white&mode=due');
if (n2.line) {
  const c = new Chess(n2.line.fen);
  const legal = c.moves({ verbose: true });
  const wrong = legal.find(x => x.san !== n2.line.expectedSan);
  if (wrong) { await page.locator(`[data-testid="square-${wrong.from}"]`).click(); await page.locator(`[data-testid="square-${wrong.to}"]`).click(); await page.waitForTimeout(700); console.log('PLAYED WRONG', wrong.san, 'expected', n2.line.expectedSan); await snap('practice-after-wrong'); }
}
// learn
await page.goto('http://localhost:5173/learn/white', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); await snap('learn');
// build
await page.goto('http://localhost:5173/build/white', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); await snap('build');
await click('Add an alternative move');
await snap('build-add');
// gap
await page.goto('http://localhost:5173/gap/white', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); await snap('gap');
// model
await page.goto('http://localhost:5173/model', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); await snap('model');
// settings
await page.goto('http://localhost:5173/settings', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); await snap('settings');
// add
await page.goto('http://localhost:5173/add', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1200); await snap('add');
// repertoire
await page.goto('http://localhost:5173/repertoire/white', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); await snap('repertoire');
fs.writeFileSync(`${OUT}/network.json`, JSON.stringify(apis, null, 2));
console.log('\nAPI CALLS');
for (const a of apis) console.log(a.method, a.url, a.status, a.post || '');
await browser.close();
