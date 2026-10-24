/**
 * Coverage and gaps.
 *
 * Walk the repertoire from the start. On your turn, follow your saved move.
 * On your opponent's turn, branch into every reply weighted by how often
 * players at your level play it. A position on your turn that is reached in
 * at least 1 of every `coverageGoal` games and has no saved move is a gap.
 *
 *   completion = 1 − (share of games that run into a gap)
 */
import { applyMove, epdOf, fenOf, START_FEN, turnOf } from "./chess.js";
import { replyDistribution, openingAt } from "./explorer.js";
import { getRepertoire, graphOf, addLine } from "./repertoire.js";
import { readSettings, userBand } from "./settings.js";
import { masters, peers, scoreFor } from "./explorer.js";

const MAX_DEPTH = 30;

function primaryMove(moves, color) {
  return (moves || []).find((m) => m.mine === 1 && m.san) || null;
}

/**
 * Walk from a start position. `reach` is the share of all games that arrive
 * at the start position. Returns the gaps found and the share of games
 * covered beyond it.
 */
function walk({ graph, color, band, threshold, fen, path, reach, depth = 0, gaps, counter }) {
  counter.nodes += 1;
  if (depth > MAX_DEPTH || counter.nodes > 60000) return;
  const epd = epdOf(fen);
  if (turnOf(fen) === color) {
    const mine = primaryMove(graph.get(epd), color);
    if (!mine) {
      gaps.push({ fen, epd, path, reach });
      return;
    }
    const next = applyMove(fen, mine.san);
    if (!next) return;
    walk({ graph, color, band, threshold, fen: next.fen, path: [...path, next.san], reach, depth: depth + 1, gaps, counter });
    return;
  }
  const replies = replyDistribution(epd, band);
  for (const reply of replies) {
    const r = reach * reply.p;
    if (r < threshold) continue;
    const next = applyMove(fen, reply.san);
    if (!next) continue;
    walk({ graph, color, band, threshold, fen: next.fen, path: [...path, next.san], reach: r, depth: depth + 1, gaps, counter });
  }
}

export function coverageContext(repertoireId) {
  const repertoire = getRepertoire(repertoireId);
  const settings = readSettings();
  return {
    repertoire,
    color: repertoire.color,
    band: userBand(settings),
    goal: Number(settings.coverageGoal) || 100,
    threshold: 1 / (Number(settings.coverageGoal) || 100),
  };
}

/** How often a path is reached at your level (product of opponent move shares). */
export function reachOf(path, color, band) {
  let reach = 1;
  let fen = START_FEN;
  for (const san of path) {
    const epd = epdOf(fen);
    if (turnOf(fen) !== color) {
      const hit = replyDistribution(epd, band).find((m) => m.san === san);
      reach *= hit ? hit.p : 0;
    }
    const next = applyMove(fen, san);
    if (!next) return 0;
    fen = next.fen;
  }
  return reach;
}

export function computeCoverage(repertoireId, { from = [] } = {}) {
  const ctx = coverageContext(repertoireId);
  const graph = graphOf(repertoireId);
  let fen = START_FEN;
  for (const san of from) {
    const next = applyMove(fen, san);
    if (!next) break;
    fen = next.fen;
  }
  const reach = from.length ? reachOf(from, ctx.color, ctx.band) : 1;
  const gaps = [];
  const counter = { nodes: 0 };
  if (reach >= ctx.threshold || !from.length) {
    walk({ graph, color: ctx.color, band: ctx.band, threshold: ctx.threshold, fen, path: from, reach, gaps, counter });
  }
  gaps.sort((a, b) => b.reach - a.reach);
  const missing = gaps.reduce((sum, g) => sum + g.reach, 0);
  const completion = reach > 0 ? Math.max(0, Math.min(1, 1 - missing / reach)) : 1;
  return {
    ...ctx,
    reach,
    completion,
    completionPercent: Math.floor(completion * 100),
    gaps: gaps.map((g) => decorateGap(g)),
    nodes: counter.nodes,
  };
}

function decorateGap(gap) {
  const last = gap.path.length ? gap.path[gap.path.length - 1] : null;
  return {
    path: gap.path,
    fen: gap.fen,
    epd: gap.epd,
    reach: gap.reach,
    expectedIn: gap.reach > 0 ? Math.max(1, Math.round(1 / gap.reach)) : null,
    lastMove: last,
    ply: gap.path.length,
    opening: openingAt(gap.epd),
  };
}

/* ------------------------------------------------------------ choosing --- */

/**
 * Pick a move for your side at a position.
 *  - "mainline": the move masters play most (when it scores reasonably).
 *  - "practical": the best-scoring popular move at your level.
 */
export function chooseMove(fen, color, band, style = "mainline") {
  const epd = epdOf(fen);
  const m = masters(epd);
  const p = peers(epd, band);
  const score = (row) => scoreFor(row, color) ?? 0.5;
  if (style === "practical" && p && p.games >= 50) {
    const options = p.moves.filter((x) => x.share >= 0.05 && x.games >= 20);
    if (options.length) return options.sort((a, b) => score(b) - score(a))[0].san;
  }
  if (m && m.games >= 8) {
    const options = m.moves.filter((x) => x.share >= 0.04);
    const good = options.filter((x) => score(x) >= 0.42);
    const pick = (good.length ? good : options)[0];
    if (pick) return pick.san;
  }
  if (p && p.moves.length) {
    const options = p.moves.filter((x) => x.share >= 0.05);
    if (options.length) return options.sort((a, b) => score(b) - score(a))[0].san;
    return p.moves[0].san;
  }
  return null;
}

/**
 * Fill gaps with moves until the subtree at `from` is covered or `limit` of
 * your moves have been added. Returns the moves added (as full paths).
 */
export function autofill(repertoireId, { from = [], limit = 20, style = "mainline" } = {}) {
  const ctx = coverageContext(repertoireId);
  const added = [];
  const tried = new Set();
  for (let i = 0; i < limit; i += 1) {
    const { gaps } = computeCoverage(repertoireId, { from });
    const gap = gaps.find((g) => !tried.has(g.epd));
    if (!gap) break;
    tried.add(gap.epd);
    const san = chooseMove(gap.fen, ctx.color, ctx.band, style);
    if (!san) continue;
    const path = [...gap.path, san];
    addLine(repertoireId, path, { source: "autofill" });
    added.push({ path, san, expectedIn: gap.expectedIn });
  }
  return added;
}

export function fenAfter(path) {
  let fen = START_FEN;
  for (const san of path) {
    const next = applyMove(fen, san);
    if (!next) return null;
    fen = next.fen;
  }
  return fen;
}

export { fenOf };
