import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { migrate } from "./schema.js";
import { rebuildRepertoireMoves } from "./repertoire.js";
import { lineSans, pgnFromSans } from "./positions.js";

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
    plan TEXT NOT NULL DEFAULT 'pro',
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

function loadOpenings() {
  if (process.env.CHESSBOOK_SKIP_OPENINGS === "1") return;
  const count = db.prepare("SELECT COUNT(*) AS n FROM openings").get().n;
  if (count > 0) return;
  if (!readable(join(dataDir, "a.tsv"))) return;

  const insert = db.prepare(
    "INSERT INTO openings (eco, name, pgn, sans, fen, expected_san, side, family) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  let inserted = 0;
  for (const letter of ["a", "b", "c", "d", "e"]) {
    const file = join(dataDir, `${letter}.tsv`);
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.startsWith("eco\t")) continue;
      const [eco, name, pgn] = line.split("\t");
      if (!eco || !name || !pgn) continue;
      try {
        const info = openingInfo(pgn);
        if (!info) continue;
        insert.run(
          eco,
          name,
          pgn,
          info.sans.join(" "),
          info.fen,
          info.expected,
          info.side,
          name.split(":")[0]
        );
        inserted++;
      } catch {
        // Ignore malformed PGN rows.
      }
    }
  }
  console.log(`[db] loaded ${inserted} openings`);
}

function readable(path) {
  try {
    readFileSync(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

function pgnFromMoves(sans) {
  return pgnFromSans(sans);
}

/**
 * Curated demo repertoire. Every line is a real, legal opening line that ends
 * on the repertoire colour's move. All of them are `saved=1` and none is
 * scheduled: a fresh install is a repertoire with nothing learned yet, so the
 * trainer has honest zeroes rather than invented progress (D224).
 */
export const SEED_LINES = {
  white: [
    ["Sicilian Defense: Najdorf Variation", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 h3"],
    ["Sicilian Defense: Open", "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4"],
    ["Sicilian Defense: Kan Variation", "e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 c4"],
    ["Sicilian Defense: Closed", "e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3"],
    ["Italian Game: Classical Variation", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4"],
    ["Ruy Lopez: Morphy Defense", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3"],
    ["French Defense: Classical Variation", "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4"],
    ["Caro-Kann Defense: Classical Variation", "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4"],
    ["Scandinavian Defense: Main Line", "e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3"],
    ["Queen's Gambit Declined: Harrwitz Attack", "d4 d5 c4 e6 Nc3 Nf6 Bf4 Be7 e3"],
    ["King's Indian Defense: Normal Variation", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2"],
    ["Queen's Indian Defense: Petrosian Variation", "d4 Nf6 c4 e6 Nf3 b6 a3 Bb7 Nc3"],
    ["English Opening: Four Knights System", "c4 e5 Nc3 Nf6 Nf3 Nc6 e4 Bb4 d3"],
    ["Catalan Opening: Closed", "Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 c4 O-O b3"],
    ["Bishop's Opening", "e4 e5 Bc4 Nf6 d3 c6 Nf3"],
    ["London System", "d4 d5 Nf3 Nf6 Bf4 e6 e3 c5 c3"],
  ],
  black: [
    ["Sicilian Defense: Najdorf Variation", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"],
    ["Sicilian Defense: Accelerated Dragon", "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nc3 Bg7"],
    ["Sicilian Defense: Taimanov Variation", "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7"],
    ["Italian Game: Classical Variation", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4"],
    ["Ruy Lopez: Brix Variation", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O g6"],
    ["French Defense: Classical Variation", "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5"],
    ["Caro-Kann Defense: Classical Variation", "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6"],
    ["Scandinavian Defense: Gubinsky-Melts Defense", "e4 d5 exd5 Qxd5 Nc3 Qd6 d4 Nf6 Nf3 c6"],
    ["Queen's Gambit Declined: Normal Defense", "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O"],
    ["King's Indian Defense: Normal Variation", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5"],
    ["Nimzo-Indian Defense: Normal Line", "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5"],
    ["English Opening: Four Knights Variation", "c4 e5 Nc3 Nf6 Nf3 Nc6 e4 Bb4 d3 d6"],
    ["Dutch Defense: Classical Variation", "d4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O"],
    ["Slav Defense: Modern Line", "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5"],
  ],
};

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
      (repertoire_id, opening_id, name, moves, pgn, fen, side, expected_san,
       learned, mastered, saved, due_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, NULL, ?)
  `);

  for (const [name, sansText] of entries) {
    const sans = sansText.split(/\s+/).filter(Boolean);
    const chess = new Chess();
    for (const san of sans) chess.move(san);
    const fen = new Chess();
    for (const san of sans.slice(0, -1)) fen.move(san);
    insert.run(
      repertoireId,
      findOpeningId(sans, color),
      name,
      sans.join(" "),
      pgnFromMoves(sans),
      fen.fen(),
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
      .prepare("INSERT INTO users (email, name, plan, created_at) VALUES (?, ?, ?, ?)")
      .run("local@chessbook.local", "Alex", "pro", iso()).lastInsertRowid
  );

  db.prepare(
    "INSERT INTO settings (user_id, board_theme, coordinates, legal_moves, sound, show_hints, daily_goal) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, "green", 1, 1, 1, 1, 50);

  const whiteId = Number(
    db
      .prepare(
        "INSERT INTO repertoires (user_id, color, name, description, total_lines, created_at) VALUES (?, ?, ?, ?, 0, ?)"
      )
      .run(
        userId,
        "white",
        "White openings",
        "Build a confident 1.e4 and 1.d4 repertoire.",
        iso()
      ).lastInsertRowid
  );
  const blackId = Number(
    db
      .prepare(
        "INSERT INTO repertoires (user_id, color, name, description, total_lines, created_at) VALUES (?, ?, ?, ?, 0, ?)"
      )
      .run(
        userId,
        "black",
        "Black openings",
        "Answer 1.e4 and 1.d4 with a plan.",
        iso()
      ).lastInsertRowid
  );

  seedRepertoireLines(userId, whiteId, "white", SEED_LINES.white);
  seedRepertoireLines(userId, blackId, "black", SEED_LINES.black);

  // No seeded attempts and no seeded review state: "7 saved / 34% mastered"
  // was fabricated (D224). A fresh install honestly has nothing reviewed yet.
  db.prepare(
    "INSERT INTO model_games (white, black, event, year, result, pgn, description) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    "Kamsky",
    "Anand",
    "Dortmund",
    "1992",
    "1/2-1/2",
    "1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nd7 5. Ng5 Ngf6 6. Bd3 e6 7. N1f3 Bd6 8. Qe2 h6 9. Ne4 Nxe4 10. Qxe4",
    "A model Caro-Kann game. Watch how Black trades pieces, completes development, and neutralises White's space advantage."
  );
}

export function createRepertoire(userId, color, name, description = "") {
  return Number(
    db
      .prepare(
        "INSERT INTO repertoires (user_id, color, name, description, total_lines, created_at) VALUES (?, ?, ?, ?, 0, ?)"
      )
      .run(userId, color, name, description, iso()).lastInsertRowid
  );
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
      "SELECT id, eco, name, pgn, sans, fen, expected_san, side, family FROM openings WHERE name LIKE ? OR eco LIKE ? ORDER BY eco, name LIMIT ?"
    )
    .all(term, term, limit);
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

export { lineSans, pgnFromMoves };

seed();
