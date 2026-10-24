/**
 * "Next common moves" practice queue (D016/D086).
 *
 * Production trains the positions you are most likely to face at your rating
 * band. This build has no online rating feed, but the captured position
 * reports contain the real incidence of each opponent move. A position enters
 * the queue only when:
 *
 *  1. the opponent reached it with a captured move whose incidence is at least
 *     `1 / coverageGoal` (the profile coverage goal), and
 *  2. the repertoire has at least one saved reply at that position.
 *
 * Nothing is random and nothing is synthesised: every entry carries the
 * captured incidence and its source.
 */
import { Chess } from "chess.js";
import { epdOf, lineSans, sanKey } from "./positions.js";
import { reportForEpd } from "./opening-data.js";
import { bandMatch, readSettings } from "./settings.js";

function incidenceFor(report, san) {
  if (!report) return null;
  const key = sanKey(san);
  const candidate = report.candidates.find((entry) => entry.san_key === key);
  if (!candidate) return null;
  const sideToMove = String(report.epd || "").split(" ")[1] === "b" ? "black" : "white";
  const value =
    report.reference_color && report.reference_color !== sideToMove
      ? candidate.incidence
      : candidate.probability;
  return value == null ? null : Number(value);
}

/**
 * @param {object} db
 * @param {object} repertoire
 * @param {{coverageGoal?: number, limit?: number, lineIds?: number[]}} options
 */
export function commonMoveQueue(db, repertoire, { coverageGoal = 50, limit = 40, lineIds = null } = {}) {
  const threshold = 1 / Math.max(1, Number(coverageGoal) || 50);
  // The captured incidence is tied to a rating band. If the profile band has
  // no captured data, "next common moves" is explicitly empty rather than
  // reusing another band's numbers (D135).
  const settings = repertoire?.user_id ? readSettings(db, repertoire.user_id) : null;
  if (settings) {
    const band = bandMatch(db, settings);
    if (band.available && !band.matches) return [];
  }
  const lines = db
    .prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id")
    .all(repertoire.id)
    .filter((line) => !lineIds || lineIds.includes(line.id));
  const savedMoves = new Map();
  for (const row of db
    .prepare(
      `SELECT epd, san_key FROM line_moves
       WHERE repertoire_id = ? AND is_user = 1 AND disabled = 0`
    )
    .all(repertoire.id)) {
    if (!savedMoves.has(row.epd)) savedMoves.set(row.epd, row.san_key);
  }

  const found = new Map();
  for (const line of lines) {
    if (line.disabled) continue;
    let sans;
    try {
      sans = lineSans(line);
    } catch {
      continue;
    }
    const chess = new Chess();
    let path = [];
    for (let i = 0; i < sans.length; i += 1) {
      const beforeEpd = epdOf(chess.fen());
      const side = chess.turn() === "w" ? "white" : "black";
      const san = sans[i];
      if (side !== repertoire.color) {
        // The opponent is about to move from a position the user already
        // reached. Use the captured report to see how likely each reply is.
        const report = reportForEpd(db, beforeEpd, { repertoireColor: repertoire.color });
        const incidence = incidenceFor(report, san);
        if (incidence != null && incidence >= threshold) {
          let after;
          try {
            const probe = new Chess(chess.fen());
            probe.move(san);
            after = probe;
          } catch {
            after = null;
          }
          if (after) {
            const epd = epdOf(after.fen());
            const replyKey = savedMoves.get(epd);
            if (replyKey) {
              const existing = found.get(epd);
              if (!existing || incidence > existing.incidence) {
                found.set(epd, {
                  epd,
                  fen: after.fen(),
                  path: [...path, san],
                  ply: i + 1,
                  moveNumber: Math.floor(i / 2) + 1,
                  side: repertoire.color,
                  via: {
                    epd: beforeEpd,
                    san,
                    incidence,
                    oneIn: Math.max(1, Math.round(1 / incidence)),
                    source: report?.source ?? null,
                    referenceColor: report?.reference_color ?? null,
                  },
                  lineId: line.id,
                  lineName: line.name,
                });
              }
            }
          }
        }
      }
      try {
        chess.move(san);
        path = [...path, san];
      } catch {
        break;
      }
    }
  }

  return [...found.values()]
    .sort(
      (a, b) =>
        b.via.incidence - a.via.incidence ||
        a.path.length - b.path.length ||
        a.epd.localeCompare(b.epd)
    )
    .slice(0, Math.max(1, Number(limit) || 40));
}

/** Metadata for the incoming opponent move of an arbitrary task. */
export function commonInfoForTask(db, repertoire, prefix, epd) {
  if (!prefix?.length) return null;
  const last = prefix[prefix.length - 1];
  const before = prefix.slice(0, -1);
  const chess = new Chess();
  try {
    for (const move of before) chess.move(move.san ?? move);
  } catch {
    return null;
  }
  const beforeEpd = epdOf(chess.fen());
  const report = reportForEpd(db, beforeEpd, { repertoireColor: repertoire.color });
  if (!report) return null;
  const incidence = incidenceFor(report, last.san);
  if (incidence == null) return null;
  return {
    epd,
    via: {
      epd: beforeEpd,
      san: last.san,
      incidence,
      oneIn: Math.max(1, Math.round(1 / incidence)),
      source: report.source,
    },
  };
}
