import { isEpdLike, deriveLineMoves, epdOf, findLegalMove, lineSans, sanKey, validateLine } from "./positions.js";
import { statsFor } from "./repertoire.js";
import { nowIso } from "./dates.js";

/**
 * Data-integrity checks (audit D221).
 *
 * Everything the trainer stores must be derivable: lines must be legal PGN
 * whose stored FEN/SAN agree with the moves, every line move must exist with
 * a legal SAN from its own position, reviews must point at real moves, and
 * the reported due counts must equal the actual due move rows.
 *
 * `GET /api/integrity` exposes this; the server tests assert `ok === true`.
 */
export function checkDatabase(db) {
  const errors = [];
  const counts = {
    repertoires: 0,
    lines: 0,
    lineMoves: 0,
    reviews: 0,
    sessions: 0,
    notes: 0,
  };

  const push = (code, message, extra = {}) => {
    errors.push({ code, message, ...extra });
  };

  try {
    const pragma = db.prepare("PRAGMA integrity_check").all();
    for (const row of pragma) {
      if (row.integrity_check !== "ok") {
        push("sqlite_integrity", String(row.integrity_check));
      }
    }
  } catch (error) {
    push("sqlite_integrity", error.message);
  }

  try {
    for (const row of db.prepare("PRAGMA foreign_key_check").all()) {
      push("foreign_key", `Foreign key violation in ${row.table}`, row);
    }
  } catch (error) {
    push("foreign_key", error.message);
  }

  const repertoires = db.prepare("SELECT * FROM repertoires ORDER BY id").all();
  counts.repertoires = repertoires.length;
  const repertoireById = new Map(repertoires.map((r) => [r.id, r]));

  const lookupMove = db.prepare(
    "SELECT * FROM line_moves WHERE repertoire_id = ? AND epd = ? AND san_key = ? LIMIT 1"
  );

  for (const repertoire of repertoires) {
    const lines = db.prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id").all(repertoire.id);
    counts.lines += lines.length;

    for (const line of lines) {
      const lineErrors = validateLine(line, repertoire.color);
      for (const error of lineErrors) {
        push(error.code, error.message, { lineId: line.id, repertoireId: repertoire.id });
      }
      let derived = [];
      try {
        derived = deriveLineMoves(lineSans(line), repertoire.color);
      } catch {
        continue;
      }
      for (const move of derived) {
        const row = lookupMove.get(repertoire.id, move.epd, sanKey(move.san));
        if (!row) {
          push(
            "line_move_missing",
            `Line ${line.id} move ${move.ply} ${move.san} is missing from line_moves`,
            { lineId: line.id, repertoireId: repertoire.id, ply: move.ply, san: move.san }
          );
          continue;
        }
        if (epdOf(row.fen) !== move.epd) {
          push("line_move_fen", `line_moves ${row.id} has the wrong position`, { lineMoveId: row.id });
        }
        if (row.side !== move.side) {
          push("line_move_side", `line_moves ${row.id} has the wrong side`, { lineMoveId: row.id });
        }
        if (row.is_user !== (move.isUser ? 1 : 0)) {
          push("line_move_owner", `line_moves ${row.id} has the wrong is_user flag`, {
            lineMoveId: row.id,
          });
        }
      }
    }
  }

  const moves = db.prepare("SELECT * FROM line_moves ORDER BY id").all();
  counts.lineMoves = moves.length;
  for (const move of moves) {
    const repertoire = repertoireById.get(move.repertoire_id);
    if (!repertoire) {
      push("move_orphan", `line_moves ${move.id} has no repertoire`, { lineMoveId: move.id });
      continue;
    }
    if (!isEpdLike(move.epd) || epdOf(move.fen) !== move.epd) {
      push("move_epd", `line_moves ${move.id} EPD does not match its FEN`, {
        lineMoveId: move.id,
      });
    }
    if (sanKey(move.san) !== move.san_key) {
      push("move_san_key", `line_moves ${move.id} san_key is not normalised`, {
        lineMoveId: move.id,
      });
    }
    let legal = null;
    try {
      legal = findLegalMove(move.fen, move.san);
    } catch {
      legal = null;
    }
    if (!legal) {
      push("move_illegal", `line_moves ${move.id} SAN ${move.san} is illegal in its position`, {
        lineMoveId: move.id,
      });
    }
    const turn = move.fen.split(" ")[1] === "w" ? "white" : "black";
    if (move.side !== turn) {
      push("move_turn", `line_moves ${move.id} side does not match the FEN turn`, {
        lineMoveId: move.id,
      });
    }
    if ((repertoire.color === move.side) !== Boolean(move.is_user)) {
      push("move_is_user", `line_moves ${move.id} is_user does not match the repertoire colour`, {
        lineMoveId: move.id,
      });
    }
    if (move.due_at && Number.isNaN(Date.parse(move.due_at))) {
      push("move_due_date", `line_moves ${move.id} has an unparseable due_at`, {
        lineMoveId: move.id,
      });
    }
  }

  const moveById = new Map(moves.map((m) => [m.id, m]));
  const reviews = db.prepare("SELECT * FROM reviews ORDER BY id").all();
  counts.reviews = reviews.length;
  for (const review of reviews) {
    if (![0, 1].includes(Number(review.correct))) {
      push("review_correct", `review ${review.id} has an invalid correct flag`, { reviewId: review.id });
    }
    if (review.line_move_id != null) {
      const move = moveById.get(review.line_move_id);
      if (!move) {
        push("review_move_missing", `review ${review.id} points at a missing move`, {
          reviewId: review.id,
        });
      } else if (move.epd !== review.epd) {
        push("review_epd", `review ${review.id} EPD does not match its move`, {
          reviewId: review.id,
        });
      } else if (sanKey(move.san) !== sanKey(review.san)) {
        push("review_san", `review ${review.id} SAN does not match its move`, {
          reviewId: review.id,
        });
      }
    }
    if (!isEpdLike(review.epd)) {
      push("review_epd_format", `review ${review.id} has an invalid EPD`, { reviewId: review.id });
    }
  }

  const sessions = db.prepare("SELECT * FROM practice_sessions ORDER BY created_at").all();
  counts.sessions = sessions.length;
  for (const session of sessions) {
    let queue = [];
    let seen = [];
    try {
      queue = JSON.parse(session.queue || "[]");
      seen = JSON.parse(session.seen || "[]");
    } catch {
      push("session_json", `session ${session.id} has invalid queue/seen JSON`, {
        sessionId: session.id,
      });
      continue;
    }
    if (!Array.isArray(queue) || !Array.isArray(seen)) {
      push("session_json", `session ${session.id} queue/seen must be arrays`, {
        sessionId: session.id,
      });
      continue;
    }
    if (new Set(queue).size !== queue.length) {
      push("session_duplicate", `session ${session.id} has duplicate tasks`, {
        sessionId: session.id,
      });
    }
    const seenSet = new Set(seen);
    if (seen.some((epd) => !queue.includes(epd))) {
      push("session_seen", `session ${session.id} has seen positions outside its queue`, {
        sessionId: session.id,
      });
    }
    const remaining = queue.filter((epd) => !seenSet.has(epd)).length;
    if (session.status === "active" && remaining === 0 && queue.length > 0) {
      push("session_status", `session ${session.id} is active but has no remaining tasks`, {
        sessionId: session.id,
      });
    }
    if (session.cursor > queue.length) {
      push("session_cursor", `session ${session.id} cursor is out of range`, {
        sessionId: session.id,
      });
    }
  }

  const notes = db.prepare("SELECT * FROM notes ORDER BY id").all();
  counts.notes = notes.length;
  for (const note of notes) {
    if (!isEpdLike(note.epd)) {
      push("note_epd", `note ${note.id} has an invalid EPD`, { noteId: note.id });
    }
    if (!String(note.note || "").trim()) {
      push("note_empty", `note ${note.id} is empty`, { noteId: note.id });
    }
  }

  // Reported due counts must equal the actual due move rows.
  const dueCount = db.prepare(
    `SELECT COUNT(*) AS n FROM line_moves
     WHERE repertoire_id = ? AND is_user = 1
       AND due_at IS NOT NULL AND julianday(due_at) <= julianday(?)`
  );
  for (const repertoire of repertoires) {
    const stats = statsFor(db, repertoire);
    const actual = Number(dueCount.get(repertoire.id, nowIso()).n || 0);
    if (stats.due !== actual) {
      push("due_count_mismatch", `repertoire ${repertoire.id} reports ${stats.due} due but has ${actual}`, {
        repertoireId: repertoire.id,
      });
    }
    if (stats.moveCount < stats.learned || stats.moveCount < stats.mastered) {
      push("stats_inconsistent", `repertoire ${repertoire.id} has more learned moves than moves`, {
        repertoireId: repertoire.id,
      });
    }
  }

  return {
    ok: errors.length === 0,
    checkedAt: nowIso(),
    counts,
    errors,
  };
}
