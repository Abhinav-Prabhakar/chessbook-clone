/**
 * Saved-branch insertion.
 *
 * A branch is a real `lines` row whose prefix is copied from the line that
 * reaches the position. Duplicates are detected by the *final EPD*, not by the
 * move string, so transpositions merge instead of multiplying (D054/D065).
 */
import { Chess } from "chess.js";
import { deriveLineMoves, epdOf, findLegalMove, lineSans, pgnFromSans, sanKey } from "./positions.js";
import { rebuildRepertoireMoves } from "./repertoire.js";

export function lineEpds(sans) {
  const chess = new Chess();
  const out = [epdOf(chess.fen())];
  for (const san of sans) {
    chess.move(san);
    out.push(epdOf(chess.fen()));
  }
  return out;
}

export function finalEpd(sans) {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return epdOf(chess.fen());
}

export function lineContainingEpd(db, repertoireId, epd) {
  const lines = db
    .prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id")
    .all(repertoireId);
  let best = null;
  for (const line of lines) {
    const sans = lineSans(line);
    let positions;
    try {
      positions = lineEpds(sans);
    } catch {
      continue;
    }
    const index = positions.indexOf(epd);
    if (index === -1) continue;
    if (!best || sans.length > lineSans(best).length) {
      best = { line, index, sans };
    }
  }
  return best;
}

export function findLineByFinalEpd(db, repertoireId, epd) {
  return (
    db
      .prepare(
        "SELECT * FROM lines WHERE repertoire_id = ? AND epd = ? ORDER BY id LIMIT 1"
      )
      .get(repertoireId, epd) || null
  );
}

function syncTotals(db, repertoireId) {
  rebuildRepertoireMoves(db, repertoireId);
  db.prepare(
    "UPDATE repertoires SET total_lines = (SELECT COUNT(*) FROM lines WHERE repertoire_id = ?) WHERE id = ?"
  ).run(repertoireId, repertoireId);
}

/**
 * Add one saved move at `epd`.
 * Returns `{line, created, transposition, transpositionOf}`.
 */
export function addBranchAt(
  db,
  repertoire,
  { epd, san, name = null, origin = "manual", autofillStyle = null, sourceRef = null }
) {
  const cleanEpd = String(epd || "").split(" ").slice(0, 4).join(" ");
  const sideToMove = cleanEpd.split(" ")[1] === "b" ? "black" : "white";
  if (sideToMove !== repertoire.color) {
    return { error: "It is not your turn at that position", status: 400 };
  }
  let chess;
  try {
    chess = new Chess(`${cleanEpd} 0 1`);
  } catch {
    return { error: "That position is illegal", status: 400 };
  }
  const move = findLegalMove(chess.fen(), san);
  if (!move) return { error: `That move is not legal in this position`, status: 400 };

  const containing = lineContainingEpd(db, repertoire.id, cleanEpd);
  if (!containing && cleanEpd !== epdOf(new Chess().fen())) {
    return {
      error: "That position is not in this repertoire yet; add a line that reaches it first",
      status: 400,
    };
  }
  const prefix = containing ? containing.sans.slice(0, containing.index) : [];
  const sans = [...prefix, move.san];
  const ending = finalEpd(sans);
  const duplicate = findLineByFinalEpd(db, repertoire.id, ending);
  if (duplicate) {
    return {
      line: duplicate,
      created: false,
      transposition: duplicate.moves !== sans.join(" "),
      transpositionOf: duplicate.id,
    };
  }

  const before = new Chess();
  for (const san of sans.slice(0, -1)) before.move(san);
  const stamp = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO lines
        (repertoire_id, opening_id, name, moves, pgn, fen, epd, side, expected_san,
         learned, mastered, saved, due_at, origin, autofill_style, source_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, NULL, ?, ?, ?, ?)`
    )
    .run(
      repertoire.id,
      containing?.line?.opening_id ?? null,
      String(name || containing?.line?.name || `${repertoire.name} line`).trim(),
      sans.join(" "),
      pgnFromSans(sans),
      before.fen(),
      ending,
      repertoire.color,
      move.san,
      origin,
      autofillStyle,
      sourceRef,
      stamp
    );
  syncTotals(db, repertoire.id);
  const line = db
    .prepare("SELECT * FROM lines WHERE id = ?")
    .get(result.lastInsertRowid);
  return { line, created: true, transposition: false, transpositionOf: null };
}

/**
 * Import one legal PGN/SAN line. The line is returned/merged by final EPD.
 */
export function addLineFromSans(
  db,
  repertoire,
  { sans, name = null, origin = "import", sourceRef = null, openingId = null }
) {
  const moves = (sans || []).map(String).filter(Boolean);
  if (!moves.length) return { error: "Empty line", status: 400 };
  const chess = new Chess();
  const normalized = [];
  for (const san of moves) {
    try {
      normalized.push(chess.move(san).san);
    } catch {
      return { error: `Illegal move ${san} at ply ${normalized.length + 1}`, status: 400 };
    }
  }
  const lastSide = normalized.length % 2 === 1 ? "white" : "black";
  if (lastSide !== repertoire.color) {
    return {
      error: `That line ends with a ${lastSide} move; add it to a ${lastSide} repertoire`,
      status: 400,
    };
  }
  const ending = finalEpd(normalized);
  const duplicate = findLineByFinalEpd(db, repertoire.id, ending);
  if (duplicate) {
    return {
      line: duplicate,
      created: false,
      transposition: duplicate.moves !== normalized.join(" "),
      transpositionOf: duplicate.id,
    };
  }

  const before = new Chess();
  for (const san of normalized.slice(0, -1)) before.move(san);
  const stamp = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO lines
        (repertoire_id, opening_id, name, moves, pgn, fen, epd, side, expected_san,
         learned, mastered, saved, due_at, origin, source_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, NULL, ?, ?, ?)`
    )
    .run(
      repertoire.id,
      openingId ?? null,
      String(name || "Imported line").trim(),
      normalized.join(" "),
      pgnFromSans(normalized),
      before.fen(),
      ending,
      repertoire.color,
      normalized[normalized.length - 1],
      origin,
      sourceRef,
      stamp
    );
  syncTotals(db, repertoire.id);
  const line = db
    .prepare("SELECT * FROM lines WHERE id = ?")
    .get(result.lastInsertRowid);
  return { line, created: true, transposition: false, transpositionOf: null };
}

export { deriveLineMoves, sanKey };
