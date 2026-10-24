/**
 * Schema migrations.
 *
 * `PRAGMA user_version` is the migration cursor. Every migration is applied
 * once, in order, inside a transaction. Existing installs (including an old
 * `server/data/chessbook.db`) are upgraded in place and their lines are
 * backfilled into the per-position `line_moves` table.
 */

import { Chess } from "chess.js";
import { deriveLineMoves, epdOf, lineSans, sanKey } from "./positions.js";
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
  {
    version: 2,
    name: "captured opening data, courses, content and model games",
    up(db) {
      // --- provenance + richer repertoire/bookkeeping columns ---
      addColumn(db, "repertoires", "capture_reference_id", "TEXT");
      addColumn(db, "repertoires", "source", "TEXT NOT NULL DEFAULT 'manual'");
      addColumn(db, "repertoires", "slug", "TEXT");

      addColumn(db, "lines", "origin", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumn(db, "lines", "autofill_style", "TEXT");
      addColumn(db, "lines", "chapter_id", "INTEGER");
      addColumn(db, "lines", "epd", "TEXT");
      addColumn(db, "lines", "source_ref", "TEXT");

      addColumn(db, "openings", "epd", "TEXT");
      addColumn(db, "openings", "epd_after", "TEXT");
      addColumn(db, "openings", "source", "TEXT NOT NULL DEFAULT 'lichess-eco'");
      addColumn(db, "openings", "version", "TEXT");
      addColumn(db, "settings", "model_source", "TEXT NOT NULL DEFAULT 'historical'");

      db.exec(`
        CREATE TABLE IF NOT EXISTS data_sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          dataset TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '1',
          source TEXT NOT NULL,
          item_count INTEGER NOT NULL DEFAULT 0,
          imported_at TEXT NOT NULL,
          UNIQUE (dataset, version)
        );

        CREATE TABLE IF NOT EXISTS capture_profile (
          key TEXT PRIMARY KEY,
          value TEXT,
          source TEXT NOT NULL,
          imported_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS opening_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          version TEXT NOT NULL,
          rows INTEGER NOT NULL DEFAULT 0,
          imported_at TEXT NOT NULL,
          UNIQUE (source, version)
        );

        CREATE TABLE IF NOT EXISTS opening_names (
          epd TEXT PRIMARY KEY,
          full_name TEXT NOT NULL,
          friendly_name TEXT,
          source TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_opening_names_name
          ON opening_names(full_name);

        CREATE TABLE IF NOT EXISTS opening_aliases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          epd TEXT NOT NULL,
          full_name TEXT NOT NULL,
          friendly_name TEXT,
          target_epd TEXT,
          kind TEXT NOT NULL DEFAULT 'name',
          source TEXT NOT NULL,
          UNIQUE (epd, full_name, kind)
        );
        CREATE INDEX IF NOT EXISTS idx_opening_aliases_epd
          ON opening_aliases(epd);

        CREATE TABLE IF NOT EXISTS position_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          epd TEXT NOT NULL,
          reference_repertoire_id TEXT,
          reference_color TEXT,
          side_to_move TEXT NOT NULL,
          stockfish_eval INTEGER,
          stockfish_mate INTEGER,
          master_white INTEGER,
          master_draw INTEGER,
          master_black INTEGER,
          peer_white INTEGER,
          peer_draw INTEGER,
          peer_black INTEGER,
          plans TEXT NOT NULL DEFAULT '[]',
          complete INTEGER NOT NULL DEFAULT 1,
          source TEXT NOT NULL,
          UNIQUE (epd, reference_repertoire_id)
        );
        CREATE INDEX IF NOT EXISTS idx_position_reports_epd
          ON position_reports(epd);

        CREATE TABLE IF NOT EXISTS position_candidates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          report_id INTEGER NOT NULL REFERENCES position_reports(id) ON DELETE CASCADE,
          epd TEXT NOT NULL,
          san TEXT NOT NULL,
          san_key TEXT NOT NULL,
          epd_after TEXT,
          rank INTEGER NOT NULL,
          probability REAL,
          incidence REAL,
          master_white INTEGER,
          master_draw INTEGER,
          master_black INTEGER,
          peer_white INTEGER,
          peer_draw INTEGER,
          peer_black INTEGER,
          stockfish_eval INTEGER,
          stockfish_mate INTEGER,
          needed INTEGER,
          danger REAL,
          annotation TEXT,
          similar_position_count INTEGER,
          similar_position_match_count INTEGER,
          UNIQUE (report_id, san_key)
        );
        CREATE INDEX IF NOT EXISTS idx_position_candidates_epd
          ON position_candidates(epd, rank);

        CREATE TABLE IF NOT EXISTS position_annotations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          epd TEXT NOT NULL,
          san TEXT,
          text TEXT NOT NULL,
          mine INTEGER NOT NULL DEFAULT 0,
          repertoire_id TEXT,
          source TEXT NOT NULL,
          UNIQUE (epd, san, text)
        );
        CREATE INDEX IF NOT EXISTS idx_position_annotations_epd
          ON position_annotations(epd);

        CREATE TABLE IF NOT EXISTS repertoire_characteristics (
          repertoire_id INTEGER PRIMARY KEY REFERENCES repertoires(id) ON DELETE CASCADE,
          reference_repertoire_id TEXT,
          characteristics TEXT NOT NULL DEFAULT '{}',
          coverage REAL,
          biggest_miss TEXT,
          biggest_misses TEXT,
          gaps TEXT,
          source TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS repertoire_exclusions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
          epd TEXT NOT NULL,
          san TEXT NOT NULL,
          san_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (repertoire_id, epd, san_key)
        );

        CREATE TABLE IF NOT EXISTS repertoire_chapters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chapters_rep
          ON repertoire_chapters(repertoire_id, sort_order);

        CREATE TABLE IF NOT EXISTS courses (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          side TEXT NOT NULL CHECK (side IN ('white', 'black')),
          author_name TEXT,
          author_title TEXT,
          avatar_image TEXT,
          description TEXT,
          description_short TEXT,
          official INTEGER NOT NULL DEFAULT 0,
          featured INTEGER NOT NULL DEFAULT 0,
          move_count INTEGER,
          coverage REAL,
          elo_ranges TEXT NOT NULL DEFAULT '[]',
          characteristics TEXT NOT NULL DEFAULT '{}',
          video_id TEXT,
          source TEXT NOT NULL,
          imported_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_courses_side ON courses(side, name);

        CREATE TABLE IF NOT EXISTS course_chapters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_course_chapters
          ON course_chapters(course_id, sort_order);

        CREATE TABLE IF NOT EXISTS opening_guides (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          eco TEXT NOT NULL,
          name TEXT NOT NULL,
          side TEXT NOT NULL CHECK (side IN ('white', 'black')),
          family TEXT NOT NULL,
          sans TEXT NOT NULL,
          pgn TEXT NOT NULL,
          epd TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_guides_side ON opening_guides(side, sort_order);

        CREATE TABLE IF NOT EXISTS coaches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          rating TEXT,
          headline TEXT,
          bio TEXT,
          languages TEXT NOT NULL DEFAULT '[]',
          price TEXT,
          platforms TEXT NOT NULL DEFAULT '[]',
          first_lesson_free INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS blog_posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          published_at TEXT NOT NULL,
          excerpt TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS model_game_data (
          game_id INTEGER PRIMARY KEY REFERENCES model_games(id) ON DELETE CASCADE,
          external_id TEXT UNIQUE,
          source TEXT,
          link TEXT,
          event_name TEXT,
          played_at TEXT,
          captured_at TEXT,
          year TEXT,
          player_white TEXT,
          player_black TEXT,
          white_elo INTEGER,
          black_elo INTEGER,
          white_title TEXT,
          black_title TEXT,
          result TEXT,
          reviewed INTEGER NOT NULL DEFAULT 0,
          performances TEXT NOT NULL DEFAULT '{}',
          epds TEXT NOT NULL DEFAULT '[]',
          evals TEXT NOT NULL DEFAULT '[]',
          annotations TEXT NOT NULL DEFAULT '{}',
          is_daily INTEGER NOT NULL DEFAULT 0,
          daily_date TEXT,
          source_file TEXT,
          imported_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS model_game_moves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id INTEGER NOT NULL REFERENCES model_games(id) ON DELETE CASCADE,
          ply INTEGER NOT NULL,
          san TEXT NOT NULL,
          epd_before TEXT,
          epd_after TEXT,
          eval_before INTEGER,
          eval_after INTEGER,
          UNIQUE (game_id, ply)
        );
        CREATE INDEX IF NOT EXISTS idx_model_game_moves
          ON model_game_moves(game_id, ply);

        CREATE TABLE IF NOT EXISTS model_game_annotations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id INTEGER NOT NULL REFERENCES model_games(id) ON DELETE CASCADE,
          ply INTEGER,
          san TEXT,
          text TEXT NOT NULL,
          source TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS model_daily_selection (
          date TEXT PRIMARY KEY,
          game_id INTEGER NOT NULL REFERENCES model_games(id) ON DELETE CASCADE,
          force_new INTEGER NOT NULL DEFAULT 0,
          selected_at TEXT NOT NULL
        );
      `);

      // --- backfill derived columns on existing installs ---
      const lines = db.prepare("SELECT * FROM lines").all();
      const updateLine = db.prepare("UPDATE lines SET epd = ?, origin = COALESCE(origin, 'legacy') WHERE id = ?");
      for (const line of lines) {
        try {
          const sans = lineSans(line);
          const chess = new Chess();
          for (const san of sans) chess.move(san);
          updateLine.run(epdOf(chess.fen()), line.id);
        } catch {
          // invalid lines are reported by /api/integrity
        }
      }

      const openings = db.prepare("SELECT id, fen, sans FROM openings").all();
      const updateOpening = db.prepare(
        "UPDATE openings SET epd = ?, epd_after = ?, source = COALESCE(source, 'lichess-eco'), version = COALESCE(version, 'legacy') WHERE id = ?"
      );
      for (const opening of openings) {
        let epdAfter = null;
        try {
          const chess = new Chess();
          for (const san of String(opening.sans || "").split(" ").filter(Boolean)) {
            chess.move(san);
          }
          epdAfter = epdOf(chess.fen());
        } catch {
          // integrity reports malformed rows
        }
        updateOpening.run(epdOf(opening.fen), epdAfter, opening.id);
      }

      db.exec("CREATE INDEX IF NOT EXISTS idx_openings_epd ON openings(epd);");
      db.exec("CREATE INDEX IF NOT EXISTS idx_openings_epd_after ON openings(epd_after);");
      db.exec("CREATE INDEX IF NOT EXISTS idx_lines_epd ON lines(repertoire_id, epd);");
    },
  },
  {
    version: 3,
    name: "profile rating, review preferences and reversible branch state",
    up(db) {
      // --- D135/D196/D197: the profile fields the trainer and the candidate
      //     filters need. `settings` is canonical; `users` mirrors the rating
      //     fields for `/me` clients that only read the profile row.
      addColumn(db, "users", "rating_system", "TEXT NOT NULL DEFAULT 'Chess.com'");
      addColumn(db, "users", "single_elo", "INTEGER NOT NULL DEFAULT 1800");
      addColumn(db, "users", "elo_range", "TEXT NOT NULL DEFAULT '1800-2000'");
      addColumn(db, "users", "coverage_goal", "INTEGER NOT NULL DEFAULT 50");

      addColumn(db, "settings", "rating_system", "TEXT NOT NULL DEFAULT 'Chess.com'");
      addColumn(db, "settings", "time_control", "TEXT NOT NULL DEFAULT 'Blitz'");
      addColumn(db, "settings", "single_elo", "INTEGER NOT NULL DEFAULT 1800");
      addColumn(db, "settings", "elo_range", "TEXT NOT NULL DEFAULT '1800-2000'");
      addColumn(db, "settings", "coverage_goal", "INTEGER NOT NULL DEFAULT 50");
      addColumn(db, "settings", "practice_mode", "TEXT NOT NULL DEFAULT 'individual'");
      addColumn(db, "settings", "review_style", "TEXT NOT NULL DEFAULT 'cards'");
      addColumn(db, "settings", "pause_after_move", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "settings", "pause_on_fail", "INTEGER NOT NULL DEFAULT 1");
      addColumn(db, "settings", "pause_on_low_score", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "settings", "pause_when_note", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "settings", "animation", "TEXT NOT NULL DEFAULT 'normal'");
      addColumn(db, "settings", "haptics", "INTEGER NOT NULL DEFAULT 1");
      addColumn(db, "settings", "piece_set", "TEXT NOT NULL DEFAULT 'chessbook_monochrome'");
      addColumn(db, "settings", "sound_volume", "INTEGER NOT NULL DEFAULT 70");
      addColumn(db, "settings", "sound_effects", "TEXT NOT NULL DEFAULT '{}'");
      addColumn(db, "settings", "recommended_moves_size", "TEXT NOT NULL DEFAULT 'comfortable'");
      addColumn(db, "settings", "notifications", "TEXT NOT NULL DEFAULT '{}'");

      // Seed the new columns from the values the capture recorded for this
      // profile where they are still at the generic default (1800).
      db.prepare(
        `UPDATE settings SET
           rating_system = COALESCE((SELECT value FROM capture_profile WHERE key = 'ratingSystem'), rating_system),
           single_elo = COALESCE((SELECT CAST(value AS INTEGER) FROM capture_profile WHERE key = 'singleElo'), single_elo),
           elo_range = COALESCE((SELECT value FROM capture_profile WHERE key = 'eloRange'), elo_range)
         WHERE user_id = (SELECT id FROM users ORDER BY id LIMIT 1)`
      ).run();
      db.prepare(
        `UPDATE users SET
           rating_system = (SELECT rating_system FROM settings WHERE settings.user_id = users.id),
           single_elo = (SELECT single_elo FROM settings WHERE settings.user_id = users.id),
           elo_range = (SELECT elo_range FROM settings WHERE settings.user_id = users.id),
           coverage_goal = (SELECT coverage_goal FROM settings WHERE settings.user_id = users.id)`
      ).run();

      // --- session review style (D012/D090/D156) ---
      addColumn(db, "practice_sessions", "style", "TEXT NOT NULL DEFAULT 'cards'");
      addColumn(db, "practice_sessions", "practice_mode", "TEXT NOT NULL DEFAULT 'individual'");
      addColumn(db, "practice_sessions", "replays", "INTEGER NOT NULL DEFAULT 0");

      // --- reversible branch disable (D052) ---
      addColumn(db, "lines", "disabled", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "line_moves", "disabled", "INTEGER NOT NULL DEFAULT 0");
      db.exec(`
        CREATE TABLE IF NOT EXISTS branch_states (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
          epd TEXT NOT NULL,
          san TEXT NOT NULL,
          san_key TEXT NOT NULL,
          disabled INTEGER NOT NULL DEFAULT 1,
          snapshot TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (repertoire_id, epd, san_key)
        );
        CREATE INDEX IF NOT EXISTS idx_branch_states_rep
          ON branch_states(repertoire_id, disabled);
      `);
    },
  },
  {
    version: 4,
    name: "offline explorer corpora and engine eval cache",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS explorer_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          dataset TEXT NOT NULL,
          epd TEXT NOT NULL,
          games INTEGER NOT NULL DEFAULT 0,
          white INTEGER NOT NULL DEFAULT 0,
          draw INTEGER NOT NULL DEFAULT 0,
          black INTEGER NOT NULL DEFAULT 0,
          name TEXT,
          source TEXT NOT NULL,
          version TEXT NOT NULL,
          imported_at TEXT NOT NULL,
          UNIQUE (dataset, epd)
        );
        CREATE INDEX IF NOT EXISTS idx_explorer_reports_epd
          ON explorer_reports(epd);

        CREATE TABLE IF NOT EXISTS explorer_moves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          report_id INTEGER NOT NULL REFERENCES explorer_reports(id) ON DELETE CASCADE,
          epd TEXT NOT NULL,
          san TEXT NOT NULL,
          san_key TEXT NOT NULL,
          games INTEGER NOT NULL DEFAULT 0,
          white INTEGER NOT NULL DEFAULT 0,
          draw INTEGER NOT NULL DEFAULT 0,
          black INTEGER NOT NULL DEFAULT 0,
          rank INTEGER NOT NULL DEFAULT 0,
          UNIQUE (report_id, san_key)
        );
        CREATE INDEX IF NOT EXISTS idx_explorer_moves_epd
          ON explorer_moves(epd, san_key);

        CREATE TABLE IF NOT EXISTS explorer_band_positions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          dataset TEXT NOT NULL,
          epd TEXT NOT NULL,
          band TEXT NOT NULL,
          games INTEGER NOT NULL DEFAULT 0,
          white INTEGER NOT NULL DEFAULT 0,
          draw INTEGER NOT NULL DEFAULT 0,
          black INTEGER NOT NULL DEFAULT 0,
          UNIQUE (dataset, epd, band)
        );
        CREATE INDEX IF NOT EXISTS idx_explorer_band_positions
          ON explorer_band_positions(epd, band);

        CREATE TABLE IF NOT EXISTS explorer_band_moves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          dataset TEXT NOT NULL,
          epd TEXT NOT NULL,
          band TEXT NOT NULL,
          san TEXT NOT NULL,
          san_key TEXT NOT NULL,
          games INTEGER NOT NULL DEFAULT 0,
          white INTEGER NOT NULL DEFAULT 0,
          draw INTEGER NOT NULL DEFAULT 0,
          black INTEGER NOT NULL DEFAULT 0,
          rank INTEGER NOT NULL DEFAULT 0,
          UNIQUE (dataset, epd, band, san_key)
        );
        CREATE INDEX IF NOT EXISTS idx_explorer_band_moves_lookup
          ON explorer_band_moves(epd, band);

        CREATE TABLE IF NOT EXISTS explorer_imports (
          dataset TEXT PRIMARY KEY,
          version TEXT NOT NULL,
          source TEXT NOT NULL,
          games INTEGER NOT NULL DEFAULT 0,
          positions INTEGER NOT NULL DEFAULT 0,
          moves INTEGER NOT NULL DEFAULT 0,
          bands TEXT NOT NULL DEFAULT '[]',
          file_size INTEGER NOT NULL DEFAULT 0,
          file_mtime INTEGER NOT NULL DEFAULT 0,
          generated_at TEXT,
          imported_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS engine_evals (
          fen TEXT NOT NULL,
          depth INTEGER NOT NULL,
          cp INTEGER,
          mate INTEGER,
          best_san TEXT,
          best_uci TEXT,
          pv TEXT,
          engine TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY (fen, depth)
        );

        CREATE TABLE IF NOT EXISTS model_game_reviews (
          game_id INTEGER NOT NULL REFERENCES model_games(id) ON DELETE CASCADE,
          depth INTEGER NOT NULL,
          engine TEXT,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (game_id, depth)
        );
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
