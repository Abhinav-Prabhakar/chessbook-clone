/**
 * Opening guides: named openings with their main line. Any guide can be
 * turned into a ready-made repertoire (the guide's moves, then the most
 * common master continuations up to your coverage goal).
 */
import { Router } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./db.js";
import { replay, epdOf, START_EPD } from "./chess.js";
import { masters, peers, openingForPath, percentRow } from "./explorer.js";
import { addLine, createRepertoire, httpError } from "./repertoire.js";
import { autofill } from "./coverage.js";
import { userBand } from "./settings.js";

export const content = Router();

let guides = null;
function loadGuides() {
  if (guides) return guides;
  const raw = JSON.parse(readFileSync(join(dataDir, "captured-openings.json"), "utf8")).guides || [];
  guides = raw
    .map((g) => {
      try {
        const sans = Array.isArray(g.sans) ? g.sans : String(g.sans || "").split(/\s+/).filter(Boolean);
        const { steps } = replay(sans);
        return { slug: g.slug, eco: g.eco, name: g.name, side: g.side === "black" ? "black" : "white", sans: steps.map((s) => s.san) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return guides;
}

function popularity(guide) {
  const { epd } = replay(guide.sans);
  const m = masters(epd);
  const p = peers(epd, userBand());
  return { masterGames: m?.games || 0, games: p?.games || 0 };
}

const wrap = (fn) => (req, res) => {
  try {
    res.json(fn(req));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : "Something went wrong" });
  }
};

content.get(
  "/guides",
  wrap(() => ({
    guides: loadGuides()
      .map((g) => ({ ...g, ...popularity(g) }))
      .sort((a, b) => b.games - a.games),
  }))
);

content.get(
  "/guides/:slug",
  wrap((req) => {
    const guide = loadGuides().find((g) => g.slug === req.params.slug);
    if (!guide) throw httpError(404, "Guide not found");
    const { steps, fen } = replay(guide.sans);
    const epd = epdOf(fen);
    const band = userBand();
    const m = masters(epd);
    const p = peers(epd, band);
    return {
      guide: {
        ...guide,
        fen,
        moves: steps.map((s) => ({ san: s.san, from: s.from, to: s.to, fen: s.fenAfter })),
        opening: openingForPath([START_EPD, ...steps.map((s) => s.epdAfter)]),
        masters: m ? { games: m.games, ...percentRow(m), moves: m.moves.slice(0, 6) } : null,
        peers: p ? { games: p.games, ...percentRow(p), moves: p.moves.slice(0, 6) } : null,
      },
    };
  })
);

content.post(
  "/guides/:slug/repertoire",
  wrap((req) => {
    const guide = loadGuides().find((g) => g.slug === req.params.slug);
    if (!guide) throw httpError(404, "Guide not found");
    const color = req.body?.color === "black" || req.body?.color === "white" ? req.body.color : guide.side;
    const repertoire = createRepertoire({ name: guide.name.split(":")[0].slice(0, 60), color });
    addLine(repertoire.id, guide.sans, { source: "guide" });
    const added = autofill(repertoire.id, { from: guide.sans, limit: Number(req.body?.depth) || 25 });
    return { repertoire: { id: repertoire.id, name: repertoire.name, color }, added: added.length + guide.sans.length };
  })
);
