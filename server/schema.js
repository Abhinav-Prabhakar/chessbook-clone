/**
 * Schema migrations.
 *
 * `PRAGMA user_version` is the migration cursor. Every migration is applied
 * once, in order, inside a transaction. Existing installs (including an old
 * `server/data/chessbook.db`) are upgraded in place and their lines are
 * backfilled into the per-position `line_moves` table.
 */

import { deriveLineMoves, lineSans, sanKey } from "./positions.js";
import { localDay } from "./dates.js";
import { rebuildRepertoireMoves } from "./repertoire.js";

const MIGRATIONS = [
  {
    version: 1,
    name: "per-position training engine",
    up(db) {
      // --- profile fields the trainer needs (never account/billing fields) ---
      addColumn(db, "users", "training_rating", "REAL NOT NULL DEFAULT 1200");
      addColumn(db, "users", "training_rating_deviation", "REAL NOT NULL DEFAULT 350");
      addColumn(db, "users", "training_rating_volatility", "REAL NOT NULL DEFAULT 0.06");
      addColumn(db, "users", "current_streak", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "users", "highest_streak", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "users", "last_streak_date", "TEXT");

      // --- model game progress: completion/review state (D207) ---
      addColumn(db, "model_progress", "completed", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "model_progress", "reviewed", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "model_progress", "score", "REAL");
      addColumn(db, "model_progress", "completed_at", "TEXT");
      addColumn(db, "model_progress", "reviewed_at", "TEXT");
      addColumn(db, "model_progress", "updated_at", "TEXT");

      // --- per-position/move repertoire graph (D003/D204) ---
      db.exec(`
        CREATE TABLE IF NOT EXISTS line_moves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
          line_id INTEGER REFERENCES lines(id) ON DELETE SET NULL,
          epd TEXT NOT NULL,
          fen TEXT NOT NULL,
          ply INTEGER NOT NULL,
          move_number INTEGER NOT NULL,
          san TEXT NOT NULL,
          san_key TEXT NOT NULL,
          uci TEXT NOT NULL DEFAULT '',
          side TEXT NOT NULL CHECK (side IN ('white', 'black')),
          is_user INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL DEFAULT 'new',
          stability REAL NOT NULL DEFAULT 0,
          difficulty REAL NOT NULL DEFAULT 0,
          lapses INTEGER NOT NULL DEFAULT 0,
          reps INTEGER NOT NULL DEFAULT 0,
          wrong_count INTEGER NOT NULL DEFAULT 0,
          last_correct INTEGER,
          due_at TEXT,
          last_review TEXT,
          kept INTEGER NOT NULL DEFAULT 0,
          learned INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (repertoire_id, epd, san_key)
        );

        CREATE INDEX IF NOT EXISTS idx_line_moves_rep_user
          ON line_moves(repertoire_id, is_user, due_at);
        CREATE INDEX IF NOT EXISTS idx_line_moves_epd
          ON line_moves(repertoire_id, epd);
        CREATE INDEX IF NOT EXISTS idx_line_moves_line
          ON line_moves(line_id);

        CREATE TABLE IF NOT EXISTS reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
          line_move_id INTEGER REFERENCES line_moves(id) ON DELETE SET NULL,
          line_id INTEGER REFERENCES lines(id) ON DELETE SET NULL,
          session_id TEXT,
          epd TEXT NOT NULL,
          ply INTEGER NOT NULL,
          san TEXT NOT NULL,
          played_san TEXT NOT NULL,
          side TEXT NOT NULL CHECK (side IN ('white', 'black')),
          correct INTEGER NOT NULL,
          grade INTEGER,
          mode TEXT NOT NULL DEFAULT 'due',
          daily TEXT,
          submission_id TEXT UNIQUE,
          response_json TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_reviews_user_day ON reviews(user_id, daily);
        CREATE INDEX IF NOT EXISTS idx_reviews_move ON reviews(line_move_id);
        CREATE INDEX IF NOT EXISTS idx_reviews_rep ON reviews(repertoire_id, created_at);

        CREATE TABLE IF NOT EXISTS practice_sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
          mode TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          queue TEXT NOT NULL DEFAULT '[]',
          seen TEXT NOT NULL DEFAULT '[]',
          cursor INTEGER NOT NULL DEFAULT 0,
          total INTEGER NOT NULL DEFAULT 0,
          correct INTEGER NOT NULL DEFAULT 0,
          wrong INTEGER NOT NULL DEFAULT 0,
          skipped INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user_status
          ON practice_sessions(user_id, status, updated_at);

        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
          epd TEXT NOT NULL,
          san TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (repertoire_id, epd, san)
        );

        CREATE INDEX IF NOT EXISTS idx_notes_rep_epd ON notes(repertoire_id, epd);
      `);

      // --- backfill the move graph from every existing line ---
      const repertoires = db.prepare("SELECT id FROM repertoires ORDER BY id").all();
      for (const repertoire of repertoires) {
        rebuildRepertoireMoves(db, repertoire.id);
        db.prepare("UPDATE repertoires SET total_lines = (SELECT COUNT(*) FROM lines WHERE repertoire_id = ?) WHERE id = ?")
          .run(repertoire.id, repertoire.id);
      }

      backfillAttempts(db);

      // Keep the derived per-move counters honest after importing old rows.
      db.exec(`
        UPDATE line_moves
        SET reps = (
              SELECT COUNT(*) FROM reviews
              WHERE reviews.line_move_id = line_moves.id AND reviews.correct = 1
            ),
            lapses = (
              SELECT COUNT(*) FROM reviews
              WHERE reviews.line_move_id = line_moves.id AND reviews.correct = 0
            ),
            wrong_count = (
              SELECT COUNT(*) FROM reviews
              WHERE reviews.line_move_id = line_moves.id AND reviews.correct = 0
            ),
            learned = CASE WHEN EXISTS (
              SELECT 1 FROM reviews
              WHERE reviews.line_move_id = line_moves.id AND reviews.correct = 1
            ) THEN 1 ELSE 0 END,
            last_correct = (
              SELECT correct FROM reviews
              WHERE reviews.line_move_id = line_moves.id
              ORDER BY created_at DESC, id DESC LIMIT 1
            ),
            last_review = (
              SELECT created_at FROM reviews
              WHERE reviews.line_move_id = line_moves.id
              ORDER BY created_at DESC, id DESC LIMIT 1
            )
        WHERE id IN (SELECT DISTINCT line_move_id FROM reviews WHERE line_move_id IS NOT NULL);
      `);
    },
  },
];

function hasColumn(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

function addColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Old attempts only recorded line/expected/played/correct. Map them onto the
 * new per-move review log so "moves I get wrong" starts from real history.
 */
function backfillAttempts(db) {
  const attempts = db
    .prepare("SELECT * FROM attempts ORDER BY created_at ASC, id ASC")
    .all();
  if (!attempts.length) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO reviews
       (user_id, repertoire_id, line_move_id, line_id, session_id, epd, ply, san,
        played_san, side, correct, grade, mode, daily, submission_id, response_json, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'legacy', ?, ?, NULL, ?)`
  );

  let inserted = 0;
  for (const attempt of attempts) {
    const line = db.prepare("SELECT * FROM lines WHERE id = ?").get(attempt.line_id);
    if (!line) continue;
    const repertoire = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(line.repertoire_id);
    if (!repertoire) continue;

    let derived;
    try {
      derived = deriveLineMoves(lineSans(line), repertoire.color);
    } catch {
      continue;
    }
    const wanted = sanKey(attempt.expected_san);
    const move = [...derived].reverse().find((m) => sanKey(m.san) === wanted);
    if (!move) continue;

    const lineMove = db
      .prepare(
        `SELECT * FROM line_moves
         WHERE repertoire_id = ? AND epd = ? AND san_key = ? LIMIT 1`
      )
      .get(repertoire.id, move.epd, wanted);
    if (!lineMove) continue;

    const result = insert.run(
      attempt.user_id,
      repertoire.id,
      lineMove.id,
      line.id,
      move.epd,
      move.ply,
      move.san,
      attempt.played_san || "",
      move.side,
      attempt.correct ? 1 : 0,
      attempt.correct ? 3 : 1,
      localDay(attempt.created_at, 0),
      `legacy-attempt-${attempt.id}`,
      attempt.created_at
    );
    inserted += Number(result.changes || 0);
  }
  return inserted;
}

export function schemaVersion(db) {
  return Number(db.prepare("PRAGMA user_version").get().user_version || 0);
}

export function migrate(db) {
  const before = schemaVersion(db);
  for (const migration of MIGRATIONS) {
    if (before >= migration.version) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback errors; the original error is more useful
      }
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${error.message}`);
    }
  }
  return { from: before, to: schemaVersion(db), applied: schemaVersion(db) - before };
}

export { MIGRATIONS };
