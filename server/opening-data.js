/**
 * Real opening/position data from the production captures.
 *
 * Nothing here computes a fake number: every percentage, eval and incidence is
 * read from `position_reports` / `position_candidates` / `opening_names`, and a
 * position without a captured report is explicitly `available:false`.
 */
import { Chess } from "chess.js";
import { epdOf, fenFromEpd, lineSans, sanKey } from "./positions.js";
import { bandMatch, readSettings } from "./settings.js";

const pct = (part, total) =>
  total > 0 && Number.isFinite(part) ? Math.round((part / total) * 1000) / 10 : null;

export function reportsForEpd(db, epd) {
  const rows = db
    .prepare("SELECT * FROM position_reports WHERE epd = ? ORDER BY complete DESC, id ASC")
    .all(epd);
  return rows.map((row) => ({
    ...row,
    candidates: db
      .prepare("SELECT * FROM position_candidates WHERE report_id = ? ORDER BY rank ASC")
      .all(row.id),
  }));
}

export function reportForEpd(db, epd, { repertoireColor = null } = {}) {
  const reports = reportsForEpd(db, epd);
  if (!reports.length) return null;
  const sideToMove = String(epd).split(" ")[1] === "b" ? "black" : "white";
  const scored = reports.map((report) => {
    let score = 0;
    // A complete capture gives usable Masters percentages.
    if (report.complete) score += 4;
    // Prefer the report in which this position is the opponent's turn: there
    // `incidence` is a real unconditional play probability, not 1.
    if (report.reference_color && report.reference_color !== sideToMove) score += 8;
    if (repertoireColor && report.reference_color === repertoireColor) score += 2;
    if (report.candidates.length) score += 1;
    return { report, score };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.report.candidates.length - a.report.candidates.length ||
      a.report.id - b.report.id
  );
  return scored[0].report;
}

export function fullNameForEpd(db, epd) {
  const row = db.prepare("SELECT * FROM opening_names WHERE epd = ?").get(epd);
  if (row) {
    return {
      name: row.full_name,
      fullName: row.full_name,
      friendlyName: row.friendly_name ?? null,
      source: row.source,
    };
  }
  const opening = db
    .prepare(
      "SELECT eco, name FROM openings WHERE epd_after = ? ORDER BY LENGTH(sans) ASC, name ASC LIMIT 1"
    )
    .get(epd);
  if (opening) {
    return {
      name: opening.name,
      fullName: opening.name,
      friendlyName: null,
      eco: opening.eco,
      source: "lichess-eco",
    };
  }
  return { name: null, fullName: null, friendlyName: null, eco: null, source: null };
}

/** Exact opening row for a move path: `e4 c5` → Sicilian Defense. */
export function openingForPath(db, sans) {
  const joined = (sans || []).join(" ");
  if (!joined) return null;
  const row = db
    .prepare(
      "SELECT id, eco, name, sans FROM openings WHERE sans = ? ORDER BY CASE WHEN source = 'lichess-eco' THEN 0 ELSE 1 END, id LIMIT 1"
    )
    .get(joined);
  if (row) return { id: row.id, eco: row.eco, name: row.name, source: "lichess-eco" };
  const guide = db
    .prepare("SELECT id, eco, name, sans FROM opening_guides WHERE sans = ? LIMIT 1")
    .get(joined);
  if (guide) return { id: null, eco: guide.eco, name: guide.name, source: "opening-guides" };
  return null;
}

export function capturedProfile(db) {
  const rows = db.prepare("SELECT * FROM capture_profile").all();
  const profile = {};
  for (const row of rows) profile[row.key] = row.value;
  return profile;
}

/**
 * The captures contain statistics for exactly one reference band
 * (`ratingRange` 1800–2000; `eloRange` 2000–2200). Return that band only: do
 * not synthesise the other bands the production UI can show.
 */
export function ratingBandInfo(db) {
  const profile = capturedProfile(db);
  const band = profile.ratingRange || profile.eloRange || null;
  return {
    band,
    eloRange: profile.eloRange || null,
    ratingSystem: profile.ratingSystem || null,
    singleElo: profile.singleElo == null ? null : Number(profile.singleElo),
    source: band ? "recon/live4/network.json#2 (/api/user)" : null,
    available: Boolean(band),
  };
}

export function annotationsForPosition(db, epd) {  return db
    .prepare("SELECT * FROM position_annotations WHERE epd = ? ORDER BY id")
    .all(epd)
    .map((row) => ({
      id: row.id,
      epd: row.epd,
      san: row.san ?? null,
      text: row.text,
      mine: Boolean(row.mine),
      repertoireId: row.repertoire_id,
      source: row.source,
    }));
}

export function annotationForMove(db, epd, san) {
  const row = db
    .prepare(
      `SELECT * FROM position_annotations
       WHERE epd = ? AND san IS NOT NULL AND san = ?
       ORDER BY id LIMIT 1`
    )
    .get(epd, san);
  return row
    ? { text: row.text, source: row.source }
    : null;
}

function totals(results) {
  if (!results) return null;
  const white = Number(results.white ?? 0);
  const draw = Number(results.draw ?? 0);
  const black = Number(results.black ?? 0);
  const total = white + draw + black;
  return total > 0 ? { white, draw, black, total } : null;
}

function masterTotals(report) {
  const position = totals(report.masterResults || {
    white: report.master_white,
    draw: report.master_draw,
    black: report.master_black,
  });
  if (!position) return null;
  // Only a complete capture contains the whole candidate array: with a
  // truncated response the denominator is unknown, so Masters stays null.
  if (!report.complete) return null;
  const summed = report.candidates.reduce((n, candidate) => {
    const value = totals(candidate.masterResults || {
      white: candidate.master_white,
      draw: candidate.master_draw,
      black: candidate.master_black,
    });
    return n + (value?.total || 0);
  }, 0);
  return summed > 0 ? { position, summed } : null;
}

function peerResults(candidate) {
  const value = totals(candidate.results || {
    white: candidate.peer_white,
    draw: candidate.peer_draw,
    black: candidate.peer_black,
  });
  if (!value) return null;
  return {
    white: pct(value.white, value.total),
    draw: pct(value.draw, value.total),
    black: pct(value.black, value.total),
    games: value.total,
    whiteWins: value.white,
    draws: value.draw,
    blackWins: value.black,
  };
}

function masterResults(candidate, masterBase) {
  const value = totals(candidate.masterResults || {
    white: candidate.master_white,
    draw: candidate.master_draw,
    black: candidate.master_black,
  });
  if (!value || !masterBase) return null;
  return {
    white: pct(value.white, masterBase.summed),
    draw: pct(value.draw, masterBase.summed),
    black: pct(value.black, masterBase.summed),
    games: value.total,
    share: pct(value.total, masterBase.summed),
    whiteWins: value.white,
    draws: value.draw,
    blackWins: value.black,
  };
}

export function savedMovesAt(db, repertoireId, epd) {
  const rows = db
    .prepare(
      `SELECT lm.*, l.name AS line_name, l.moves AS line_moves, l.id AS line_id
       FROM line_moves lm JOIN lines l ON l.id = lm.line_id
       WHERE lm.repertoire_id = ? AND lm.epd = ? AND lm.is_user = 1
       ORDER BY lm.id`
    )
    .all(repertoireId, epd);
  const map = new Map();
  for (const row of rows) {
    const key = row.san_key;
    if (!map.has(key)) {
      map.set(key, {
        san: row.san,
        sanKey: key,
        lineMoveId: row.id,
        lineId: row.line_id,
        lineName: row.line_name,
        ply: row.ply,
        learned: Boolean(row.learned),
        dueAt: row.due_at,
        reps: row.reps,
        disabled: Boolean(row.disabled),
      });
    }
  }
  return map;
}

export function exclusionsAt(db, repertoireId, epd) {
  const rows = db
    .prepare("SELECT * FROM repertoire_exclusions WHERE repertoire_id = ? AND epd = ?")
    .all(repertoireId, epd);
  return new Set(rows.map((row) => row.san_key));
}

export function pathForEpd(db, repertoireId, epd) {
  const row = db
    .prepare(
      `SELECT lm.*, l.moves AS line_moves, l.name AS line_name, l.id AS line_id
       FROM line_moves lm JOIN lines l ON l.id = lm.line_id
       WHERE lm.repertoire_id = ? AND lm.epd = ?
       ORDER BY lm.ply DESC, lm.id ASC LIMIT 1`
    )
    .get(repertoireId, epd);
  if (!row) {
    // The position may be beyond the end of every saved line (the next gap).
    // Walk lines and look for a prefix that reaches it.
    const lines = db
      .prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id")
      .all(repertoireId);
    for (const line of lines) {
      const sans = lineSans(line);
      const chess = new Chess();
      for (let i = 0; i < sans.length; i += 1) {
        if (epdOf(chess.fen()) === epd) {
          return {
            lineId: line.id,
            lineName: line.name,
            lineMoves: sans.join(" "),
            prefixMoves: sans.slice(0, i),
            ply: i + 1,
            side: chess.turn() === "w" ? "white" : "black",
            fen: chess.fen(),
          };
        }
        try {
          chess.move(sans[i]);
        } catch {
          break;
        }
      }
    }
    return null;
  }
  const sans = String(row.line_moves || "").split(" ").filter(Boolean);
  return {
    lineId: row.line_id,
    lineName: row.line_name,
    lineMoves: row.line_moves,
    prefixMoves: sans.slice(0, Math.max(0, Number(row.ply) - 1)),
    ply: row.ply,
    side: row.side,
    fen: row.fen,
  };
}

/**
 * Full ranked candidate list for one position.
 *
 * `prefixMoves` is the path to the position (used to look up the exact opening
 * name of the move: `e4 c5` → Sicilian Defense).
 */
export function candidateList(
  db,
  { epd, repertoire, prefixMoves = null, includeExcluded = true, limit = null, offset = 0 }
) {
  const report = reportForEpd(db, epd, { repertoireColor: repertoire?.color });
  const sideToMove = String(epd).split(" ")[1] === "b" ? "black" : "white";
  const pathInfo = repertoire ? pathForEpd(db, repertoire.id, epd) : null;
  const path = prefixMoves || pathInfo?.prefixMoves || [];
  const saved = repertoire ? savedMovesAt(db, repertoire.id, epd) : new Map();
  const excluded = repertoire ? exclusionsAt(db, repertoire.id, epd) : new Set();
  const band = ratingBandInfo(db);
  const settings = repertoire?.user_id ? readSettings(db, repertoire.user_id) : null;
  const profileBand = settings ? bandMatch(db, settings) : null;
  const coverageGoal = settings?.coverageGoal ?? 50;
  const minIncidence = 1 / Math.max(1, coverageGoal);
  const bandMatches = profileBand ? profileBand.matches : true;

  const base = {
    epd,
    fen: fenFromEpd(epd) || epd,
    side: sideToMove,
    repertoireSide: repertoire?.color ?? null,
    isYourTurn: repertoire ? sideToMove === repertoire.color : null,
    prefixMoves: path,
    moveNumber: Math.floor(path.length / 2) + 1,
    parentLineId: pathInfo?.lineId ?? null,
    parentLineName: pathInfo?.lineName ?? null,
    available: Boolean(report),
    source: report?.source ?? null,
    complete: report ? Boolean(report.complete) : null,
    stockfish: report
      ? {
          eval: report.stockfish_eval,
          mate: report.stockfish_mate,
          pawns:
            report.stockfish_eval == null
              ? null
              : Math.round((report.stockfish_eval / 100) * 100) / 100,
          available: report.stockfish_eval != null || report.stockfish_mate != null,
        }
      : { eval: null, mate: null, pawns: null, available: false },
    savedMoves: [...saved.values()],
    excludedMoves: [...excluded],
    candidates: [],
    total: 0,
    offset,
    limit,
    hasMore: false,
    nextOffset: null,
    annotation: null,
    ratingBand: {
      ...band,
      profile: profileBand,
      matches: bandMatches,
      note: profileBand
        ? profileBand.matches
          ? `Statistics captured for ${profileBand.userBand} ${profileBand.capturedSystem ?? ""}`.trim()
          : `Captured statistics are for ${profileBand.capturedBands.join(", ")}; your profile is ${profileBand.userBand}. Band-specific incidence is hidden.`
        : null,
    },
    coverageGoal,
    minIncidence,
    incidenceByBand: band.available
      ? [{ band: band.band, probability: null, source: band.source, available: true }]
      : [],
    bandsAvailable: band.available && bandMatches,
    profileBand,
  };

  if (!report) return base;

  const masterBase = masterTotals(report);
  const all = report.candidates
    .map((candidate) => {
      const key = candidate.san_key;
      const savedMove = saved.get(key);
      const isExcluded = excluded.has(key);
      const movePath = [...path, candidate.san];
      const opening = openingForPath(db, movePath);
      const fallback = candidate.epd_after ? fullNameForEpd(db, candidate.epd_after) : null;
      const annotation =
        candidate.annotation ??
        annotationForMove(db, epd, candidate.san)?.text ??
        null;
      const master = masterResults(candidate, masterBase);
      const peers = peerResults(candidate);
      const realIncidence =
        report.reference_color && report.reference_color !== sideToMove
          ? candidate.incidence
          : null;
      const playProbability =
        candidate.probability == null ? null : Number(candidate.probability);
      const capturedIncidence = realIncidence ?? playProbability;
      const incidence = bandMatches ? capturedIncidence : null;
      const oneIn =
        incidence && incidence > 0 ? Math.max(1, Math.round(1 / incidence)) : null;
      return {
        rank: candidate.rank,
        san: candidate.san,
        sanKey: key,
        uci: null,
        epd: epd,
        epdAfter: candidate.epd_after,
        fenAfter: candidate.epd_after ? fenFromEpd(candidate.epd_after) : null,
        name: opening?.name ?? fallback?.name ?? null,
        eco: opening?.eco ?? fallback?.eco ?? null,
        openingId: opening?.id ?? null,
        friendlyName: fallback?.friendlyName ?? null,
        // Legacy builder field: Masters used to be local mastery. It is now the
        // captured master-game share, so old screens show real data (D036).
        mastery: master?.share ?? null,
        lineCount: savedMove ? 1 : 0,
        inRepertoire: Boolean(savedMove),
        annotation,
        description: annotation,
        masters: master?.share ?? null,
        masterResults: master,
        mastersAvailable: Boolean(master),
        peers: peers
          ? { white: peers.white, black: peers.black, draw: peers.draw }
          : null,
        peerResults: peers,
        peersAvailable: Boolean(peers),
        eval: candidate.stockfish_eval,
        evalPawn:
          candidate.stockfish_eval == null
            ? null
            : Math.round((candidate.stockfish_eval / 100) * 100) / 100,
        mate: candidate.stockfish_mate,
        evalAvailable:
          candidate.stockfish_eval != null || candidate.stockfish_mate != null,
        probability: playProbability,
        incidence,
        capturedIncidence,
        incidenceAvailable: incidence != null,
        bandMismatch: !bandMatches && capturedIncidence != null,
        meetsCoverage: incidence != null ? incidence >= minIncidence : null,
        incidenceByBand: band.available && bandMatches
          ? [
              {
                band: band.band,
                probability: playProbability,
                incidence,
                source: band.source,
                available: incidence != null,
              },
            ]
          : [],
        oneIn,
        incidenceLabel: oneIn ? `1 in ${oneIn} games` : null,
        // True incidence is only known when the captured report looked at this
        // position from the opponent's side. Own moves still have a real
        // conditional play rate (`probability`).
        realIncidenceAvailable: realIncidence != null,
        needed: !savedMove,
        saved: Boolean(savedMove),
        disabled: Boolean(savedMove?.disabled),
        excluded: isExcluded,
        playable: !isExcluded && !savedMove?.disabled,
        lineId: savedMove?.lineId ?? null,
        lineName: savedMove?.lineName ?? null,
        lineMoveId: savedMove?.lineMoveId ?? null,
        parentLineId: pathInfo?.lineId ?? null,
        parentLineName: pathInfo?.lineName ?? null,
        branchMoves: movePath,
        branchPgn: null,
        danger: candidate.danger,
        similarPositionCount: candidate.similar_position_count,
        similarPositionMatchCount: candidate.similar_position_match_count,
        source: report.source,
      };
    })
    .filter((candidate) => includeExcluded || !candidate.excluded);
  all.forEach((candidate, index) => {
    candidate.rank = index + 1;
    candidate.branchPgn = candidate.branchMoves
      .map((san, i) => `${i % 2 === 0 ? `${i / 2 + 1}. ` : ""}${san}`)
      .join(" ");
    candidate.pgn = candidate.branchPgn;
  });

  // Saved moves that are not part of the captured top list still belong in the
  // builder; append them honestly with unavailable stats rather than hiding
  // the user's own branch.
  const present = new Set(all.map((candidate) => candidate.sanKey));
  for (const [key, savedMove] of saved) {
    if (present.has(key) || (!includeExcluded && excluded.has(key))) continue;
    const movePath = [...path, savedMove.san];
    const opening = openingForPath(db, movePath);
    all.push({
      rank: all.length + 1,
      san: savedMove.san,
      sanKey: key,
      uci: null,
      epd,
      epdAfter: null,
      fenAfter: null,
      name: opening?.name ?? null,
      eco: opening?.eco ?? null,
      openingId: opening?.id ?? null,
      friendlyName: null,
      mastery: null,
      lineCount: 1,
      inRepertoire: true,
      annotation: annotationForMove(db, epd, savedMove.san)?.text ?? null,
      description: annotationForMove(db, epd, savedMove.san)?.text ?? null,
      masters: null,
      masterResults: null,
      mastersAvailable: false,
      peers: null,
      peerResults: null,
      peersAvailable: false,
      eval: null,
      evalPawn: null,
      mate: null,
      evalAvailable: false,
      probability: null,
      incidence: null,
      capturedIncidence: null,
      incidenceAvailable: false,
      bandMismatch: false,
      meetsCoverage: null,
      incidenceByBand: [],
      oneIn: null,
      incidenceLabel: null,
      realIncidenceAvailable: false,
      needed: false,
      saved: true,
      disabled: Boolean(savedMove.disabled),
      excluded: excluded.has(key),
      playable: !excluded.has(key) && !savedMove.disabled,
      lineId: savedMove.lineId,
      lineName: savedMove.lineName,
      lineMoveId: savedMove.lineMoveId,
      parentLineId: pathInfo?.lineId ?? null,
      parentLineName: pathInfo?.lineName ?? null,
      branchMoves: movePath,
      branchPgn: movePath
        .map((san, i) => `${i % 2 === 0 ? `${i / 2 + 1}. ` : ""}${san}`)
        .join(" "),
      pgn: null,
      danger: null,
      similarPositionCount: null,
      similarPositionMatchCount: null,
      statsAvailable: false,
      source: null,
    });
  }

  const total = all.length;
  const start = Math.max(0, Math.trunc(Number(offset) || 0));
  const end = limit == null ? total : Math.min(total, start + Math.max(0, Number(limit)));
  const candidates = all.slice(start, end);
  return {
    ...base,
    candidates,
    total,
    offset: start,
    limit: limit == null ? null : Number(limit),
    hasMore: end < total,
    nextOffset: end < total ? end : null,
  };
}

/* -------------------------------------------------------------- headings --- */

export function positionHeading(prefixMoves, sideToMove) {
  const path = prefixMoves || [];
  if (!path.length) {
    return {
      prompt: "Choose a move to prepare for",
      moveNumber: 1,
      side: sideToMove,
      label: `1${sideToMove === "white" ? "." : "…"}`,
      lastMove: null,
      nextMove: { moveNumber: 1, side: sideToMove, label: `1${sideToMove === "white" ? "." : "…"}` },
    };
  }
  const lastPly = path.length;
  const lastName = path[lastPly - 1];
  const lastSide = lastPly % 2 === 1 ? "white" : "black";
  const lastMoveNumber = Math.floor((lastPly - 1) / 2) + 1;
  const lastLabel = `${lastMoveNumber}${lastSide === "white" ? "." : "…"} ${lastName}`;
  const nextMoveNumber = Math.floor(lastPly / 2) + 1;
  return {
    prompt: `Choose a response to ${lastLabel}`,
    moveNumber: nextMoveNumber,
    side: sideToMove,
    label: `${nextMoveNumber}${sideToMove === "white" ? "." : "…"}`,
    lastMove: {
      san: lastName,
      ply: lastPly,
      moveNumber: lastMoveNumber,
      side: lastSide,
      label: lastLabel,
    },
    nextMove: {
      moveNumber: nextMoveNumber,
      side: sideToMove,
      label: `${nextMoveNumber}${sideToMove === "white" ? "." : "…"}`,
    },
  };
}

/* ---------------------------------------------------------- style ranking --- */

const AGGRESSIVE = /attack|sacrific|sharp|aggress|initiative|dangerous|tactical|gambit/i;
const SOLID = /solid|reliable|safe|equal|stable|defend|neutral|solld/i;
const SHARP = /sharp|tactical|complicat|wild|double-edged|gambit|attack/i;

/**
 * Autofill style ranking. The scores are transparent heuristics over captured
 * facts (play rate, eval, masters/peer split, the captured annotation); they
 * are not presented as production "style points".
 */
export function scoreCandidate(candidate, style) {
  const probability = Number(candidate.probability ?? 0);
  const evalCp = Number(candidate.eval ?? 0);
  const draw = Number(candidate.peerResults?.draw ?? 0);
  const text = String(candidate.annotation || "");
  const annotationBonus = text ? 0.1 : 0;
  switch (style) {
    case "aggressive":
      return probability + (AGGRESSIVE.test(text) ? 0.25 : 0) + Math.max(0, -evalCp) / 2000;
    case "solid":
      return probability + (SOLID.test(text) ? 0.25 : 0) + draw / 400 - Math.abs(evalCp) / 4000;
    case "sharp":
      return probability + (SHARP.test(text) ? 0.25 : 0) + Math.abs(evalCp) / 1500;
    case "learnable":
      return probability + annotationBonus + (candidate.mastersAvailable ? 0.05 : 0);
    case "expected":
    case "all":
    default:
      return probability;
  }
}

export const STYLES = ["expected", "aggressive", "solid", "learnable", "sharp", "all"];

export { epdOf, sanKey, lineSans };
