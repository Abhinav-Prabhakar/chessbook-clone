import {
  deriveLineMoves,
  epdOf,
  isEpdLike,
  lineSans,
  prefixFor,
  sanKey,
  START_FEN,
} from "./positions.js";
import { computeStreak, isDue, localDay, nowIso, parseOffset, todayLocal } from "./dates.js";
import { MASTERY_STABILITY_DAYS } from "./srs.js";

export const MODES = ["due", "all", "weak", "early", "specific", "line"];

export const modeOf = (value, fallback = "due") =>
  MODES.includes(String(value)) ? String(value) : fallback;

const bool = (n) => Number(n) === 1;

/* ------------------------------------------------------------------ moves --- */

/**
 * Re-derive `line_moves` from every stored line in a repertoire.
 *
 * Move identity is (repertoire, EPD, SAN): transpositions and duplicate
 * lines share one review state, which is what per-position SRS requires.
 * Review history/state is never overwritten here.
 */
export function rebuildRepertoireMoves(db, repertoireId) {
  const repertoire = db.prepare("SELECT * FROM repertoires WHERE id = ?").get(repertoireId);
  if (!repertoire) return { inserted: 0, updated: 0, removed: 0, total: 0 };

  const lines = db.prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id").all(repertoireId);
  const desired = new Map();

  for (const line of lines) {
    let derived;
    try {
      derived = deriveLineMoves(lineSans(line), repertoire.color);
    } catch {
      continue; // invalid lines are reported by the integrity check instead
    }
    for (const move of derived) {
      const key = `${move.epd}|${sanKey(move.san)}`;
      if (!desired.has(key)) desired.set(key, { ...move, lineId: line.id });
    }
  }

  const existing = db.prepare("SELECT * FROM line_moves WHERE repertoire_id = ?").all(repertoireId);
  const existingByKey = new Map(existing.map((row) => [`${row.epd}|${row.san_key}`, row]));
  const stamp = nowIso();
  let inserted = 0;
  let updated = 0;
  let removed = 0;

  const update = db.prepare(
    `UPDATE line_moves
     SET line_id = ?, fen = ?, ply = ?, move_number = ?, san = ?, uci = ?,
         side = ?, is_user = ?, updated_at = ?
     WHERE id = ?`
  );
  const insert = db.prepare(
    `INSERT INTO line_moves
       (repertoire_id, line_id, epd, fen, ply, move_number, san, san_key, uci, side,
        is_user, state, stability, difficulty, lapses, reps, wrong_count, last_correct,
        due_at, last_review, kept, learned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 0, 0, 0, 0, 0, NULL,
             NULL, NULL, 0, 0, ?, ?)`
  );

  for (const [key, move] of desired) {
    const row = existingByKey.get(key);
    if (row) {
      update.run(
        move.lineId,
        move.fen,
        move.ply,
        move.moveNumber,
        move.san,
        move.uci,
        move.side,
        move.isUser ? 1 : 0,
        stamp,
        row.id
      );
      updated += 1;
    } else {
      insert.run(
        repertoireId,
        move.lineId,
        move.epd,
        move.fen,
        move.ply,
        move.moveNumber,
        move.san,
        sanKey(move.san),
        move.uci,
        move.side,
        move.isUser ? 1 : 0,
        stamp,
        stamp
      );
      inserted += 1;
    }
  }

  for (const row of existing) {
    if (!desired.has(`${row.epd}|${row.san_key}`)) {
      db.prepare("DELETE FROM line_moves WHERE id = ?").run(row.id);
      removed += 1;
    }
  }

  return { inserted, updated, removed, total: desired.size };
}

function moveRowFor(db, repertoireId, derivedMove) {
  return db
    .prepare(
      `SELECT * FROM line_moves
       WHERE repertoire_id = ? AND epd = ? AND san_key = ? LIMIT 1`
    )
    .get(repertoireId, derivedMove.epd, sanKey(derivedMove.san));
}

/** Per-line aggregates derived from the per-move review state. */
export function lineAggregate(db, repertoire, line) {
  let derived = [];
  try {
    derived = deriveLineMoves(lineSans(line), repertoire.color).filter((m) => m.isUser);
  } catch {
    return { total: 0, learned: 0, mastered: 0, due: 0, dueAt: null, wrong: 0 };
  }
  const rows = derived.map((m) => moveRowFor(db, repertoire.id, m)).filter(Boolean);
  const total = rows.length;
  const learned = rows.filter((r) => r.reps > 0).length;
  const mastered = rows.filter((r) => r.stability >= MASTERY_STABILITY_DAYS && r.reps > 0).length;
  const dueRows = rows.filter((r) => isDue(r.due_at));
  const dueAt = dueRows
    .map((r) => r.due_at)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const wrong = rows.reduce((n, r) => n + Number(r.wrong_count || 0), 0);
  return { total, learned, mastered, due: dueRows.length, dueAt, wrong };
}

export function lineOut(line, aggregate = null) {
  const moves = lineSans(line);
  const dueAt = aggregate ? aggregate.dueAt : line.due_at;
  const learned = aggregate
    ? aggregate.total > 0 && aggregate.learned === aggregate.total
    : bool(line.learned);
  const mastered = aggregate
    ? aggregate.total > 0
      ? Math.round((aggregate.mastered / aggregate.total) * 100)
      : 0
    : Number(line.mastered || 0);

  return {
    id: line.id,
    openingId: line.opening_id,
    name: line.name,
    moves,
    pgn: line.pgn,
    fen: line.fen,
    side: line.side,
    expectedSan: line.expected_san,
    learned,
    mastered,
    saved: bool(line.saved),
    dueAt: dueAt ?? null,
    due: isDue(dueAt),
    wrong: aggregate ? aggregate.wrong : Number(line.wrong || 0),
    // Move-level additions (new clients). Legacy fields above are unchanged.
    ply: line.__ply ?? null,
    moveNumber: line.__ply ? Math.floor((line.__ply - 1) / 2) + 1 : null,
    epd: line.__epd ?? null,
    lineMoveId: line.__lineMoveId ?? null,
    fullMoves: moves,
    moveCount: aggregate ? aggregate.total : moves.filter(Boolean).length,
    movesLearned: aggregate ? aggregate.learned : 0,
    movesDue: aggregate ? aggregate.due : 0,
    epdAfter: line.epd ?? null,
    origin: line.origin ?? null,
    autofillStyle: line.autofill_style ?? null,
    chapterId: line.chapter_id ?? null,
  };
}

/** A legacy `Line` view for one task: board at `fen`, expecting `san`. */
export function taskLineView(line, task, aggregate = null) {
  const full = lineSans(line);
  return lineOut(
    {
      ...line,
      moves: full.slice(0, task.ply).join(" "),
      fen: task.fen,
      expected_san: task.expectedSan,
      __ply: task.ply,
      __epd: task.epd,
      __lineMoveId: task.lineMoveId,
    },
    aggregate
  );
}

/* ------------------------------------------------------------------ stats --- */

export function statsFor(db, repertoire) {
  const stamp = nowIso();
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN reps > 0 THEN 1 ELSE 0 END), 0) AS learned,
         COALESCE(SUM(CASE WHEN reps > 0 AND stability >= ? THEN 1 ELSE 0 END), 0) AS mastered,
         COALESCE(SUM(CASE WHEN reps = 0 THEN 1 ELSE 0 END), 0) AS fresh,
         COALESCE(SUM(CASE WHEN due_at IS NOT NULL AND julianday(due_at) <= julianday(?) THEN 1 ELSE 0 END), 0) AS due
       FROM line_moves WHERE repertoire_id = ? AND is_user = 1`
    )
    .get(MASTERY_STABILITY_DAYS, stamp, repertoire.id);

  const positions = db
    .prepare(
      `SELECT COUNT(DISTINCT epd) AS total,
              COUNT(DISTINCT CASE WHEN due_at IS NOT NULL AND julianday(due_at) <= julianday(?) THEN epd END) AS due,
              COUNT(DISTINCT CASE WHEN reps > 0 THEN epd END) AS learned,
              COUNT(DISTINCT CASE WHEN reps > 0 AND stability >= ? THEN epd END) AS mastered
       FROM line_moves WHERE repertoire_id = ? AND is_user = 1`
    )
    .get(stamp, MASTERY_STABILITY_DAYS, repertoire.id);

  const lineRow = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(saved), 0) AS saved
       FROM lines WHERE repertoire_id = ?`
    )
    .get(repertoire.id);

  const total = Number(totals.total || 0);
  const learned = Number(totals.learned || 0);
  const mastered = Number(totals.mastered || 0);
  const positionTotal = Number(positions.total || 0);
  const positionsLearned = Number(positions.learned || 0);
  const positionsMastered = Number(positions.mastered || 0);

  const captured = db
    .prepare("SELECT * FROM repertoire_characteristics WHERE repertoire_id = ?")
    .get(repertoire.id);
  let characteristicsRaw = null;
  if (captured) {
    try {
      characteristicsRaw = JSON.parse(captured.characteristics || "{}");
    } catch {
      characteristicsRaw = null;
    }
  }
  const characteristic = (key) =>
    characteristicsRaw && characteristicsRaw[key] != null
      ? Number(characteristicsRaw[key])
      : null;
  const characteristicsAvailable = Boolean(
    characteristicsRaw &&
      ["effectiveness", "soundness", "learnability", "avgCpLoss", "expectedResults", "sharpness"]
        .some((key) => characteristicsRaw[key] != null)
  );

  return {
    id: repertoire.id,
    color: repertoire.color,
    name: repertoire.name,
    description: repertoire.description,
    slug: repertoire.slug ?? null,
    captureReferenceId: repertoire.capture_reference_id ?? null,
    totalLines: Number(lineRow.n || 0),
    createdAt: repertoire.created_at,
    lineCount: Number(lineRow.n || 0),
    moveCount: total,
    positionCount: positionTotal,
    learned,
    mastered,
    learnedPositions: positionsLearned,
    masteredPositions: positionsMastered,
    saved: Number(lineRow.saved || 0),
    due: Number(totals.due || 0),
    duePositions: Number(positions.due || 0),
    fresh: Number(totals.fresh || 0),
    // Completion/mastery are position-level so that finishing an "all moves"
    // session reaches 100%; the move-level percentages stay available too.
    completion: positionTotal
      ? Math.round((positionsLearned / positionTotal) * 100)
      : 0,
    mastery: positionTotal
      ? Math.round((positionsMastered / positionTotal) * 100)
      : 0,
    moveCompletion: total ? Math.round((learned / total) * 100) : 0,
    moveMastery: total ? Math.round((mastered / total) * 100) : 0,
    // Real captured `characteristics` for the reference repertoire. They are
    // explicitly unavailable for a repertoire with no capture; they are never
    // derived from learned/mastered.
    characteristics: {
      available: characteristicsAvailable,
      effectiveness: characteristic("effectiveness"),
      soundness: characteristic("soundness"),
      learnability: characteristic("learnability"),
      avgCpLoss: characteristic("avgCpLoss"),
      expectedResults: characteristic("expectedResults"),
      sharpness: characteristic("sharpness"),
      eval: characteristic("eval"),
      pathConcessionCp: characteristic("pathConcessionCp"),
      source: characteristicsAvailable ? captured.source : null,
      referenceRepertoireId: characteristicsAvailable
        ? captured.reference_repertoire_id
        : null,
    },
    coverage: captured?.coverage == null ? null : Number(captured.coverage),
    coveragePercent:
      captured?.coverage == null
        ? null
        : Math.round(Number(captured.coverage) * 1000) / 10,
    coverageSource: captured?.coverage == null ? null : captured.source,
    chapterCount: Number(
      db
        .prepare("SELECT COUNT(*) AS n FROM repertoire_chapters WHERE repertoire_id = ?")
        .get(repertoire.id)?.n || 0
    ),
  };
}

/* ------------------------------------------------------------------ tasks --- */

function positionNote(db, repertoireId, epd, san = "") {
  const row = db
    .prepare(
      `SELECT * FROM notes
       WHERE repertoire_id = ? AND epd = ? AND san = ? LIMIT 1`
    )
    .get(repertoireId, epd, san);
  return row
    ? {
        id: row.id,
        epd: row.epd,
        san: row.san || null,
        note: row.note,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;
}

export function notesForPosition(db, repertoireId, epd) {
  return db
    .prepare(
      `SELECT * FROM notes WHERE repertoire_id = ? AND epd = ? ORDER BY id`
    )
    .all(repertoireId, epd)
    .map((row) => ({
      id: row.id,
      epd: row.epd,
      san: row.san || null,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

/**
 * Build the complete task for one position: the exact board, the expected
 * move and every saved alternative, the moves that are auto-played to get
 * there, and the notes attached to the position/move.
 */
export function buildTask(db, repertoire, epd) {
  const rows = db
    .prepare(
      `SELECT lm.*, l.name AS line_name, l.moves AS line_moves
       FROM line_moves lm
       JOIN lines l ON l.id = lm.line_id
       WHERE lm.repertoire_id = ? AND lm.epd = ? AND lm.is_user = 1
       ORDER BY lm.id`
    )
    .all(repertoire.id, epd);

  if (!rows.length) return null;

  const now = nowIso();
  const ordered = [...rows].sort((a, b) => {
    const ad = isDue(a.due_at, now) ? 0 : 1;
    const bd = isDue(b.due_at, now) ? 0 : 1;
    if (ad !== bd) return ad - bd;
    if (a.reps !== b.reps) return a.reps - b.reps;
    const at = a.due_at ? Date.parse(a.due_at) : Infinity;
    const bt = b.due_at ? Date.parse(b.due_at) : Infinity;
    return at - bt || a.id - b.id;
  });
  const primary = ordered[0];
  const lineMoves = String(primary.line_moves || "").split(" ").filter(Boolean);
  const prefix = prefixFor(lineMoves, primary.ply);
  const autoReply = prefix.moves.length ? prefix.moves[prefix.moves.length - 1] : null;
  const note = positionNote(db, repertoire.id, epd, "");
  const moveNote = positionNote(db, repertoire.id, epd, primary.san);

  const seenSan = new Set();
  const alternatives = [];
  for (const row of rows) {
    const key = row.san_key;
    if (seenSan.has(key)) continue;
    seenSan.add(key);
    alternatives.push({
      san: row.san,
      sanKey: key,
      lineMoveId: row.id,
      lineId: row.line_id,
      lineName: row.line_name,
      epd: row.epd,
      ply: row.ply,
      dueAt: row.due_at,
      due: isDue(row.due_at, now),
      stability: row.stability,
      difficulty: row.difficulty,
      lapses: row.lapses,
      reps: row.reps,
      state: row.state,
      learned: bool(row.learned),
      kept: bool(row.kept),
      note: positionNote(db, repertoire.id, epd, row.san),
    });
  }

  return {
    epd,
    fen: primary.fen,
    ply: primary.ply,
    moveNumber: primary.move_number,
    side: primary.side,
    expectedSan: primary.san,
    acceptableSans: alternatives.map((a) => a.san),
    alternatives,
    lineId: primary.line_id,
    lineName: primary.line_name,
    lineMoveId: primary.id,
    fullMoves: lineMoves,
    prefix: prefix.moves,
    autoReply,
    note,
    noteText: note?.note ?? null,
    moveNote,
    dueAt: primary.due_at,
    due: isDue(primary.due_at, now),
    kept: bool(primary.kept),
    review: {
      stability: primary.stability,
      difficulty: primary.difficulty,
      lapses: primary.lapses,
      reps: primary.reps,
      state: primary.state,
      lastReview: primary.last_review,
      wrongCount: primary.wrong_count,
    },
  };
}

/** All saved user moves at a raw FEN/EPD, for the builder/gap panels. */
export function positionDetail(db, repertoire, epdOrFen) {
  const epd = String(epdOrFen || "").trim().split(" ").length >= 4
    ? epdOrFen.trim().split(" ").slice(0, 4).join(" ")
    : epdOrFen;
  if (!isEpdLike(epd)) return null;
  const rows = db
    .prepare(
      `SELECT lm.*, l.name AS line_name
       FROM line_moves lm JOIN lines l ON l.id = lm.line_id
       WHERE lm.repertoire_id = ? AND lm.epd = ? AND lm.is_user = 1
       ORDER BY lm.san`
    )
    .all(repertoire.id, epd);
  if (!rows.length) {
    return {
      epd,
      fen: `${epd} 0 1`,
      side: epd.split(" ")[1] === "w" ? "white" : "black",
      moves: [],
      notes: notesForPosition(db, repertoire.id, epd),
    };
  }
  return {
    epd,
    fen: rows[0].fen,
    side: rows[0].side,
    moves: rows.map((row) => ({
      san: row.san,
      lineMoveId: row.id,
      lineId: row.line_id,
      lineName: row.line_name,
      ply: row.ply,
      dueAt: row.due_at,
      due: isDue(row.due_at),
      stability: row.stability,
      difficulty: row.difficulty,
      lapses: row.lapses,
      reps: row.reps,
      state: row.state,
      learned: bool(row.learned),
      kept: bool(row.kept),
      note: positionNote(db, repertoire.id, epd, row.san),
    })),
    notes: notesForPosition(db, repertoire.id, epd),
  };
}

/* ------------------------------------------------------------------ queue --- */

export function weakEpdQuery() {
  return `SELECT lm.epd AS epd, MIN(lm.line_id) AS line_id, MIN(lm.ply) AS ply
          FROM line_moves lm
          WHERE lm.repertoire_id = ? AND lm.is_user = 1
            AND EXISTS (
              SELECT 1 FROM reviews r
              WHERE r.line_move_id = lm.id AND r.correct = 0
            )
            AND COALESCE((
              SELECT r2.correct FROM reviews r2
              WHERE r2.line_move_id = lm.id
              ORDER BY r2.created_at DESC, r2.id DESC LIMIT 1
            ), 1) = 0
          GROUP BY lm.epd
          ORDER BY MAX(lm.difficulty) DESC, MAX(lm.lapses) DESC, MIN(lm.id) ASC`;
}

/**
 * One entry per *position* where the user is to move. Alternative saved
 * moves at the same position are alternatives of one task, not two tasks.
 */
export function buildQueue(db, repertoire, mode, options = {}) {
  const stamp = nowIso();
  let rows = [];

  if (mode === "due") {
    rows = db
      .prepare(
        `SELECT epd, MIN(due_at) AS due_at
         FROM line_moves
         WHERE repertoire_id = ? AND is_user = 1
           AND due_at IS NOT NULL AND julianday(due_at) <= julianday(?)
         GROUP BY epd
         ORDER BY due_at ASC, MIN(id) ASC`
      )
      .all(repertoire.id, stamp);
  } else if (mode === "early") {
    rows = db
      .prepare(
        `SELECT epd, MIN(due_at) AS due_at
         FROM line_moves
         WHERE repertoire_id = ? AND is_user = 1 AND due_at IS NOT NULL
         GROUP BY epd
         ORDER BY due_at ASC, MIN(id) ASC`
      )
      .all(repertoire.id);
  } else if (mode === "weak") {
    rows = db.prepare(weakEpdQuery()).all(repertoire.id);
  } else if (mode === "specific" || mode === "line") {
    const lineIds = (options.lineIds || [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (!lineIds.length) return [];
    const placeholders = lineIds.map(() => "?").join(",");
    const lines = db
      .prepare(`SELECT * FROM lines WHERE repertoire_id = ? AND id IN (${placeholders})`)
      .all(repertoire.id, ...lineIds);
    const epds = [];
    const seen = new Set();
    for (const line of lines) {
      let derived = [];
      try {
        derived = deriveLineMoves(lineSans(line), repertoire.color);
      } catch {
        continue;
      }
      for (const move of derived) {
        if (!move.isUser || seen.has(move.epd)) continue;
        seen.add(move.epd);
        epds.push(move.epd);
      }
    }
    return epds;
  } else {
    // "all": every position where the user is to move, in line order, so the
    // session walks each line move by move and terminates (D005).
    rows = db
      .prepare(
        `SELECT epd, MIN(line_id) AS line_id, MIN(ply) AS ply
         FROM line_moves
         WHERE repertoire_id = ? AND is_user = 1
         GROUP BY epd
         ORDER BY MIN(line_id) ASC, MIN(ply) ASC, MIN(id) ASC`
      )
      .all(repertoire.id);
  }

  return rows.map((row) => row.epd);
}

export function dueMoveCount(db, repertoireId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM line_moves
       WHERE repertoire_id = ? AND is_user = 1
         AND due_at IS NOT NULL AND julianday(due_at) <= julianday(?)`
    )
    .get(repertoireId, nowIso()).n;
}

/* ------------------------------------------------------------- daily/stats --- */

export function streakFor(db, userId, tzOffset) {
  const offset = parseOffset(tzOffset);
  const rows = db
    .prepare("SELECT DISTINCT daily AS day FROM reviews WHERE user_id = ? AND daily IS NOT NULL")
    .all(userId);
  return computeStreak(
    rows.map((row) => row.day),
    offset,
    todayLocal(offset)
  );
}

export function dailySummary(db, userId, tzOffset) {
  const offset = parseOffset(tzOffset);
  const date = todayLocal(offset);
  const today = db
    .prepare(
      `SELECT COUNT(*) AS reviews,
              COALESCE(SUM(correct), 0) AS correct,
              COALESCE(SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END), 0) AS wrong
       FROM reviews WHERE user_id = ? AND daily = ?`
    )
    .get(userId, date);
  const goalRow = db
    .prepare("SELECT daily_goal FROM settings WHERE user_id = ?")
    .get(userId);
  const goal = Number(goalRow?.daily_goal || 50);
  const reviews = Number(today.reviews || 0);
  return {
    date,
    reviews,
    correct: Number(today.correct || 0),
    wrong: Number(today.wrong || 0),
    goal,
    goalMet: reviews >= goal,
    remaining: Math.max(0, goal - reviews),
    streak: streakFor(db, userId, offset),
  };
}

export function persistStreak(db, userId, tzOffset) {
  const streak = streakFor(db, userId, tzOffset);
  db.prepare(
    `UPDATE users SET current_streak = ?, highest_streak = ?, last_streak_date = ?
     WHERE id = ?`
  ).run(streak.current, streak.highest, streak.lastStreakDate, userId);
  return streak;
}

/* ---------------------------------------------------------------- lessons --- */

/** Human-readable "next move" label: `3.` for White, `3…` for Black. */
export function movePrompt(side, ply) {
  const moveNumber = Math.floor((Number(ply) - 1) / 2) + 1;
  return {
    moveNumber,
    suffix: side === "white" ? "." : "…",
    label: `${moveNumber}${side === "white" ? "." : "…"}`,
  };
}

export { START_FEN, epdOf, lineSans, sanKey, localDay };
