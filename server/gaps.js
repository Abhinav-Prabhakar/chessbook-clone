/**
 * Biggest-gap selection and the ranked gap list.
 *
 * Production selects a *missing move weighted by how often the position
 * occurs* (`biggestMiss.incidence` in `home.fetchHome_v2`), not the deepest
 * unlearned line. This module reconstructs that ranking from the captured
 * candidate reports and falls back to the captured `biggestMiss` when the
 * report for its position is available.
 */
import { Chess } from "chess.js";
import { epdOf, lineSans, sanKey } from "./positions.js";
import { candidateList, reportForEpd, pathForEpd } from "./opening-data.js";

function lastMoveProbability(db, epd, san, repertoireColor) {
  const report = reportForEpd(db, epd, { repertoireColor });
  if (!report) return null;
  const key = sanKey(san);
  const candidate = report.candidates.find((c) => c.san_key === key);
  if (!candidate) return null;
  const sideToMove = String(epd).split(" ")[1] === "b" ? "black" : "white";
  if (report.reference_color && report.reference_color !== sideToMove) {
    return candidate.incidence != null ? Number(candidate.incidence) : null;
  }
  return candidate.probability != null ? Number(candidate.probability) : null;
}

function positionsForRepertoire(db, repertoire, { lineId = null } = {}) {
  const lines = lineId
    ? db.prepare("SELECT * FROM lines WHERE repertoire_id = ? AND id = ?").all(repertoire.id, Number(lineId))
    : db.prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id").all(repertoire.id);
  const byEpd = new Map();

  for (const line of lines) {
    const sans = lineSans(line);
    const chess = new Chess();
    for (let i = 0; i <= sans.length; i += 1) {
      const epd = epdOf(chess.fen());
      const side = chess.turn() === "w" ? "white" : "black";
      if (side === repertoire.color) {
        const existing = byEpd.get(epd);
        const path = sans.slice(0, i);
        if (!existing || path.length < existing.path.length) {
          const lastSan = i > 0 ? sans[i - 1] : null;
          const parentEpd = i > 0 ? epdOf(replay(sans.slice(0, i - 1))) : null;
          const incidence =
            i === 0
              ? 1
              : lastMoveProbability(db, parentEpd, lastSan, repertoire.color);
          byEpd.set(epd, {
            epd,
            fen: chess.fen(),
            side,
            ply: i + 1,
            moveNumber: Math.floor(i / 2) + 1,
            path,
            lastSan,
            parentEpd,
            incidence,
            lineId: line.id,
            lineName: line.name,
          });
        }
      }
      if (i === sans.length) break;
      try {
        chess.move(sans[i]);
      } catch {
        break;
      }
    }
  }
  return [...byEpd.values()];
}

function replay(sans) {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return chess.fen();
}

/**
 * Rank every position where the repertoire has a missing captured candidate.
 * Weight = (probability the opponent played the move that reached this
 * position) × (probability the best missing reply is played).
 */
export function computeGaps(db, repertoire, { lineId = null, limit = 50 } = {}) {
  const positions = positionsForRepertoire(db, repertoire, { lineId });
  const capturedMiss = readCapturedMiss(db, repertoire);
  const gaps = [];

  for (const position of positions) {
    const detail = candidateList(db, {
      epd: position.epd,
      repertoire,
      prefixMoves: position.path,
    });
    if (!detail.available || !detail.candidates.length) continue;

    const missing = detail.candidates.filter((candidate) => !candidate.saved);
    if (!missing.length) continue;

    const best = [...missing].sort(
      (a, b) => Number(b.probability ?? 0) - Number(a.probability ?? 0)
    )[0];
    const positionIncidence = Number(position.incidence ?? 0);
    const weight = positionIncidence * Number(best.probability ?? 0);
    const saved = detail.candidates.length - missing.length;
    const captured =
      capturedMiss && capturedMiss.epd === position.epd ? capturedMiss : null;

    gaps.push({
      epd: position.epd,
      fen: position.fen,
      side: position.side,
      ply: position.ply,
      moveNumber: position.moveNumber,
      path: position.path,
      pathPgn: pgnPath(position.path),
      lastMove: position.lastSan
        ? {
            san: position.lastSan,
            ply: position.path.length,
            moveNumber: Math.floor((position.path.length - 1) / 2) + 1,
            side: position.path.length % 2 === 1 ? "white" : "black",
          }
        : null,
      lineId: position.lineId,
      lineName: position.lineName,
      incidence: positionIncidence,
      oneIn:
        positionIncidence > 0
          ? Math.max(1, Math.round(1 / positionIncidence))
          : null,
      weight: Math.round(weight * 1e8) / 1e8,
      missingWeight: Math.round(weight * 1e8) / 1e8,
      candidateCount: detail.candidates.length,
      savedCount: saved,
      missingCount: missing.length,
      coverage:
        detail.candidates.length > 0
          ? Math.round((saved / detail.candidates.length) * 1000) / 10
          : null,
      bestMissing: {
        san: best.san,
        name: best.name,
        probability: best.probability,
        incidence: best.incidence,
        oneIn: best.oneIn,
        eval: best.eval,
        masters: best.masters,
        annotation: best.annotation,
        epdAfter: best.epdAfter,
      },
      capturedMiss: Boolean(captured),
      capturedIncidence: captured ? captured.incidence : null,
    });
  }

  gaps.sort(
    (a, b) =>
      b.weight - a.weight ||
      b.incidence - a.incidence ||
      b.candidateCount - a.candidateCount ||
      a.epd.localeCompare(b.epd)
  );
  return gaps.slice(0, limit);
}

function pgnPath(path) {
  return path
    .map((san, index) => `${index % 2 === 0 ? `${index / 2 + 1}. ` : ""}${san}`)
    .join(" ");
}

export function readCapturedMiss(db, repertoire) {
  const row = db
    .prepare("SELECT * FROM repertoire_characteristics WHERE repertoire_id = ?")
    .get(repertoire.id);
  if (!row?.biggest_miss) return null;
  try {
    return JSON.parse(row.biggest_miss);
  } catch {
    return null;
  }
}

/**
 * Choose the default gap.
 *
 * The captured `biggestMiss` wins when its position has a captured report (the
 * real production answer); otherwise the weighted local ranking decides. The
 * legacy `line` view is returned separately by the API.
 */
export function chooseGap(db, repertoire, { lineId = null, epd = null, afterEpd = null } = {}) {
  if (epd) {
    const path = pathForEpd(db, repertoire.id, epd);
    const detail = candidateList(db, {
      epd,
      repertoire,
      prefixMoves: path?.prefixMoves || [],
    });
    if (!detail.available) return { gap: null, position: null, detail, gaps: [] };
    const missing = detail.candidates.filter((c) => !c.saved);
    const position = {
      epd,
      fen: detail.fen,
      side: detail.side,
      ply: path?.ply ?? null,
      moveNumber: Math.floor((path?.prefixMoves?.length || 0) / 2) + 1,
      path: path?.prefixMoves ?? [],
      pathPgn: pgnPath(path?.prefixMoves ?? []),
      lastMove: path?.prefixMoves?.length
        ? {
            san: path.prefixMoves[path.prefixMoves.length - 1],
            ply: path.prefixMoves.length,
            moveNumber: Math.floor((path.prefixMoves.length - 1) / 2) + 1,
            side: path.prefixMoves.length % 2 === 1 ? "white" : "black",
          }
        : null,
      lineId: path?.lineId ?? null,
      lineName: path?.lineName ?? null,
      incidence: null,
      oneIn: null,
      candidateCount: detail.candidates.length,
      savedCount: detail.candidates.length - missing.length,
      missingCount: missing.length,
      coverage:
        detail.candidates.length > 0
          ? Math.round(
              ((detail.candidates.length - missing.length) /
                detail.candidates.length) *
                1000
            ) / 10
          : null,
      bestMissing: missing.length
        ? {
            san: missing[0].san,
            name: missing[0].name,
            probability: missing[0].probability,
            incidence: missing[0].incidence,
            eval: missing[0].eval,
            masters: missing[0].masters,
            annotation: missing[0].annotation,
          }
        : null,
      capturedMiss: false,
    };
    return { gap: position, position: detail, detail, gaps: [] };
  }

  const gaps = computeGaps(db, repertoire, { lineId });
  if (!gaps.length) {
    return { gap: null, position: null, detail: null, gaps: [] };
  }

  let selected = null;
  const captured = readCapturedMiss(db, repertoire);
  if (afterEpd) {
    const index = gaps.findIndex((item) => item.epd === afterEpd);
    selected = gaps[(index + 1 + gaps.length) % gaps.length] || gaps[0];
  }
  if (!selected && captured?.epd && !lineId) {
    const match = gaps.find((item) => item.epd === captured.epd);
    const detail = match
      ? candidateList(db, {
          epd: match.epd,
          repertoire,
          prefixMoves: match.path,
        })
      : null;
    if (match && detail?.available) selected = match;
  }

  if (!selected) selected = gaps[0];

  const detail = candidateList(db, {
    epd: selected.epd,
    repertoire,
    prefixMoves: selected.path,
  });
  return { gap: selected, position: detail, detail, gaps };
}
