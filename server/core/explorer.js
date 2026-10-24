/**
 * Opening statistics: what masters play, what players at your level play,
 * and how those games turned out. Backed by the explorer tables.
 */
import { db } from "./db.js";
import { BANDS } from "./settings.js";
import { turnOf } from "./chess.js";

const cache = new Map();
const CACHE_LIMIT = 20000;

function cached(key, fn) {
  if (cache.has(key)) return cache.get(key);
  const value = fn();
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return value;
}

export function clearExplorerCache() {
  cache.clear();
}

const positionStmt = () =>
  db.prepare("SELECT games, white, draw, black FROM explorer_positions WHERE dataset = ? AND band = ? AND epd = ?");
const movesStmt = () =>
  db.prepare(
    "SELECT san, games, white, draw, black FROM explorer_moves WHERE dataset = ? AND band = ? AND epd = ? ORDER BY games DESC"
  );
let stmts = null;
function S() {
  if (!stmts) stmts = { position: positionStmt(), moves: movesStmt() };
  return stmts;
}

function read(dataset, band, epd) {
  const position = S().position.get(dataset, band, epd);
  if (!position) return null;
  const moves = S().moves.all(dataset, band, epd);
  return { ...position, moves };
}

function merge(entries) {
  const total = { games: 0, white: 0, draw: 0, black: 0 };
  const moves = new Map();
  for (const entry of entries) {
    if (!entry) continue;
    total.games += entry.games;
    total.white += entry.white;
    total.draw += entry.draw;
    total.black += entry.black;
    for (const m of entry.moves) {
      const row = moves.get(m.san) || { san: m.san, games: 0, white: 0, draw: 0, black: 0 };
      row.games += m.games;
      row.white += m.white;
      row.draw += m.draw;
      row.black += m.black;
      moves.set(m.san, row);
    }
  }
  if (!total.games) return null;
  return { ...total, moves: [...moves.values()].sort((a, b) => b.games - a.games) };
}

/** Master games at a position. */
export function masters(epd) {
  return cached(`m|${epd}`, () => decorate(read("masters", "all", epd)));
}

/**
 * Games between players around `band` at a position. Thin bands borrow
 * from neighbouring bands so a rare position still has a distribution.
 */
export function peers(epd, band) {
  return cached(`p|${band}|${epd}`, () => {
    const index = Math.max(0, BANDS.indexOf(band));
    const own = read("lichess", BANDS[index], epd);
    if (own && own.games >= 60) return decorate(own, BANDS[index]);
    const near = [index - 1, index, index + 1]
      .filter((i) => i >= 0 && i < BANDS.length)
      .map((i) => read("lichess", BANDS[i], epd));
    const merged = merge(near);
    if (merged && merged.games >= 40) return decorate(merged, "nearby");
    const all = merge(BANDS.map((b) => read("lichess", b, epd)));
    return decorate(all, "all");
  });
}

function decorate(entry, band = null) {
  if (!entry) return null;
  return {
    band,
    games: entry.games,
    white: entry.white,
    draw: entry.draw,
    black: entry.black,
    moves: entry.moves.map((m) => ({
      san: m.san,
      games: m.games,
      share: entry.games ? m.games / entry.games : 0,
      white: m.white,
      draw: m.draw,
      black: m.black,
    })),
  };
}

/** Probability that the side to move plays each move, at the user's level. */
export function replyDistribution(epd, band) {
  const p = peers(epd, band);
  if (p && p.games >= 20) return p.moves.map((m) => ({ san: m.san, p: m.share, games: m.games }));
  const m = masters(epd);
  if (m && m.games >= 10) return m.moves.map((x) => ({ san: x.san, p: x.share, games: x.games }));
  return [];
}

/** Score in [0,1] for the side that made the move, from a result row. */
export function scoreFor(row, side) {
  if (!row || !row.games) return null;
  const decisive = side === "white" ? row.white : row.black;
  return (decisive + row.draw / 2) / row.games;
}

export function percentRow(row) {
  if (!row || !row.games) return null;
  const pct = (n) => Math.round((n / row.games) * 100);
  return { games: row.games, white: pct(row.white), draw: pct(row.draw), black: pct(row.black) };
}

/* ------------------------------------------------------------- names --- */

const nameStmt = () => db.prepare("SELECT eco, name FROM openings WHERE epd = ? ORDER BY plies, id LIMIT 1");
let nameS = null;

export function openingAt(epd) {
  if (!nameS) nameS = nameStmt();
  return cached(`n|${epd}`, () => nameS.get(epd) || null);
}

/** Deepest named opening along a list of EPDs (root first). */
export function openingForPath(epds) {
  for (let i = epds.length - 1; i >= 0; i -= 1) {
    const hit = openingAt(epds[i]);
    if (hit) return hit;
  }
  return null;
}

export function sideToMove(epd) {
  return turnOf(epd);
}

export function explorerSummary() {
  const row = (dataset) =>
    db.prepare("SELECT COUNT(DISTINCT epd) AS positions FROM explorer_positions WHERE dataset = ?").get(dataset);
  const meta = (dataset) => {
    try {
      return JSON.parse(db.prepare("SELECT value FROM meta WHERE key = ?").get(`explorer-${dataset}-meta`)?.value || "{}");
    } catch {
      return {};
    }
  };
  return {
    masters: { positions: row("masters").positions, games: meta("masters").games || null },
    lichess: { positions: row("lichess").positions, games: meta("lichess").games || null },
  };
}
