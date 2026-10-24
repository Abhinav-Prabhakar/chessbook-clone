/**
 * SQLite database: one local file, opened once.
 *
 * `CHESSBOOK_DB` points at another file (tests use a temp file).
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const dataDir = join(here, "..", "data");

const path = process.env.CHESSBOOK_DB
  ? process.env.CHESSBOOK_DB === ":memory:"
    ? ":memory:"
    : resolve(process.env.CHESSBOOK_DB)
  : join(dataDir, "chessbook.db");
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

export const databasePath = path;
export const db = new DatabaseSync(path);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
`);

const SCHEMA_VERSION = 2;

/**
 * Version 1 was the previous prototype (flat `lines`, captured reports…).
 * Its tables are dropped: nothing in it was real review history.
 */
function dropLegacy() {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
  db.exec("PRAGMA foreign_keys = OFF");
  for (const name of tables) db.exec(`DROP TABLE IF EXISTS "${name}"`);
  db.exec("PRAGMA foreign_keys = ON");
}

// The previous prototype used its own schema; anything without our marker
// is that schema and is replaced.
function currentSchema() {
  const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  if (!hasMeta) return null;
  return db.prepare("SELECT value FROM meta WHERE key = 'schema'").get()?.value ?? null;
}
const anyTables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get().n;
if (anyTables && currentSchema() !== String(SCHEMA_VERSION)) dropLegacy();

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS repertoires (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL CHECK (color IN ('white', 'black')),
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- A repertoire is a graph of saved moves keyed by position (EPD).
  -- "mine" moves are the ones you have to remember; opponent moves are the
  -- replies you have prepared for.
  CREATE TABLE IF NOT EXISTS moves (
    id INTEGER PRIMARY KEY,
    repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
    epd TEXT NOT NULL,
    san TEXT NOT NULL,
    uci TEXT NOT NULL,
    child_epd TEXT NOT NULL,
    mine INTEGER NOT NULL,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'user',
    added_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'new',
    stability REAL,
    difficulty REAL,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    due_at TEXT,
    last_review TEXT,
    UNIQUE (repertoire_id, epd, san)
  );
  CREATE INDEX IF NOT EXISTS moves_by_epd ON moves (repertoire_id, epd);
  CREATE INDEX IF NOT EXISTS moves_by_child ON moves (repertoire_id, child_epd);

  CREATE TABLE IF NOT EXISTS position_notes (
    repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
    epd TEXT NOT NULL,
    note TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (repertoire_id, epd)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY,
    repertoire_id INTEGER NOT NULL,
    move_id INTEGER,
    epd TEXT NOT NULL,
    san TEXT NOT NULL,
    played TEXT,
    correct INTEGER NOT NULL,
    grade INTEGER,
    kind TEXT NOT NULL,
    submission_id TEXT UNIQUE,
    at TEXT NOT NULL,
    day TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reviews_by_day ON reviews (day);
  CREATE INDEX IF NOT EXISTS reviews_by_move ON reviews (move_id);

  CREATE TABLE IF NOT EXISTS openings (
    id INTEGER PRIMARY KEY,
    eco TEXT NOT NULL,
    name TEXT NOT NULL,
    pgn TEXT NOT NULL,
    epd TEXT NOT NULL,
    plies INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS openings_by_epd ON openings (epd);

  CREATE TABLE IF NOT EXISTS explorer_positions (
    dataset TEXT NOT NULL,
    band TEXT NOT NULL,
    epd TEXT NOT NULL,
    games INTEGER NOT NULL,
    white INTEGER NOT NULL,
    draw INTEGER NOT NULL,
    black INTEGER NOT NULL,
    PRIMARY KEY (dataset, band, epd)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS explorer_moves (
    dataset TEXT NOT NULL,
    band TEXT NOT NULL,
    epd TEXT NOT NULL,
    san TEXT NOT NULL,
    games INTEGER NOT NULL,
    white INTEGER NOT NULL,
    draw INTEGER NOT NULL,
    black INTEGER NOT NULL,
    PRIMARY KEY (dataset, band, epd, san)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS engine_cache (
    epd TEXT PRIMARY KEY,
    depth INTEGER NOT NULL,
    json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS master_games (
    id INTEGER PRIMARY KEY,
    white TEXT NOT NULL,
    black TEXT NOT NULL,
    white_elo INTEGER,
    black_elo INTEGER,
    event TEXT,
    year INTEGER,
    result TEXT NOT NULL,
    eco TEXT,
    sans TEXT NOT NULL,
    plies INTEGER NOT NULL
  );

  -- Position index into master games (first 30 plies) for model-game lookup.
  CREATE TABLE IF NOT EXISTS master_game_positions (
    epd TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    ply INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS mgp_by_epd ON master_game_positions (epd);

  CREATE TABLE IF NOT EXISTS model_progress (
    game_id INTEGER PRIMARY KEY,
    repertoire_id INTEGER,
    side TEXT NOT NULL,
    match_plies INTEGER NOT NULL DEFAULT 0,
    ply INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    wrong INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    daily_day TEXT
  );

  CREATE TABLE IF NOT EXISTS puzzles (
    id TEXT PRIMARY KEY,
    fen TEXT NOT NULL,
    moves TEXT NOT NULL,
    rating INTEGER NOT NULL,
    popularity INTEGER NOT NULL,
    plays INTEGER NOT NULL,
    themes TEXT NOT NULL,
    tags TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS puzzles_by_rating ON puzzles (rating);

  CREATE TABLE IF NOT EXISTS puzzle_attempts (
    id INTEGER PRIMARY KEY,
    puzzle_id TEXT NOT NULL,
    correct INTEGER NOT NULL,
    rating_before INTEGER NOT NULL,
    rating_after INTEGER NOT NULL,
    at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS training_games (
    id TEXT PRIMARY KEY,
    color TEXT NOT NULL,
    bot_rating INTEGER NOT NULL,
    start_fen TEXT NOT NULL,
    sans TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'playing',
    result TEXT,
    reason TEXT,
    repertoire_id INTEGER,
    left_book_ply INTEGER,
    review TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drill_attempts (
    id INTEGER PRIMARY KEY,
    drill TEXT NOT NULL,
    item TEXT,
    correct INTEGER NOT NULL,
    at TEXT NOT NULL
  );
`);
db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION));

export function getMeta(key) {
  return db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
}

export function setMeta(key, value) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value == null ? null : String(value));
}

/** Run `fn` inside a transaction. */
export function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export const nowIso = () => new Date().toISOString();
