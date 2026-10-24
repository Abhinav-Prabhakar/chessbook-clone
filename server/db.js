import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { migrate } from "./schema.js";
import { rebuildRepertoireMoves } from "./repertoire.js";
import { epdOf, lineSans, pgnFromSans } from "./positions.js";
import { importCapturedData } from "./seed-data.js";
import { importExplorerData } from "./explorer-data.js";
import { SEED_LINES } from "./seed-lines.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "data");

/**
 * Local SQLite is the source of truth. `CHESSBOOK_DB` lets tests (and anyone
 * who wants a second profile) point at a different file; the default stays
 * `server/data/chessbook.db` so existing installs keep working.
 */
const dbPath = process.env.CHESSBOOK_DB
  ? process.env.CHESSBOOK_DB === ":memory:"
    ? ":memory:"
    : resolve(process.env.CHESSBOOK_DB)
  : join(dataDir, "chessbook.db");
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
export const databasePath = dbPath;

// Legacy base tables. Migrations below add the per-position engine on top of
// any existing database (audit D198).
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS repertoires (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    color TEXT NOT NULL CHECK (color IN ('white', 'black')),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    total_lines INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
    opening_id INTEGER,
    name TEXT NOT NULL,
    moves TEXT NOT NULL,
    pgn TEXT NOT NULL,
    fen TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('white', 'black')),
    expected_san TEXT NOT NULL,
    learned INTEGER NOT NULL DEFAULT 0,
    mastered INTEGER NOT NULL DEFAULT 0,
    saved INTEGER NOT NULL DEFAULT 0,
    due_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
    expected_san TEXT NOT NULL,
    played_san TEXT NOT NULL,
    correct INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    board_theme TEXT NOT NULL DEFAULT 'green',
    coordinates INTEGER NOT NULL DEFAULT 1,
    legal_moves INTEGER NOT NULL DEFAULT 1,
    sound INTEGER NOT NULL DEFAULT 1,
    show_hints INTEGER NOT NULL DEFAULT 1,
    daily_goal INTEGER NOT NULL DEFAULT 50
  );

  CREATE TABLE IF NOT EXISTS openings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eco TEXT NOT NULL,
    name TEXT NOT NULL,
    pgn TEXT NOT NULL,
    sans TEXT NOT NULL,
    fen TEXT NOT NULL,
    expected_san TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('white', 'black')),
    family TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS model_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    white TEXT NOT NULL,
    black TEXT NOT NULL,
    event TEXT NOT NULL,
    year TEXT NOT NULL,
    result TEXT NOT NULL,
    pgn TEXT NOT NULL,
    description TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS model_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES model_games(id) ON DELETE CASCADE,
    ply INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, game_id)
  );

  CREATE INDEX IF NOT EXISTS idx_lines_repertoire ON lines(repertoire_id);
  CREATE INDEX IF NOT EXISTS idx_lines_due ON lines(due_at);
  CREATE INDEX IF NOT EXISTS idx_openings_name ON openings(name);
  CREATE INDEX IF NOT EXISTS idx_openings_eco ON openings(eco);
`);

const migration = migrate(db);
if (migration.applied > 0) {
  console.log(`[db] migrated schema ${migration.from} -> ${migration.to}`);
}

const iso = (d = new Date()) => d.toISOString();

function openingInfo(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const sans = chess.history();
  if (sans.length < 1) return null;
  const before = new Chess();
  for (const san of sans.slice(0, -1)) before.move(san);
  const side = sans.length % 2 === 1 ? "white" : "black";
  return {
    sans,
    fen: before.fen(),
    expected: sans[sans.length - 1],
    side,
  };
}

/**
 * ECO import with versioning (audit D199). The five Lichess TSVs are treated as
 * one source with a combined content hash. A new hash replaces the previous
 * rows exactly once; an unchanged hash is a no-op. `opening_imports` records
 * every version so the API can report what is loaded.
 */
function loadOpenings({ force = false } = {}) {
  if (process.env.CHESSBOOK_SKIP_OPENINGS === "1") return;
  const letters = ["a", "b", "c", "d", "e"];
  const contents = new Map();
  for (const letter of letters) {
    const file = join(dataDir, `${letter}.tsv`);
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    contents.set(letter, text);
  }
  if (!contents.size) return;

  const combined = [...contents.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, text]) => `${letter}:${createHash("sha1").update(text).digest("hex")}`)
    .join("|");
  const version = createHash("sha1").update(combined).digest("hex").slice(0, 16);
  const source = "lichess-eco";

  const imported = db
    .prepare("SELECT * FROM opening_imports WHERE source = ? AND version = ?")
    .get(source, version);
  if (imported && !force) return;

  const insert = db.prepare(
    "INSERT INTO openings (eco, name, pgn, sans, fen, epd, epd_after, expected_san, side, family, source, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  let inserted = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM openings WHERE source = ?").run(source);
    for (const [letter, text] of contents) {
      void letter;
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (!line || line.startsWith("eco\t")) continue;
        const [eco, name, pgn] = line.split("\t");
        if (!eco || !name || !pgn) continue;
        try {
          const info = openingInfo(pgn);
          if (!info) continue;
          const finalChess = new Chess();
          for (const san of info.sans) finalChess.move(san);
          insert.run(
            eco,
            name,
            pgn,
            info.sans.join(" "),
            info.fen,
            epdOf(info.fen),
            epdOf(finalChess.fen()),
            info.expected,
            info.side,
            name.split(":")[0],
            source,
            version
          );
          inserted++;
        } catch {
          // Ignore malformed PGN rows.
        }
      }
    }
    db.prepare(
      `INSERT INTO opening_imports (source, version, rows, imported_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(source, version) DO UPDATE SET rows = excluded.rows, imported_at = excluded.imported_at`
    ).run(source, version, inserted, iso());
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore
    }
    throw error;
  }
  console.log(`[db] loaded ${inserted} openings (${version})`);
}

function pgnFromMoves(sans) {
  return pgnFromSans(sans);
}

export { SEED_LINES };

function findOpeningId(sans, side) {
  const joined = sans.join(" ");
  const exact = db
    .prepare("SELECT id FROM openings WHERE side = ? AND sans = ? LIMIT 1")
    .get(side, joined);
  if (exact) return exact.id;
  const longer = db
    .prepare(
      "SELECT id FROM openings WHERE side = ? AND sans LIKE ? ORDER BY LENGTH(sans) ASC LIMIT 1"
    )
    .get(side, `${joined} %`);
  return longer?.id ?? null;
}

function seedRepertoireLines(userId, repertoireId, color, entries) {
  const insert = db.prepare(`
    INSERT INTO lines
      (repertoire_id, opening_id, name, moves, pgn, fen, epd, side, expected_san,
       learned, mastered, saved, due_at, origin, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, NULL, 'seed', ?)
  `);

  for (const [name, sansText] of entries) {
    const sans = sansText.split(/\s+/).filter(Boolean);
    const chess = new Chess();
    for (const san of sans) chess.move(san);
    const finalEpd = epdOf(chess.fen());
    const fen = new Chess();
    for (const san of sans.slice(0, -1)) fen.move(san);
    insert.run(
      repertoireId,
      findOpeningId(sans, color),
      name,
      sans.join(" "),
      pgnFromMoves(sans),
      fen.fen(),
      finalEpd,
      color,
      sans[sans.length - 1],
      iso()
    );
  }

  rebuildRepertoireMoves(db, repertoireId);
  db.prepare(
    "UPDATE repertoires SET total_lines = (SELECT COUNT(*) FROM lines WHERE repertoire_id = ?) WHERE id = ?"
  ).run(repertoireId, repertoireId);
  return entries.length;
}

export function seed() {
  loadOpenings();

  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) return;

  const userId = Number(
    db
      .prepare("INSERT INTO users (email, name, created_at) VALUES (?, ?, ?)")
      .run("local@chessbook.local", "Alex", iso()).lastInsertRowid
  );

  db.prepare(
    "INSERT INTO settings (user_id, board_theme, coordinates, legal_moves, sound, show_hints, daily_goal) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, "green", 1, 1, 1, 1, 50);

  const whiteId = Number(
    db
      .prepare(
        "INSERT INTO repertoires (user_id, color, name, description, total_lines, slug, source, created_at) VALUES (?, ?, ?, ?, 0, ?, 'seed', ?)"
      )
      .run(
        userId,
        "white",
        "White openings",
        "Build a confident 1.e4 and 1.d4 repertoire.",
        "white-openings",
        iso()
      ).lastInsertRowid
  );
  const blackId = Number(
    db
      .prepare(
        "INSERT INTO repertoires (user_id, color, name, description, total_lines, slug, source, created_at) VALUES (?, ?, ?, ?, 0, ?, 'seed', ?)"
      )
      .run(
        userId,
        "black",
        "Black openings",
        "Answer 1.e4 and 1.d4 with a plan.",
        "black-openings",
        iso()
      ).lastInsertRowid
  );

  seedRepertoireLines(userId, whiteId, "white", SEED_LINES.white);
  seedRepertoireLines(userId, blackId, "black", SEED_LINES.black);

  // No seeded attempts and no seeded review state: "7 saved / 34% mastered"
  // was fabricated (D224). A fresh install honestly has nothing reviewed yet.
  // The real model games are imported from the production captures by
  // importCapturedData() below.
}

export function createRepertoire(userId, color, name, description = "") {
  const base = slugify(name) || `${color}-repertoire`;
  let slug = base;
  let suffix = 2;
  while (db.prepare("SELECT 1 FROM repertoires WHERE slug = ?").get(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return Number(
    db
      .prepare(
        "INSERT INTO repertoires (user_id, color, name, description, total_lines, slug, source, created_at) VALUES (?, ?, ?, ?, 0, ?, 'manual', ?)"
      )
      .run(userId, color, name, description, slug, iso()).lastInsertRowid
  );
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Local-first mode has exactly one profile. It is created by seed() on a fresh
 * database and never leaves this machine.
 */
export function getLocalUser() {
  return db.prepare("SELECT * FROM users ORDER BY id LIMIT 1").get() || null;
}

export function searchOpenings(q, limit = 20) {
  const term = `%${q.replace(/[%_]/g, "")}%`;
  return db
    .prepare(
      "SELECT id, eco, name, pgn, sans, fen, epd, epd_after, expected_san, side, family FROM openings WHERE name LIKE ? OR eco LIKE ? ORDER BY eco, name LIMIT ?"
    )
    .all(term, term, limit);
}

/**
 * Seed the rating/coverage profile from the captured production account the
 * first time the data becomes available. Only untouched defaults are replaced
 * (D135): a user's later choice is never overwritten on boot.
 */
function syncProfileFromCapture(db) {
  const synced = db
    .prepare("SELECT value FROM capture_profile WHERE key = 'profile_synced'")
    .get();
  if (synced) return;
  const profile = Object.fromEntries(
    db.prepare("SELECT key, value FROM capture_profile").all().map((row) => [row.key, row.value])
  );
  if (!profile.ratingSystem && !profile.singleElo && !profile.eloRange) return;
  db.prepare(
    `UPDATE settings SET
       rating_system = CASE WHEN single_elo = 1800 AND rating_system = 'Chess.com'
         THEN COALESCE(?, rating_system) ELSE rating_system END,
       single_elo = CASE WHEN single_elo = 1800
         THEN COALESCE(?, single_elo) ELSE single_elo END,
       elo_range = CASE WHEN elo_range = '1800-2000'
         THEN COALESCE(?, elo_range) ELSE elo_range END
     WHERE user_id = (SELECT id FROM users ORDER BY id LIMIT 1)`
  ).run(
    profile.ratingSystem ?? null,
    profile.singleElo == null ? null : Number(profile.singleElo),
    profile.eloRange ?? null
  );
  db.prepare(
    `UPDATE users SET
       rating_system = (SELECT rating_system FROM settings WHERE settings.user_id = users.id),
       single_elo = (SELECT single_elo FROM settings WHERE settings.user_id = users.id),
       elo_range = (SELECT elo_range FROM settings WHERE settings.user_id = users.id),
       coverage_goal = (SELECT coverage_goal FROM settings WHERE settings.user_id = users.id)`
  ).run();
  db.prepare(
    `INSERT OR REPLACE INTO capture_profile (key, value, source, imported_at)
     VALUES ('profile_synced', ?, 'server/db.js#syncProfileFromCapture', ?)`
  ).run(new Date().toISOString(), new Date().toISOString());
}

/** Update a repertoire's denominator after adding/removing lines. */
export function syncRepertoireTotals(repertoireId) {
  db.prepare(
    "UPDATE repertoires SET total_lines = (SELECT COUNT(*) FROM lines WHERE repertoire_id = ?) WHERE id = ?"
  ).run(repertoireId, repertoireId);
  return db.prepare("SELECT COUNT(*) AS n FROM lines WHERE repertoire_id = ?").get(repertoireId).n;
}

export function lineMovesFor(lineId) {
  return db.prepare("SELECT * FROM line_moves WHERE line_id = ? ORDER BY ply").all(lineId);
}

export { lineSans, pgnFromMoves, loadOpenings };

seed();

try {
  importCapturedData(db);
  syncProfileFromCapture(db);
} catch (error) {
  // A broken capture file must not stop the local trainer from booting. The
  // API reports honest `available:false` values instead of fake numbers.
  console.error(`[db] captured-data import failed: ${error.message}`);
}

try {
  importExplorerData(db);
} catch (error) {
  // The offline explorer corpora are additive. If a snapshot is missing or
  // corrupt, captured data and Stockfish still work; lookups report
  // `available:false` instead of inventing numbers.
  console.error(`[db] explorer-data import failed: ${error.message}`);
}
