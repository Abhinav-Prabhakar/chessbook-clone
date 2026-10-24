/**
 * Offline opening explorer corpora (masters + Lichess peer bands).
 *
 * `server/tools/build-explorer-data.mjs` downloads public aggregates and writes
 * two compact snapshots. They are imported once per version into SQLite and
 * then queried as dictionaries. Captured production reports always win in the
 * merge performed by `opening-data.js`; these tables are the fallback that
 * makes every seeded position show real numbers.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBand } from "./settings.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "data");

export const DATASETS = ["masters", "lichess"];
export const LICHESS_BANDS = [
  "<1200",
  "1200-1599",
  "1600-1799",
  "1800-1999",
  "2000-2399",
  "2400+",
];

const FILES = {
  masters: join(dataDir, "explorer-masters.json"),
  lichess: join(dataDir, "explorer-lichess.json"),
};

const SOURCE_LABELS = {
  masters: "pgnmentor-masters",
  lichess: "lichess-band",
};

const lookupCache = new Map();
const LOOKUP_LIMIT = 4000;

function cacheKey(epd, band, dataset) {
  return `${dataset}|${band ?? ""}|${epd}`;
}

function cacheGet(key) {
  const value = lookupCache.get(key);
  if (value) {
    lookupCache.delete(key);
    lookupCache.set(key, value);
  }
  return value || null;
}

function cacheSet(key, value) {
  lookupCache.set(key, value);
  if (lookupCache.size > LOOKUP_LIMIT) {
    lookupCache.delete(lookupCache.keys().next().value);
  }
}

function resultRow(row) {
  return {
    games: Number(row.games || 0),
    white: Number(row.white || 0),
    draw: Number(row.draw || 0),
    black: Number(row.black || 0),
  };
}

function moveMap(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(row.san_key, {
      san: row.san,
      sanKey: row.san_key,
      games: Number(row.games || 0),
      white: Number(row.white || 0),
      draw: Number(row.draw || 0),
      black: Number(row.black || 0),
      rank: Number(row.rank || 0),
    });
  }
  return map;
}

/** Map a profile rating/range to one of the Lichess export bands. */
export function lichessBandFor({ singleElo = 1800, eloRange = null } = {}) {
  const parsed = parseBand(eloRange);
  const elo = parsed ? parsed.low : Number(singleElo) || 1800;
  if (elo < 1200) return "<1200";
  if (elo < 1600) return "1200-1599";
  if (elo < 1800) return "1600-1799";
  if (elo < 2000) return "1800-1999";
  if (elo < 2400) return "2000-2399";
  return "2400+";
}

/* ---------------------------------------------------------------- import --- */

function fileStat(file) {
  if (!existsSync(file)) return null;
  const stat = statSync(file);
  return { size: stat.size, mtime: Math.floor(stat.mtimeMs) };
}

function readSnapshot(dataset) {
  const file = FILES[dataset];
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

function recordDataSource(db, dataset, version, source, count) {
  db.prepare(
    `INSERT INTO data_sources (dataset, version, source, item_count, imported_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(dataset, version) DO UPDATE SET
       source = excluded.source,
       item_count = excluded.item_count,
       imported_at = excluded.imported_at`
  ).run(`explorer-${dataset}`, version, source, count, new Date().toISOString());
}

function insertNames(db, names, version) {
  if (!names) return 0;
  const insert = db.prepare(
    `INSERT INTO opening_names (epd, full_name, friendly_name, source, updated_at)
     VALUES (?, ?, NULL, ?, ?)
     ON CONFLICT(epd) DO NOTHING`
  );
  let inserted = 0;
  const stamp = new Date().toISOString();
  for (const [epd, name] of Object.entries(names)) {
    if (!name) continue;
    inserted += Number(insert.run(epd, name, `explorer-${version}`, stamp).changes || 0);
  }
  return inserted;
}

function importMasters(db, payload) {
  const meta = payload.meta || {};
  const version = String(meta.version || "unknown");
  const source = SOURCE_LABELS.masters;
  const stamp = new Date().toISOString();

  const insertReport = db.prepare(
    `INSERT INTO explorer_reports
       (dataset, epd, games, white, draw, black, name, source, version, imported_at)
     VALUES ('masters', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMove = db.prepare(
    `INSERT INTO explorer_moves
       (report_id, epd, san, san_key, games, white, draw, black, rank)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let positions = 0;
  let moves = 0;
  for (const [epd, value] of Object.entries(payload.positions || {})) {
    if (!Array.isArray(value) || value.length < 5) continue;
    const [games, white, draw, black, moveRows] = value;
    const name = payload.names?.[epd] || null;
    const reportId = Number(
      insertReport.run(epd, games, white, draw, black, name, source, version, stamp).lastInsertRowid
    );
    positions += 1;
    let rank = 0;
    for (const row of moveRows || []) {
      if (!Array.isArray(row) || row.length < 5) continue;
      rank += 1;
      insertMove.run(
        reportId,
        epd,
        String(row[0]),
        sanKeyOf(row[0]),
        Number(row[1]) || 0,
        Number(row[2]) || 0,
        Number(row[3]) || 0,
        Number(row[4]) || 0,
        rank
      );
      moves += 1;
    }
  }
  const names = insertNames(db, payload.names, version);
  return { positions, moves, names, games: Number(meta.games || 0), version, source };
}

function importLichess(db, payload) {
  const meta = payload.meta || {};
  const version = String(meta.version || "unknown");
  const source = SOURCE_LABELS.lichess;
  const stamp = new Date().toISOString();

  const insertReport = db.prepare(
    `INSERT INTO explorer_reports
       (dataset, epd, games, white, draw, black, name, source, version, imported_at)
     VALUES ('lichess', ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  );
  const insertBandPosition = db.prepare(
    `INSERT INTO explorer_band_positions
       (dataset, epd, band, games, white, draw, black)
     VALUES ('lichess', ?, ?, ?, ?, ?, ?)`
  );
  const insertBandMove = db.prepare(
    `INSERT INTO explorer_band_moves
       (dataset, epd, band, san, san_key, games, white, draw, black, rank)
     VALUES ('lichess', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let positions = 0;
  let moves = 0;
  let bandPositions = 0;
  for (const [epd, bands] of Object.entries(payload.positions || {})) {
    if (!bands || typeof bands !== "object") continue;
    let total = { games: 0, white: 0, draw: 0, black: 0 };
    for (const value of Object.values(bands)) {
      if (!Array.isArray(value) || value.length < 5) continue;
      total = {
        games: total.games + Number(value[0] || 0),
        white: total.white + Number(value[1] || 0),
        draw: total.draw + Number(value[2] || 0),
        black: total.black + Number(value[3] || 0),
      };
    }
    if (!total.games) continue;
    insertReport.run(
      epd,
      total.games,
      total.white,
      total.draw,
      total.black,
      source,
      version,
      stamp
    );
    positions += 1;
    for (const [band, value] of Object.entries(bands)) {
      if (!LICHESS_BANDS.includes(band)) continue;
      if (!Array.isArray(value) || value.length < 5) continue;
      const [games, white, draw, black, moveRows] = value;
      insertBandPosition.run(epd, band, games, white, draw, black);
      bandPositions += 1;
      let rank = 0;
      for (const row of moveRows || []) {
        if (!Array.isArray(row) || row.length < 5) continue;
        rank += 1;
        insertBandMove.run(
          epd,
          band,
          String(row[0]),
          sanKeyOf(row[0]),
          Number(row[1]) || 0,
          Number(row[2]) || 0,
          Number(row[3]) || 0,
          Number(row[4]) || 0,
          rank
        );
        moves += 1;
      }
    }
  }
  return {
    positions,
    moves,
    bandPositions,
    games: Number(meta.games || 0),
    version,
    source,
  };
}

function sanKeyOf(san) {
  return String(san || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[!?]+$/g, "")
    .replace(/0/g, "O")
    .replace(/[+#]+$/g, "");
}

/**
 * Import both snapshots idempotently.
 *
 * Boot fast path: stat the files and compare size+mtime with the last import.
 * Only a new/changed file is parsed. Set `force` (or delete a row) to rebuild.
 */
export function importExplorerData(db, { force = false, datasets = DATASETS } = {}) {
  if (process.env.CHESSBOOK_SKIP_EXPLORER === "1") {
    return { skipped: true, imported: [] };
  }
  const imported = [];
  for (const dataset of datasets) {
    const stat = fileStat(FILES[dataset]);
    if (!stat) continue;
    const existing = db
      .prepare("SELECT * FROM explorer_imports WHERE dataset = ?")
      .get(dataset);
    if (
      !force &&
      existing &&
      Number(existing.file_size) === stat.size &&
      Number(existing.file_mtime) === stat.mtime
    ) {
      continue;
    }

    const payload = readSnapshot(dataset);
    if (!payload?.meta || !payload?.positions) continue;
    const meta = payload.meta;
    const version = String(meta.version || "unknown");

    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM explorer_reports WHERE dataset = ?").run(dataset);
      db.prepare("DELETE FROM explorer_band_positions WHERE dataset = ?").run(dataset);
      db.prepare("DELETE FROM explorer_band_moves WHERE dataset = ?").run(dataset);
      const result =
        dataset === "masters" ? importMasters(db, payload) : importLichess(db, payload);
      db.prepare(
        `INSERT INTO explorer_imports
           (dataset, version, source, games, positions, moves, bands, file_size, file_mtime, generated_at, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(dataset) DO UPDATE SET
           version = excluded.version,
           source = excluded.source,
           games = excluded.games,
           positions = excluded.positions,
           moves = excluded.moves,
           bands = excluded.bands,
           file_size = excluded.file_size,
           file_mtime = excluded.file_mtime,
           generated_at = excluded.generated_at,
           imported_at = excluded.imported_at`
      ).run(
        dataset,
        version,
        result.source,
        result.games,
        result.positions,
        result.moves,
        JSON.stringify(dataset === "lichess" ? LICHESS_BANDS : []),
        stat.size,
        stat.mtime,
        meta.generatedAt ?? null,
        new Date().toISOString()
      );
      recordDataSource(
        db,
        dataset,
        version,
        dataset === "masters"
          ? payload._provenance?.sourceUrl || "PGN Mentor player archives"
          : payload._provenance?.sourceUrl || "Lichess standard rated dumps",
        result.positions
      );
      db.exec("COMMIT");
      imported.push({ dataset, ...result, version });
      lookupCache.clear();
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw error;
    }
  }
  return { skipped: false, imported };
}

/* ---------------------------------------------------------------- lookup --- */

/** Masters aggregate for one EPD. */
export function mastersFor(db, epd) {
  const key = cacheKey(epd, null, "masters");
  const hit = cacheGet(key);
  if (hit) return hit;
  const report = db
    .prepare("SELECT * FROM explorer_reports WHERE dataset = 'masters' AND epd = ?")
    .get(epd);
  if (!report || !Number(report.games)) {
    cacheSet(key, null);
    return null;
  }
  const moves = moveMap(
    db.prepare("SELECT * FROM explorer_moves WHERE report_id = ? ORDER BY rank").all(report.id)
  );
  const value = {
    ...resultRow(report),
    name: report.name ?? null,
    source: report.source,
    dataset: "masters",
    moves,
  };
  cacheSet(key, value);
  return value;
}

/** Lichess band aggregate for one EPD (position totals + move rows). */
export function bandFor(db, epd, band) {
  if (!band) return null;
  const key = cacheKey(epd, band, "lichess");
  const hit = cacheGet(key);
  if (hit) return hit;
  const position = db
    .prepare(
      "SELECT * FROM explorer_band_positions WHERE dataset = 'lichess' AND epd = ? AND band = ?"
    )
    .get(epd, band);
  if (!position || !Number(position.games)) {
    cacheSet(key, null);
    return null;
  }
  const moves = moveMap(
    db
      .prepare(
        "SELECT * FROM explorer_band_moves WHERE dataset = 'lichess' AND epd = ? AND band = ? ORDER BY rank"
      )
      .all(epd, band)
  );
  const value = {
    ...resultRow(position),
    band,
    source: SOURCE_LABELS.lichess,
    dataset: "lichess",
    moves,
  };
  cacheSet(key, value);
  return value;
}

/** Every band that has data at this EPD (small diagnostic list). */
export function bandsFor(db, epd) {
  return db
    .prepare(
      "SELECT band, games, white, draw, black FROM explorer_band_positions WHERE dataset = 'lichess' AND epd = ? ORDER BY band"
    )
    .all(epd)
    .map((row) => ({ band: row.band, ...resultRow(row) }));
}

/** Combined view used by the candidate merge. */
export function explorerPosition(db, epd, { band = null } = {}) {
  const masters = mastersFor(db, epd);
  const peer = bandFor(db, epd, band);
  const bands = masters || peer ? bandsFor(db, epd) : [];
  return {
    available: Boolean(masters || peer),
    epd,
    masters,
    band: peer,
    bands,
    source: peer ? SOURCE_LABELS.lichess : masters ? SOURCE_LABELS.masters : null,
  };
}

/** Share of games from `epd` in which `san` was played (0..1), or null. */
export function explorerMoveShare(db, epd, san, { band = null, sanKey = null } = {}) {
  const key = sanKey || sanKeyOf(san);
  if (!key) return null;
  const masters = mastersFor(db, epd);
  const peer = band ? bandFor(db, epd, band) : null;
  const fromPeer = peer?.moves?.get(key);
  const fromMasters = masters?.moves?.get(key);
  const source = fromPeer || fromMasters;
  if (!source) return null;
  const total = fromPeer ? peer.games : masters.games;
  return total > 0 ? source.games / total : null;
}

/** Position occurrence share vs. its parent position (for gap weighting). */
export function explorerReachShare(db, parentEpd, san, { band = null } = {}) {
  return explorerMoveShare(db, parentEpd, san, { band });
}

export function explorerStatus(db) {
  const imports = db
    .prepare("SELECT * FROM explorer_imports ORDER BY dataset")
    .all()
    .map((row) => ({
      dataset: row.dataset,
      version: row.version,
      source: row.source,
      games: Number(row.games || 0),
      positions: Number(row.positions || 0),
      moves: Number(row.moves || 0),
      bands: (() => {
        try {
          return JSON.parse(row.bands || "[]");
        } catch {
          return [];
        }
      })(),
      generatedAt: row.generated_at ?? null,
      importedAt: row.imported_at,
      bytes: Number(row.file_size || 0),
    }));
  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM explorer_reports WHERE dataset = 'masters') AS masters_positions,
         (SELECT COUNT(*) FROM explorer_moves) AS masters_moves,
         (SELECT COUNT(*) FROM explorer_band_positions) AS band_positions,
         (SELECT COUNT(*) FROM explorer_band_moves) AS band_moves`
    )
    .get();
  return {
    available: imports.length > 0,
    imports,
    counts: {
      mastersPositions: Number(counts?.masters_positions || 0),
      masterMoves: Number(counts?.masters_moves || 0),
      bandPositions: Number(counts?.band_positions || 0),
      bandMoves: Number(counts?.band_moves || 0),
    },
    sources: imports.map((row) => row.source),
    contentHash: imports.map((row) => `${row.dataset}:${row.version}`).join("|"),
  };
}

/** Stable hash for the currently imported snapshot versions. */
export function explorerVersion(db) {
  const rows = db.prepare("SELECT dataset, version FROM explorer_imports ORDER BY dataset").all();
  return createHash("sha1")
    .update(rows.map((row) => `${row.dataset}:${row.version}`).join("|"))
    .digest("hex")
    .slice(0, 16);
}
