import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { Chess } from "chess.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "data");
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, "chessbook.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'pro',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS repertoires (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    color TEXT NOT NULL CHECK (color IN ('white', 'black')),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    total_lines INTEGER NOT NULL DEFAULT 50,
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

const iso = (d = new Date()) => d.toISOString();
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
const mins = (n) => new Date(Date.now() + n * 60000).toISOString();

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
  const count = db.prepare("SELECT COUNT(*) AS n FROM openings").get().n;
  if (count > 0) return;

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

function pgnFromMoves(sans) {
  const chess = new Chess();
  let out = "";
  sans.forEach((san, i) => {
    if (i % 2 === 0) out += `${i / 2 + 1}. `;
    chess.move(san);
    out += `${san} `;
  });
  return out.trim();
}

function pickOpenings(color, requiredPgns) {
  const side = color;
  const picked = [];
  const seen = new Set();

  const byPgn = db.prepare(
    "SELECT * FROM openings WHERE side = ? AND pgn = ? LIMIT 1"
  );
  for (const pgn of requiredPgns) {
    const row = byPgn.get(side, pgn);
    if (row && !seen.has(row.id)) {
      picked.push(row);
      seen.add(row.id);
    }
  }

  const pool = db
    .prepare(
      "SELECT * FROM openings WHERE side = ? AND LENGTH(sans) BETWEEN 2 AND 80 ORDER BY (id * 1103515245 + 12345) % 997, id"
    )
    .all(side);
  for (const row of pool) {
    if (picked.length >= 50) break;
    if (seen.has(row.id)) continue;
    // Keep the repertoire varied: no more than two lines with the same name.
    const same = picked.filter((p) => p.name === row.name).length;
    if (same >= 2) continue;
    picked.push(row);
    seen.add(row.id);
  }
  return picked;
}

function seedRepertoireLines(repertoireId, color) {
  const required =
    color === "white"
      ? [
          "1. e4 c5 2. Nf3",
          "1. e4 e5 2. Nf3",
          "1. d4 d5 2. c4",
          "1. e4 c6 2. d4",
          "1. e4 e6 2. d4",
          "1. d4 Nf6 2. c4",
          "1. e4 d5 2. exd5",
          "1. c4 e5 2. Nc3",
          "1. Nf3 d5 2. g3",
          "1. e4 g6 2. d4",
        ]
      : [
          "1. e4 c5",
          "1. e4 e5",
          "1. e4 c6",
          "1. e4 e6",
          "1. e4 d5",
          "1. d4 d5",
          "1. d4 Nf6",
          "1. d4 e6",
          "1. d4 c5",
          "1. c4 e5",
        ];

  const openings = pickOpenings(color, required);
  const insert = db.prepare(`
    INSERT INTO lines
      (repertoire_id, opening_id, name, moves, pgn, fen, side, expected_san,
       learned, mastered, saved, due_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  openings.forEach((opening, i) => {
    const learned = color === "white" && i < 2 ? 1 : 0;
    const mastered = color === "white" && i < 17 ? 100 : 0;
    const saved = color === "white" && i < 7 ? 1 : 0;
    const dueAt =
      color === "white" && i < 6
        ? mins(-300 + i * 30)
        : days(3 + (i % 14));
    insert.run(
      repertoireId,
      opening.id,
      opening.name,
      opening.sans,
      pgnFromMoves(opening.sans.split(" ")),
      opening.fen,
      color,
      opening.expected_san,
      learned,
      mastered,
      saved,
      dueAt,
      iso()
    );
  });
}

export function seed() {
  loadOpenings();

  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) return;

  const passwordHash = bcrypt.hashSync("local-only", 10);
  const userId = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, name, plan, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run("local@chessbook.local", passwordHash, "Alex", "pro", iso()).lastInsertRowid
  );

  db.prepare(
    "INSERT INTO settings (user_id, board_theme, coordinates, legal_moves, sound, show_hints, daily_goal) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, "green", 1, 1, 1, 1, 50);

  const whiteId = Number(
    db
      .prepare(
        "INSERT INTO repertoires (user_id, color, name, description, total_lines, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(userId, "white", "White openings", "Build a confident 1.e4 and 1.d4 repertoire.", 50, iso())
      .lastInsertRowid
  );
  const blackId = Number(
    db
      .prepare(
        "INSERT INTO repertoires (user_id, color, name, description, total_lines, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(userId, "black", "Black openings", "Answer 1.e4 and 1.d4 with a plan.", 50, iso())
      .lastInsertRowid
  );

  seedRepertoireLines(whiteId, "white");
  seedRepertoireLines(blackId, "black");

  // Give the demo a small set of past mistakes so "moves I often get wrong"
  // has real training content without affecting the current streak.
  const weakLines = db
    .prepare("SELECT id, expected_san FROM lines WHERE repertoire_id = ? ORDER BY id LIMIT 4")
    .all(whiteId);
  const insertAttempt = db.prepare(
    "INSERT INTO attempts (user_id, line_id, expected_san, played_san, correct, created_at) VALUES (?, ?, ?, ?, 0, ?)"
  );
  for (const line of weakLines) {
    insertAttempt.run(userId, line.id, line.expected_san, "e4", days(-2));
  }

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
        "INSERT INTO repertoires (user_id, color, name, description, total_lines, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(userId, color, name, description, 50, iso()).lastInsertRowid
  );
}

export function createUser(email, password, name) {
  const passwordHash = bcrypt.hashSync(password, 10);
  const userId = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, name, plan, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(email, passwordHash, name, "pro", iso()).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO settings (user_id, board_theme, coordinates, legal_moves, sound, show_hints, daily_goal) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, "green", 1, 1, 1, 1, 50);
  createRepertoire(userId, "white", "White openings", "Build a confident 1.e4 and 1.d4 repertoire.");
  createRepertoire(userId, "black", "Black openings", "Answer 1.e4 and 1.d4 with a plan.");
  return db.prepare("SELECT id, email, name, plan FROM users WHERE id = ?").get(userId);
}

export function createGuestUser() {
  // Housekeeping: guest accounts are disposable and expire after a week.
  db.prepare(
    "DELETE FROM users WHERE email LIKE 'guest-%@chessbook.local' AND created_at < ?"
  ).run(new Date(Date.now() - 7 * 86400000).toISOString());

  const suffix = crypto.randomBytes(8).toString("hex");
  const user = createUser(
    `guest-${suffix}@chessbook.local`,
    crypto.randomBytes(18).toString("hex"),
    "Guest"
  );
  const repertoires = db
    .prepare("SELECT * FROM repertoires WHERE user_id = ? ORDER BY id")
    .all(user.id);
  for (const repertoire of repertoires) {
    seedRepertoireLines(repertoire.id, repertoire.color);
  }
  return user;
}

export function searchOpenings(q, limit = 20) {
  const term = `%${q.replace(/[%_]/g, "")}%`;
  return db
    .prepare(
      "SELECT id, eco, name, pgn, sans, fen, expected_san, side, family FROM openings WHERE name LIKE ? OR eco LIKE ? ORDER BY eco, name LIMIT ?"
    )
    .all(term, term, limit);
}

seed();
