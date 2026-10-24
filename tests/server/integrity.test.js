import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveLineMoves, epdOf } from "../../server/positions.js";

let dir;
let db;
let dbPath;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "chessbook-legacy-"));
  dbPath = join(dir, "legacy.db");

  // Build a database in the *old* shape (no user_version, no line_moves).
  const raw = new DatabaseSync(dbPath);
  const sans = ["e4", "c5", "Nf3"];
  const derived = deriveLineMoves(sans, "white");
  const last = derived[derived.length - 1];
  raw.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'pro', created_at TEXT NOT NULL
    );
    CREATE TABLE repertoires (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      color TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      total_lines INTEGER NOT NULL DEFAULT 50, created_at TEXT NOT NULL
    );
    CREATE TABLE lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
      opening_id INTEGER, name TEXT NOT NULL, moves TEXT NOT NULL, pgn TEXT NOT NULL,
      fen TEXT NOT NULL, side TEXT NOT NULL, expected_san TEXT NOT NULL,
      learned INTEGER NOT NULL DEFAULT 0, mastered INTEGER NOT NULL DEFAULT 0,
      saved INTEGER NOT NULL DEFAULT 0, due_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
      expected_san TEXT NOT NULL, played_san TEXT NOT NULL,
      correct INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      board_theme TEXT NOT NULL DEFAULT 'green', coordinates INTEGER NOT NULL DEFAULT 1,
      legal_moves INTEGER NOT NULL DEFAULT 1, sound INTEGER NOT NULL DEFAULT 1,
      show_hints INTEGER NOT NULL DEFAULT 1, daily_goal INTEGER NOT NULL DEFAULT 50
    );
    CREATE TABLE openings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, eco TEXT NOT NULL, name TEXT NOT NULL,
      pgn TEXT NOT NULL, sans TEXT NOT NULL, fen TEXT NOT NULL,
      expected_san TEXT NOT NULL, side TEXT NOT NULL, family TEXT NOT NULL
    );
    CREATE TABLE model_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT, white TEXT NOT NULL, black TEXT NOT NULL,
      event TEXT NOT NULL, year TEXT NOT NULL, result TEXT NOT NULL,
      pgn TEXT NOT NULL, description TEXT NOT NULL
    );
    CREATE TABLE model_progress (
      user_id INTEGER NOT NULL, game_id INTEGER NOT NULL, ply INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, game_id)
    );
  `);
  raw.prepare(
    "INSERT INTO users (email, name, plan, created_at) VALUES (?, ?, 'pro', ?)"
  ).run("old@local", "Old Profile", "2026-01-01T00:00:00.000Z");
  raw.prepare(
    "INSERT INTO settings (user_id) VALUES (1)"
  ).run();
  raw.prepare(
    "INSERT INTO repertoires (user_id, color, name, description, total_lines, created_at) VALUES (1, 'white', 'White openings', '', 50, ?)"
  ).run("2026-01-01T00:00:00.000Z");
  raw.prepare(
    `INSERT INTO lines (repertoire_id, opening_id, name, moves, pgn, fen, side,
       expected_san, learned, mastered, saved, due_at, created_at)
     VALUES (1, NULL, 'Sicilian Defense', ?, '1. e4 c5 2. Nf3', ?, 'white', ?, 1, 40, 1, NULL, ?)`
  ).run(
    sans.join(" "),
    last.fen,
    last.san,
    "2026-01-01T00:00:00.000Z"
  );
  raw.prepare(
    "INSERT INTO attempts (user_id, line_id, expected_san, played_san, correct, created_at) VALUES (1, 1, 'Nf3', 'e4', 0, ?)"
  ).run("2026-10-20T10:00:00.000Z");
  raw.close();

  process.env.CHESSBOOK_DB = dbPath;
  process.env.CHESSBOOK_SKIP_OPENINGS = "1";
  const mod = await import("../../server/db.js");
  db = mod.db;
});

after(() => {
  try {
    db?.close();
  } catch {
    // ignore
  }
  rmSync(dir, { recursive: true, force: true });
});

test("an existing database is upgraded in place and lines are backfilled", () => {
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);

  const moves = db.prepare("SELECT * FROM line_moves ORDER BY ply").all();
  assert.equal(moves.length, 3);
  assert.deepEqual(moves.map((move) => move.san), ["e4", "c5", "Nf3"]);
  assert.equal(moves.filter((move) => move.is_user === 1).length, 2);
  assert.equal(moves[0].epd, epdOf(moves[0].fen));

  const reviews = db.prepare("SELECT * FROM reviews").all();
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].submission_id, "legacy-attempt-1");
  assert.equal(reviews[0].mode, "legacy");
  assert.equal(reviews[0].correct, 0);
  assert.equal(reviews[0].san, "Nf3");
  assert.equal(reviews[0].ply, 3);
  assert.equal(reviews[0].daily, "2026-10-20");

  const nf3 = moves.find((move) => move.san === "Nf3");
  assert.equal(nf3.lapses, 1);
  assert.equal(nf3.reps, 0);
  assert.equal(nf3.last_correct, 0);

  assert.equal(
    db.prepare("SELECT total_lines FROM repertoires WHERE id = 1").get().total_lines,
    1
  );
});

test("the migrated database passes the integrity audit", async () => {
  const { checkDatabase } = await import("../../server/integrity.js");
  const report = checkDatabase(db);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.counts.lines, 1);
  assert.equal(report.counts.lineMoves, 3);
  assert.equal(report.counts.reviews, 1);
});

test("backfilled mistakes drive the weak queue", async () => {
  const { buildQueue } = await import("../../server/repertoire.js");
  const repertoire = db.prepare("SELECT * FROM repertoires WHERE id = 1").get();
  const weak = buildQueue(db, repertoire, "weak");
  const nf3 = db.prepare("SELECT * FROM line_moves WHERE san = 'Nf3'").get();
  assert.deepEqual(weak, [nf3.epd]);
});

test("corrupted lines are reported by the integrity audit", async () => {
  const { checkDatabase } = await import("../../server/integrity.js");
  db.prepare(
    `INSERT INTO lines (repertoire_id, name, moves, pgn, fen, side, expected_san,
       learned, mastered, saved, due_at, created_at)
     VALUES (1, 'Broken line', 'e4 e5 Qh9', '1. e4 e5 2. Qh9', '', 'white', 'Qh9', 0, 0, 1, NULL, ?)`
  ).run(new Date().toISOString());
  db.prepare(
    `INSERT INTO lines (repertoire_id, name, moves, pgn, fen, side, expected_san,
       learned, mastered, saved, due_at, created_at)
     VALUES (1, 'Not derived', 'd4 d5 c4', '1. d4 d5 2. c4', '', 'white', 'c4', 0, 0, 1, NULL, ?)`
  ).run(new Date().toISOString());

  const report = checkDatabase(db);
  assert.equal(report.ok, false);
  const codes = new Set(report.errors.map((error) => error.code));
  assert.ok(codes.has("illegal_move"));
  assert.ok(codes.has("line_move_missing"));

  db.prepare("DELETE FROM lines WHERE name IN ('Broken line', 'Not derived')").run();
  assert.equal(checkDatabase(db).ok, true);
});

test("a migrated repertoire reports honest stats", async () => {
  const repertoire = db.prepare("SELECT * FROM repertoires WHERE id = 1").get();
  const { statsFor, buildQueue } = await import("../../server/repertoire.js");
  const stats = statsFor(db, repertoire);
  assert.equal(stats.saved, 1);
  assert.equal(stats.lineCount, 1);
  assert.equal(stats.due, 0);
  assert.equal(stats.characteristics.available, false);
  assert.equal(stats.characteristics.effectiveness, null);
  assert.equal(stats.coverage, null);
  assert.ok(buildQueue(db, repertoire, "all").length >= 1);
  assert.equal(buildQueue(db, repertoire, "due").length, 0);
});
