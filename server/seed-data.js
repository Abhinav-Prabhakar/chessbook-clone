/**
 * Import the captured production data into SQLite.
 *
 * Every dataset is stored with its provenance (`data_sources`) and a content
 * hash, so running the importer twice is a no-op and a regenerated capture is
 * imported once. `server/tools/build-captured-data.mjs` produces the JSON from
 * the files in `recon/`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { sanKey } from "./positions.js";
import { nowIso } from "./dates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "data");

const FILES = {
  positions: "captured-positions.json",
  courses: "captured-courses.json",
  openings: "captured-openings.json",
  content: "captured-content.json",
  models: "captured-model-games.json",
};

function load(name) {
  const text = readFileSync(join(dataDir, FILES[name]), "utf8");
  return {
    text,
    version: createHash("sha1").update(text).digest("hex").slice(0, 12),
    data: JSON.parse(text),
  };
}

function recordSource(db, dataset, version, source, itemCount) {
  db.prepare(
    `INSERT INTO data_sources (dataset, version, source, item_count, imported_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(dataset, version) DO UPDATE SET
       source = excluded.source,
       item_count = excluded.item_count,
       imported_at = excluded.imported_at`
  ).run(dataset, version, source, itemCount, nowIso());
}

function alreadyImported(db, dataset, version) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM data_sources WHERE dataset = ? AND version = ?")
      .get(dataset, version)
  );
}

/* ------------------------------------------------------------- positions --- */

function importPositions(db, payload, version, { force }) {
  if (!force && alreadyImported(db, "positions", version)) return 0;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM position_candidates").run();
    db.prepare("DELETE FROM position_reports").run();
    db.prepare("DELETE FROM position_annotations").run();
    db.prepare("DELETE FROM opening_names").run();
    db.prepare("DELETE FROM opening_aliases").run();
    db.prepare("DELETE FROM capture_profile").run();

    const stampProfile = nowIso();
    for (const [key, value] of Object.entries(payload.profile || {})) {
      if (key === "source") continue;
      db.prepare(
        `INSERT OR REPLACE INTO capture_profile (key, value, source, imported_at)
         VALUES (?, ?, ?, ?)`
      ).run(key, value == null ? null : String(value), payload.profile.source || "recon", stampProfile);
    }

    const insertReport = db.prepare(
      `INSERT INTO position_reports
         (epd, reference_repertoire_id, reference_color, side_to_move,
          stockfish_eval, stockfish_mate, master_white, master_draw, master_black,
          peer_white, peer_draw, peer_black, plans, complete, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertCandidate = db.prepare(
      `INSERT INTO position_candidates
         (report_id, epd, san, san_key, epd_after, rank, probability, incidence,
          master_white, master_draw, master_black, peer_white, peer_draw, peer_black,
          stockfish_eval, stockfish_mate, needed, danger, annotation,
          similar_position_count, similar_position_match_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let candidates = 0;
    for (const report of payload.reports || []) {
      const master = report.masterResults || {};
      const peer = report.results || {};
      const stockfish = report.stockfish || {};
      const result = insertReport.run(
        report.epd,
        report.repertoireId ?? null,
        report.referenceColor ?? null,
        report.sideToMove ?? (report.epd.split(" ")[1] === "b" ? "black" : "white"),
        numberOrNull(stockfish.eval),
        numberOrNull(stockfish.mate),
        numberOrNull(master.white),
        numberOrNull(master.draw),
        numberOrNull(master.black),
        numberOrNull(peer.white),
        numberOrNull(peer.draw),
        numberOrNull(peer.black),
        JSON.stringify(report.plans || []),
        report.complete === false ? 0 : 1,
        report.source || "recon"
      );
      const reportId = Number(result.lastInsertRowid);

      const ordered = [...(report.suggestedMoves || [])].sort(sortCandidates);
      ordered.forEach((move, index) => {
        const moveMaster = move.masterResults || {};
        const movePeer = move.results || {};
        const moveStockfish = move.stockfish || {};
        insertCandidate.run(
          reportId,
          report.epd,
          move.san,
          sanKey(move.san),
          move.epdAfter ?? null,
          index + 1,
          numberOrNull(move.probability),
          numberOrNull(move.incidence),
          numberOrNull(moveMaster.white),
          numberOrNull(moveMaster.draw),
          numberOrNull(moveMaster.black),
          numberOrNull(movePeer.white),
          numberOrNull(movePeer.draw),
          numberOrNull(movePeer.black),
          numberOrNull(moveStockfish.eval),
          numberOrNull(moveStockfish.mate),
          move.needed == null ? null : Number(Boolean(move.needed)),
          numberOrNull(move.danger),
          move.annotation ?? null,
          numberOrNull(move.similarPositionCount),
          numberOrNull(move.similarPositionMatchCount)
        );
        candidates += 1;
      });
    }

    const insertAnnotation = db.prepare(
      `INSERT OR IGNORE INTO position_annotations
         (epd, san, text, mine, repertoire_id, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const annotation of payload.annotations || []) {
      insertAnnotation.run(
        annotation.epd,
        annotation.san ?? null,
        annotation.text,
        annotation.mine ? 1 : 0,
        annotation.repertoireId ?? null,
        annotation.source || "recon"
      );
    }

    const insertName = db.prepare(
      `INSERT OR REPLACE INTO opening_names (epd, full_name, friendly_name, source, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const stamp = nowIso();
    for (const name of payload.supplementary || []) {
      insertName.run(name.epd, name.fullName, name.friendlyName ?? null, "recon/live4/network.json#5", stamp);
    }

    // Same full name at several EPDs is a real transposition/alias. Keep the
    // first EPD as the canonical name target and expose the rest as aliases.
    const byName = new Map();
    for (const name of payload.supplementary || []) {
      if (!byName.has(name.fullName)) byName.set(name.fullName, []);
      byName.get(name.fullName).push(name.epd);
    }
    const insertAlias = db.prepare(
      `INSERT OR IGNORE INTO opening_aliases
         (epd, full_name, friendly_name, target_epd, kind, source)
       VALUES (?, ?, ?, ?, 'transposition', ?)`
    );
    for (const [fullName, epds] of byName) {
      if (epds.length < 2) continue;
      const canonical = epds[0];
      for (const epd of epds.slice(1)) {
        insertAlias.run(epd, fullName, null, canonical, "recon/live4/network.json#5");
      }
    }

    // Guides also name their final positions. Supplementary data is more
    // specific for many of these, so only fill gaps.
    const filling = db.prepare(
      `INSERT OR IGNORE INTO opening_names (epd, full_name, friendly_name, source, updated_at)
       VALUES (?, ?, NULL, ?, ?)`
    );
    for (const guide of payload.guides || []) {
      if (guide.epd) filling.run(guide.epd, guide.name, guide.source || "recon");
    }

    attachRepertoireCharacteristics(db, payload.repertoireReports || {});

    recordSource(
      db,
      "positions",
      version,
      payload._provenance?.reports || "recon position reports",
      (payload.reports || []).length
    );
    db.exec("COMMIT");
    return candidates;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Real play rate first, then raw probability; never alphabetical. */
export function sortCandidates(a, b) {
  const ap = Number(a.probability ?? 0);
  const bp = Number(b.probability ?? 0);
  if (bp !== ap) return bp - ap;
  const ai = Number(a.incidence ?? 0);
  const bi = Number(b.incidence ?? 0);
  if (bi !== ai) return bi - ai;
  return String(a.san || a.sanPlus || "").localeCompare(String(b.san || b.sanPlus || ""));
}

function attachRepertoireCharacteristics(db, repertoireReports) {
  const stamp = nowIso();
  for (const [color, report] of Object.entries(repertoireReports)) {
    // Only the seeded/reference repertoire gets the reference account's
    // characteristics. An arbitrary legacy repertoire must stay "unavailable"
    // rather than borrowing numbers from a different move set.
    const repertoire = db
      .prepare(
        `SELECT * FROM repertoires
         WHERE color = ? AND (source = 'seed' OR capture_reference_id IS NOT NULL)
         ORDER BY id LIMIT 1`
      )
      .get(color);
    if (!repertoire) continue;
    db.prepare(
      `INSERT INTO repertoire_characteristics
         (repertoire_id, reference_repertoire_id, characteristics, coverage,
          biggest_miss, biggest_misses, gaps, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repertoire_id) DO UPDATE SET
         reference_repertoire_id = excluded.reference_repertoire_id,
         characteristics = excluded.characteristics,
         coverage = excluded.coverage,
         biggest_miss = excluded.biggest_miss,
         biggest_misses = excluded.biggest_misses,
         gaps = excluded.gaps,
         source = excluded.source,
         updated_at = excluded.updated_at`
    ).run(
      repertoire.id,
      report.referenceRepertoireId ?? null,
      JSON.stringify(report.characteristics || {}),
      numberOrNull(report.coverage),
      report.biggestMiss ? JSON.stringify(report.biggestMiss) : null,
      report.biggestMisses ? JSON.stringify(report.biggestMisses) : null,
      JSON.stringify(report.gaps || []),
      report.source || "recon/live4/network.json#3",
      stamp
    );
    db.prepare(
      `UPDATE repertoires SET capture_reference_id = ?, source = 'reference'
       WHERE id = ?`
    ).run(report.referenceRepertoireId ?? null, repertoire.id);
  }
}

/* --------------------------------------------------------------- content --- */

function importCourses(db, payload, version, { force }) {
  if (!force && alreadyImported(db, "courses", version)) return 0;
  const stamp = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM courses").run();
    db.prepare("DELETE FROM course_chapters").run();
    const insert = db.prepare(
      `INSERT INTO courses
         (id, slug, name, side, author_name, author_title, avatar_image,
          description, description_short, official, featured, move_count,
          coverage, elo_ranges, characteristics, video_id, source, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const course of payload.courses || []) {
      insert.run(
        course.id,
        course.slug,
        course.name,
        course.side,
        course.authorName ?? null,
        course.authorTitle ?? null,
        course.avatarImage ?? null,
        course.description ?? null,
        course.descriptionShort ?? null,
        course.official ? 1 : 0,
        course.featured ? 1 : 0,
        numberOrNull(course.moveCount),
        numberOrNull(course.coverage),
        JSON.stringify(course.eloRanges || []),
        JSON.stringify(course.characteristics || {}),
        course.videoId ?? null,
        course.source || "recon",
        stamp
      );
    }
    recordSource(db, "courses", version, payload._provenance || "recon position reports", (payload.courses || []).length);
    db.exec("COMMIT");
    return (payload.courses || []).length;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function importOpenings(db, payload, version, { force }) {
  if (!force && alreadyImported(db, "openings", version)) return 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM opening_guides").run();
    const insert = db.prepare(
      `INSERT INTO opening_guides
         (slug, eco, name, side, family, sans, pgn, epd, sort_order, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    (payload.guides || []).forEach((guide, index) => {
      insert.run(
        guide.slug,
        guide.eco,
        guide.name,
        guide.side,
        String(guide.name).split(":")[0],
        (guide.sans || []).join(" "),
        guide.pgn,
        guide.epd ?? null,
        index,
        guide.source || "recon/live6/02-openings.json"
      );
    });
    recordSource(
      db,
      "openings",
      version,
      payload._provenance || "recon/live6/02-openings.json",
      (payload.guides || []).length
    );
    db.exec("COMMIT");
    return (payload.guides || []).length;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function importContent(db, payload, version, { force }) {
  if (!force && alreadyImported(db, "content", version)) return 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM coaches").run();
    db.prepare("DELETE FROM blog_posts").run();
    const insertCoach = db.prepare(
      `INSERT INTO coaches
         (slug, name, rating, headline, bio, languages, price, platforms,
          first_lesson_free, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const coach of payload.coaches || []) {
      insertCoach.run(
        coach.slug,
        coach.name,
        coach.rating ?? null,
        coach.headline ?? null,
        coach.bio ?? null,
        JSON.stringify(coach.languages || []),
        coach.price ?? null,
        JSON.stringify(coach.platforms || []),
        coach.firstLessonFree ? 1 : 0,
        coach.source || "recon"
      );
    }
    const insertPost = db.prepare(
      `INSERT INTO blog_posts (slug, title, published_at, excerpt, sort_order, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const post of payload.blog || []) {
      insertPost.run(
        post.slug,
        post.title,
        post.publishedAt,
        post.excerpt,
        post.sortOrder ?? 0,
        post.source || "recon"
      );
    }
    recordSource(
      db,
      "content",
      version,
      payload._provenance?.coaches || "recon/live6/04-coaches.json",
      (payload.coaches || []).length + (payload.blog || []).length
    );
    db.exec("COMMIT");
    return (payload.coaches || []).length + (payload.blog || []).length;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/* ----------------------------------------------------------- model games --- */

function pgnForGame(game) {
  const header = [
    `[Event "${game.eventName || "Model game"}"]`,
    `[White "${game.players?.white?.name || "White"}"]`,
    `[Black "${game.players?.black?.name || "Black"}"]`,
    `[Result "${resultTag(game.result)}"]`,
    game.playedAt ? `[Date "${String(game.playedAt).slice(0, 10)}"]` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const moves = [];
  (game.sans || []).forEach((san, index) => {
    if (index % 2 === 0) moves.push(`${index / 2 + 1}.`);
    moves.push(san);
  });
  return `${header}\n\n${moves.join(" ")} ${resultTag(game.result)}`;
}

function resultTag(result) {
  if (result === "white") return "1-0";
  if (result === "black") return "0-1";
  if (result === "draw") return "1/2-1/2";
  return "*";
}

function importModelGames(db, payload, version, { force }) {
  if (!force && alreadyImported(db, "models", version)) return 0;
  const stamp = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    // Remove the old hand-written Dortmund game only. Real captured games are
    // upserted by external id below and keep their progress rows.
    db.prepare(
      "DELETE FROM model_games WHERE white = 'Kamsky' AND black = 'Anand' AND event = 'Dortmund'"
    ).run();

    const findData = db.prepare("SELECT * FROM model_game_data WHERE external_id = ?");
    const insertGame = db.prepare(
      `INSERT INTO model_games (white, black, event, year, result, pgn, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const updateGame = db.prepare(
      `UPDATE model_games SET white = ?, black = ?, event = ?, year = ?, result = ?, pgn = ?, description = ?
       WHERE id = ?`
    );
    const insertData = db.prepare(
      `INSERT INTO model_game_data
         (game_id, external_id, source, link, event_name, played_at, captured_at, year,
          player_white, player_black, white_elo, black_elo, white_title, black_title,
          result, reviewed, performances, epds, evals, annotations, is_daily,
          daily_date, source_file, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertMove = db.prepare(
      `INSERT OR REPLACE INTO model_game_moves
         (game_id, ply, san, epd_before, epd_after, eval_before, eval_after)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    let games = 0;
    for (const game of payload.games || []) {
      const white = game.players?.white || {};
      const black = game.players?.black || {};
      const event = game.eventName || "Model game";
      const year = game.year ?? (game.playedAt ? String(game.playedAt).slice(0, 4) : "");
      const description = `${white.name || "White"} vs ${black.name || "Black"}, ${event}. ${resultLabel(game.result)} in ${(game.sans || []).length} moves.`;
      const pgn = pgnForGame(game);
      let gameId;
      const existing = findData.get(game.id);
      if (existing) {
        gameId = existing.game_id;
        updateGame.run(
          white.name || "White",
          black.name || "Black",
          event,
          year,
          resultTag(game.result),
          pgn,
          description,
          gameId
        );
        db.prepare("DELETE FROM model_game_data WHERE game_id = ?").run(gameId);
      } else {
        gameId = Number(
          insertGame.run(
            white.name || "White",
            black.name || "Black",
            event,
            year,
            resultTag(game.result),
            pgn,
            description
          ).lastInsertRowid
        );
      }
      insertData.run(
        gameId,
        game.id,
        game.source || null,
        game.link ?? null,
        event,
        game.playedAt ?? null,
        game.createdAt ?? null,
        year || null,
        white.name ?? null,
        black.name ?? null,
        numberOrNull(white.elo),
        numberOrNull(black.elo),
        white.title ?? null,
        black.title ?? null,
        game.result ?? null,
        game.reviewed ? 1 : 0,
        JSON.stringify(game.performances || {}),
        JSON.stringify(game.epds || []),
        JSON.stringify(game.evals || []),
        JSON.stringify(game.annotations || {}),
        game.daily ? 1 : 0,
        game.daily ? String(game.createdAt || "").slice(0, 10) || null : null,
        game.source || "recon",
        stamp
      );

      db.prepare("DELETE FROM model_game_moves WHERE game_id = ?").run(gameId);
      const sans = game.sans || [];
      const epds = game.epds || [];
      const evals = (game.evals || []).map((value) => numberOrNull(value));
      sans.forEach((san, index) => {
        insertMove.run(
          gameId,
          index + 1,
          san,
          epds[index] ?? null,
          epds[index + 1] ?? null,
          evals[index] ?? null,
          evals[index + 1] ?? null
        );
      });

      // Captured review state only. Never invent a review for an unreviewed
      // game, and never overwrite the local user's progress.
      if (game.reviewed) {
        const user = db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get();
        if (user) {
          db.prepare(
            `INSERT INTO model_progress
               (user_id, game_id, ply, completed, reviewed, score, completed_at, reviewed_at, updated_at)
             VALUES (?, ?, ?, 1, 1, NULL, ?, ?, ?)
             ON CONFLICT(user_id, game_id) DO UPDATE SET
               reviewed = 1,
               reviewed_at = COALESCE(model_progress.reviewed_at, excluded.reviewed_at)`
          ).run(user.id, gameId, sans.length, stamp, stamp, stamp);
        }
      }
      games += 1;
    }
    recordSource(
      db,
      "models",
      version,
      payload._provenance || "recon model-game captures",
      games
    );
    db.exec("COMMIT");
    return games;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function resultLabel(result) {
  if (result === "white") return "White won";
  if (result === "black") return "Black won";
  if (result === "draw") return "Draw";
  return "Unfinished";
}

/** Import every captured dataset. Safe to call on every boot. */
export function importCapturedData(db, { force = false } = {}) {
  const positions = load("positions");
  const courses = load("courses");
  const openings = load("openings");
  const content = load("content");
  const models = load("models");

  // Guides also name positions; pass them into the positions importer before
  // the position dataset is recorded as complete.
  positions.data.guides = openings.data.guides;
  const candidates = importPositions(db, positions.data, positions.version, { force });
  importCourses(db, courses.data, courses.version, { force });
  importOpenings(db, openings.data, openings.version, { force });
  importContent(db, content.data, content.version, { force });
  const games = importModelGames(db, models.data, models.version, { force });

  return {
    candidates,
    courses: (courses.data.courses || []).length,
    guides: (openings.data.guides || []).length,
    coaches: (content.data.coaches || []).length,
    blog: (content.data.blog || []).length,
    modelGames: games,
  };
}

export { FILES };
