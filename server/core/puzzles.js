/**
 * Puzzles from the Lichess puzzle database, picked from the openings in your
 * repertoires. A puzzle starts one move before the position: the opponent
 * plays a mistake and you find the punishment.
 */
import { db, getMeta, nowIso, setMeta } from "./db.js";
import { graphOf, listRepertoires, httpError } from "./repertoire.js";
import { openingAt } from "./explorer.js";

const DEFAULT_RATING = 1500;

export function puzzleRating() {
  return Number(getMeta("puzzleRating")) || DEFAULT_RATING;
}

/** "Sicilian Defense: Najdorf Variation, English Attack" -> Lichess tags. */
export function tagsForName(name) {
  const clean = (s) =>
    String(s || "")
      .replace(/[^A-Za-z0-9 -]/g, "")
      .trim()
      .replace(/\s+/g, "_");
  const [family, rest] = String(name).split(":");
  const variation = rest ? rest.split(",")[0] : null;
  const tags = [clean(family)];
  if (variation) tags.push(`${clean(family)}_${clean(variation)}`);
  return tags.filter(Boolean);
}

/** Opening tags (family and variation) found in your repertoires. */
export function repertoireTags() {
  const families = new Map();
  const variations = new Set();
  for (const repertoire of listRepertoires()) {
    for (const epd of graphOf(repertoire.id).keys()) {
      const hit = openingAt(epd);
      if (!hit) continue;
      const [family, variation] = tagsForName(hit.name);
      families.set(family, (families.get(family) || 0) + 1);
      if (variation) variations.add(variation);
    }
  }
  return { families: [...families.keys()], variations: [...variations] };
}

function attempted() {
  return new Set(db.prepare("SELECT DISTINCT puzzle_id FROM puzzle_attempts").all().map((r) => r.puzzle_id));
}

function serialize(row) {
  if (!row) return null;
  const tags = row.tags.split(" ").filter(Boolean);
  return {
    id: row.id,
    fen: row.fen,
    moves: row.moves.split(" "),
    rating: row.rating,
    themes: row.themes.split(" ").filter(Boolean),
    opening: tags[1] || tags[0] ? (tags[tags.length - 1] || tags[0]).replace(/_/g, " ") : null,
    family: tags[0] ? tags[0].replace(/_/g, " ") : null,
  };
}

/**
 * Next puzzle. scope "repertoire" prefers your variations, then your opening
 * families; "all" uses every opening. Rating window widens until one is found.
 */
export function nextPuzzle({ scope = "repertoire" } = {}) {
  const rating = puzzleRating();
  const done = attempted();
  const { families, variations } = repertoireTags();
  const pick = (where, params) => {
    for (const width of [150, 300, 600, 3000]) {
      const rows = db
        .prepare(
          `SELECT * FROM puzzles WHERE rating BETWEEN ? AND ? ${where ? `AND (${where})` : ""}
           ORDER BY RANDOM() LIMIT 60`
        )
        .all(rating - width, rating + width, ...params);
      const fresh = rows.find((r) => !done.has(r.id));
      if (fresh) return fresh;
    }
    return null;
  };
  const like = (tags) => tags.map(() => "(' ' || tags || ' ') LIKE ?").join(" OR ");
  const params = (tags) => tags.map((t) => `% ${t} %`);
  let row = null;
  let matched = "all";
  if (scope === "repertoire") {
    if (variations.length && Math.random() < 0.6) {
      row = pick(like(variations), params(variations));
      if (row) matched = "variation";
    }
    if (!row && families.length) {
      row = pick(like(families), params(families));
      if (row) matched = "family";
    }
  }
  if (!row) row = pick("", []);
  return { puzzle: serialize(row), rating, matched, openings: families.map((f) => f.replace(/_/g, " ")) };
}

export function recordAttempt(id, { correct }) {
  const puzzle = db.prepare("SELECT * FROM puzzles WHERE id = ?").get(String(id));
  if (!puzzle) throw httpError(404, "Puzzle not found");
  const before = puzzleRating();
  const attempts = db.prepare("SELECT COUNT(*) AS n FROM puzzle_attempts").get().n;
  const k = attempts < 20 ? 40 : 20;
  const expected = 1 / (1 + 10 ** ((puzzle.rating - before) / 400));
  const after = Math.round(Math.max(400, Math.min(3200, before + k * ((correct ? 1 : 0) - expected))));
  db.prepare(
    "INSERT INTO puzzle_attempts (puzzle_id, correct, rating_before, rating_after, at) VALUES (?, ?, ?, ?, ?)"
  ).run(puzzle.id, correct ? 1 : 0, before, after, nowIso());
  setMeta("puzzleRating", after);
  return { rating: after, change: after - before };
}

export function puzzleStats() {
  const row = db
    .prepare("SELECT COUNT(*) AS n, SUM(correct) AS ok FROM puzzle_attempts")
    .get();
  const recent = db
    .prepare(
      `SELECT a.puzzle_id AS id, a.correct, a.rating_after, a.at, p.rating, p.tags FROM puzzle_attempts a
       JOIN puzzles p ON p.id = a.puzzle_id ORDER BY a.id DESC LIMIT 12`
    )
    .all()
    .map((r) => ({
      id: r.id,
      correct: r.correct === 1,
      rating: r.rating,
      opening: (r.tags.split(" ").pop() || "").replace(/_/g, " "),
      at: r.at,
    }));
  let streak = 0;
  for (const r of recent) {
    if (!r.correct) break;
    streak += 1;
  }
  return {
    rating: puzzleRating(),
    attempts: row.n || 0,
    solved: row.ok || 0,
    streak,
    recent,
    total: db.prepare("SELECT COUNT(*) AS n FROM puzzles").get().n,
  };
}
