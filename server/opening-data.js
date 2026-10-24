/**
 * Real opening/position data from the production captures.
 *
 * Nothing here computes a fake number: every percentage, eval and incidence is
 * read from `position_reports` / `position_candidates` / `opening_names`, and a
 * position without a captured report is explicitly `available:false`.
 */
import { Chess } from "chess.js";
import { epdOf, fenFromEpd, lineSans, sanKey, findLegalMove } from "./positions.js";
import { bandMatch, readSettings } from "./settings.js";
import {
  explorerPosition,
  explorerMoveShare,
  lichessBandFor,
} from "./explorer-data.js";
import { evaluateCached, status as engineStatus } from "./engine.js";

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
  const explorerBand = lichessBandFor(settings ?? { singleElo: 1800, eloRange: null });
  const explorer = explorerPosition(db, epd, { band: explorerBand });
  const masters = explorer.masters;
  const peer = explorer.band;
  const coverageGoal = settings?.coverageGoal ?? 50;
  const minIncidence = 1 / Math.max(1, coverageGoal);
  const capturedBandUsable = !profileBand || profileBand.matches;
  const bandMatches = capturedBandUsable || Boolean(peer);
  const dataAvailable = Boolean(report) || explorer.available;
  const openingName = fullNameForEpd(db, epd);

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
    available: dataAvailable,
    source: report?.source ?? explorer.source ?? null,
    openingName: openingName.name,
    eco: openingName.eco ?? null,
    complete: report ? Boolean(report.complete) : null,
    games: {
      masters: masters?.games ?? null,
      band: peer?.games ?? null,
      bandLabel: peer?.band ?? explorerBand,
      total: explorer.available ? explorer.bands.reduce((sum, row) => sum + row.games, 0) : null,
    },
    stockfish: report
      ? {
          eval: report.stockfish_eval,
          mate: report.stockfish_mate,
          pawns:
            report.stockfish_eval == null
              ? null
              : Math.round((report.stockfish_eval / 100) * 100) / 100,
          available: report.stockfish_eval != null || report.stockfish_mate != null,
          source: report.stockfish_eval == null ? null : report.source,
        }
      : { eval: null, mate: null, pawns: null, available: false, source: null },
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
      explorer: {
        band: explorerBand,
        available: Boolean(peer),
        source: peer ? peer.source : null,
        bands: explorer.bands,
      },
      note: profileBand
        ? profileBand.matches
          ? `Captured statistics for ${profileBand.userBand} ${profileBand.capturedSystem ?? ""}; offline peer data mapped to ${explorerBand}.`.trim()
          : `Captured statistics are for ${profileBand.capturedBands.join(", ")}; your profile is ${profileBand.userBand}. Offline peer data is used for ${explorerBand}.`
        : `Offline peer data mapped to ${explorerBand}.`,
    },
    coverageGoal,
    minIncidence,
    incidenceByBand: peer
      ? [{ band: peer.band, probability: null, source: peer.source, available: true, games: peer.games }]
      : band.available
        ? [{ band: band.band, probability: null, source: band.source, available: true }]
        : [],
    bandsAvailable: bandMatches || Boolean(peer),
    profileBand,
    sources: {
      captured: report?.source ?? null,
      masters: masters?.source ?? null,
      lichess: peer?.source ?? null,
      engine: null,
    },
    unavailableReason:
      dataAvailable
        ? null
        : "No captured production report and no offline explorer data for this position.",
  };

  if (!dataAvailable) {
    return { ...base, candidates: [], total: 0 };
  }

  const masterBase = report ? masterTotals(report) : null;

  const lookupExplorer = (key, san) => ({
    em:
      masters?.moves.get(key) ||
      masters?.moves.get(sanKey(san)) ||
      null,
    ep:
      peer?.moves.get(key) ||
      peer?.moves.get(sanKey(san)) ||
      null,
  });

  const specs = [];
  const seen = new Set();
  if (report) {
    for (const candidate of report.candidates) {
      const key = candidate.san_key || sanKey(candidate.san);
      if (seen.has(key)) continue;
      seen.add(key);
      specs.push({
        key,
        san: candidate.san,
        captured: candidate,
        ...lookupExplorer(key, candidate.san),
        order: specs.length,
      });
    }
    // A truncated production capture has an unknown denominator; the offline
    // corpus can complete the list without overriding the captured rows.
    if (!report.complete && explorer.available) {
      for (const move of [...(masters?.moves.values() ?? []), ...(peer?.moves.values() ?? [])]) {
        const key = move.sanKey || sanKey(move.san);
        if (seen.has(key)) continue;
        seen.add(key);
        specs.push({ key, san: move.san, captured: null, ...lookupExplorer(key, move.san), order: specs.length });
      }
    }
  } else if (explorer.available) {
    for (const move of [...(peer?.moves.values() ?? []), ...(masters?.moves.values() ?? [])]) {
      const key = move.sanKey || sanKey(move.san);
      if (seen.has(key)) continue;
      seen.add(key);
      specs.push({ key, san: move.san, captured: null, ...lookupExplorer(key, move.san), order: specs.length });
    }
  }

  const built = [];
  for (const spec of specs) {
    const candidate = buildMergedCandidate({
      db,
      base,
      spec,
      path,
      report,
      masters,
      peer,
      masterBase,
      capturedBandUsable,
      saved,
      excluded,
      openingForPath,
      fullNameForEpd,
      minIncidence,
      explorerBand,
    });
    if (candidate) built.push(candidate);
  }

  // Saved moves that neither the capture nor the corpora listed still belong
  // in the builder, honestly marked unavailable rather than hidden.
  const present = new Set(built.map((candidate) => candidate.sanKey));
  for (const [key, savedMove] of saved) {
    if (present.has(key)) continue;
    const { em, ep } = lookupExplorer(key, savedMove.san);
    const candidate = buildMergedCandidate({
      db,
      base,
      spec: { key, san: savedMove.san, captured: null, em, ep, order: specs.length },
      path,
      report,
      masters,
      peer,
      masterBase,
      capturedBandUsable,
      saved,
      excluded,
      openingForPath,
      fullNameForEpd,
      minIncidence,
      explorerBand,
    });
    if (candidate) built.push(candidate);
  }

  if (!report) {
    built.sort(
      (a, b) =>
        Number(b.incidence ?? -1) - Number(a.incidence ?? -1) ||
        Number(b.masters ?? -1) - Number(a.masters ?? -1) ||
        a.san.localeCompare(b.san)
    );
  }
  built
    .filter((candidate) => includeExcluded || !candidate.excluded)
    .forEach((candidate, index) => {
      candidate.rank = index + 1;
      candidate.branchPgn = candidate.branchMoves
        .map((san, i) => `${i % 2 === 0 ? `${i / 2 + 1}. ` : ""}${san}`)
        .join(" ");
      candidate.pgn = candidate.branchPgn;
    });
  const filtered = built.filter((candidate) => includeExcluded || !candidate.excluded);

  const total = filtered.length;
  const start = Math.max(0, Math.trunc(Number(offset) || 0));
  const end = limit == null ? total : Math.min(total, start + Math.max(0, Number(limit)));
  const candidates = filtered.slice(start, end);
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

function pctOf(part, total) {
  return total > 0 ? Math.round((Number(part || 0) / total) * 1000) / 10 : null;
}

function peerResultsFromExplorer(move) {
  if (!move || !move.games) return null;
  return {
    white: pctOf(move.white, move.games),
    draw: pctOf(move.draw, move.games),
    black: pctOf(move.black, move.games),
    games: move.games,
    whiteWins: move.white,
    draws: move.draw,
    blackWins: move.black,
  };
}

function masterResultsFromExplorer(move, position) {
  if (!move || !position || !position.games) return null;
  return {
    white: pctOf(move.white, position.games),
    draw: pctOf(move.draw, position.games),
    black: pctOf(move.black, position.games),
    games: move.games,
    share: pctOf(move.games, position.games),
    whiteWins: move.white,
    draws: move.draw,
    blackWins: move.black,
  };
}

function buildMergedCandidate({
  db,
  base,
  spec,
  path,
  report,
  masters,
  peer,
  masterBase,
  capturedBandUsable,
  saved,
  excluded,
  openingForPath,
  fullNameForEpd,
  minIncidence,
  explorerBand,
}) {
  const captured = spec.captured;
  const key = spec.key || sanKey(spec.san);
  const legal = findLegalMove(base.fen, spec.san);
  if (!legal && !captured) return null;
  const san = legal?.san ?? spec.san;
  const sanKeyValue = key;
  const fenAfter = legal ? legal.after ?? null : null;
  const epdAfter = captured?.epd_after ?? (fenAfter ? epdOf(fenAfter) : null);
  const movePath = [...path, san];
  const opening = openingForPath(db, movePath);
  const fallback = epdAfter ? fullNameForEpd(db, epdAfter) : null;
  const capturedSupplementary = Boolean(
    fallback?.source && !String(fallback.source).startsWith("explorer-")
  );
  const candidateName = capturedSupplementary
    ? fallback?.name ?? opening?.name ?? null
    : opening?.name ?? fallback?.name ?? null;
  const annotation =
    captured?.annotation ??
    annotationForMove(db, base.epd, san)?.text ??
    null;

  const capturedMaster = captured && masterBase ? masterResults(captured, masterBase) : null;
  const explorerMaster = spec.em ? masterResultsFromExplorer(spec.em, masters) : null;
  const master = capturedMaster ?? explorerMaster;
  const capturedPeer = captured && capturedBandUsable ? peerResults(captured) : null;
  const explorerPeer = spec.ep ? peerResultsFromExplorer(spec.ep) : null;
  const peers = capturedPeer ?? explorerPeer;

  const peerShare = spec.ep && peer?.games ? spec.ep.games / peer.games : null;
  const masterShare = spec.em && masters?.games ? spec.em.games / masters.games : null;
  const capturedProbability =
    captured?.probability == null ? null : Number(captured.probability);
  const capturedIncidence =
    report?.reference_color &&
    report.reference_color !== base.side &&
    captured?.incidence != null
      ? Number(captured.incidence)
      : null;
  const useCapturedIncidence = capturedBandUsable && capturedIncidence != null;
  const probability =
    capturedBandUsable && capturedProbability != null
      ? capturedProbability
      : peerShare ?? masterShare ?? null;
  const incidence =
    (useCapturedIncidence ? capturedIncidence : null) ??
    peerShare ??
    masterShare ??
    (capturedBandUsable ? capturedProbability : null);
  const oneIn = incidence && incidence > 0 ? Math.max(1, Math.round(1 / incidence)) : null;
  const savedMove =
    saved.get(sanKeyValue) ||
    saved.get(sanKey(san)) ||
    null;
  const isExcluded =
    excluded.has(sanKeyValue) || excluded.has(sanKey(san));
  const evalCp =
    captured?.stockfish_eval == null ? null : Number(captured.stockfish_eval);
  const mate = captured?.stockfish_mate ?? null;

  return {
    rank: 0,
    san,
    sanKey: sanKeyValue,
    uci: legal ? `${legal.from}${legal.to}${legal.promotion ?? ""}` : null,
    epd: base.epd,
    epdAfter,
    fenAfter,
    name: candidateName,
    openingName: candidateName,
    eco: opening?.eco ?? fallback?.eco ?? null,
    openingId: opening?.id ?? null,
    friendlyName: fallback?.friendlyName ?? null,
    nameSource: capturedSupplementary
      ? fallback?.source ?? null
      : opening
        ? "lichess-eco"
        : fallback?.source ?? null,
    // Legacy builder field: Masters is the master-game share, not local
    // mastery (D036).
    mastery: master?.share ?? null,
    lineCount: savedMove ? 1 : 0,
    inRepertoire: Boolean(savedMove),
    annotation,
    description: annotation,
    masters: master?.share ?? null,
    masterResults: master,
    mastersAvailable: Boolean(master),
    peers: peers ? { white: peers.white, black: peers.black, draw: peers.draw } : null,
    peerResults: peers,
    peersAvailable: Boolean(peers),
    eval: evalCp,
    evalPawn: evalCp == null ? null : Math.round((evalCp / 100) * 100) / 100,
    mate,
    evalAvailable: evalCp != null || mate != null,
    evalSource: evalCp != null ? report?.source ?? null : null,
    probability,
    incidence,
    incidenceSource:
      useCapturedIncidence
        ? report?.source ?? "captured"
        : peerShare != null
          ? peer?.source ?? "lichess-band"
          : masterShare != null
            ? masters?.source ?? "pgnmentor-masters"
            : null,
    capturedIncidence,
    incidenceAvailable: incidence != null,
    bandMismatch: !capturedBandUsable && capturedIncidence != null && !peerShare,
    meetsCoverage: incidence != null ? incidence >= minIncidence : null,
    incidenceByBand: peer
      ? [
          {
            band: peer.band,
            probability: peerShare,
            incidence: peerShare,
            games: peer.games,
            source: peer.source,
            available: true,
          },
        ]
      : [],
    oneIn,
    incidenceLabel: oneIn ? `1 in ${oneIn} games` : null,
    realIncidenceAvailable: incidence != null,
    needed: !savedMove,
    saved: Boolean(savedMove),
    disabled: Boolean(savedMove?.disabled),
    excluded: isExcluded,
    playable: !isExcluded && !savedMove?.disabled,
    lineId: savedMove?.lineId ?? null,
    lineName: savedMove?.lineName ?? null,
    lineMoveId: savedMove?.lineMoveId ?? null,
    parentLineId: base.parentLineId ?? null,
    parentLineName: base.parentLineName ?? null,
    branchMoves: movePath,
    branchPgn: null,
    pgn: null,
    danger: captured?.danger ?? null,
    similarPositionCount: captured?.similar_position_count ?? null,
    similarPositionMatchCount: captured?.similar_position_match_count ?? null,
    games: peers?.games ?? spec.em?.games ?? spec.ep?.games ?? null,
    mastersGames: spec.em?.games ?? null,
    peerGames: spec.ep?.games ?? null,
    statsAvailable: Boolean(master || peers || evalCp != null || mate != null),
    source: captured
      ? report.source
      : spec.ep
        ? peer?.source ?? "lichess-band"
        : spec.em
          ? masters?.source ?? "pgnmentor-masters"
          : null,
    sourceDetail: {
      captured: captured ? report?.source ?? null : null,
      masters: spec.em ? masters?.source ?? "pgnmentor-masters" : null,
      lichess: spec.ep ? peer?.source ?? "lichess-band" : null,
      engine: evalCp != null ? report?.source ?? null : null,
    },
    explorerBand,
  };
}

/**
 * Fill candidate and position evals from Stockfish (never from a hash).
 *
 * Captured evals win. Every other candidate gets the real eval of the position
 * after the move, at a modest depth, cached in memory and SQLite. Called by
 * API endpoints that render candidates, not by the internal gap ranking walk.
 */
/**
 * Explorer-backed "next common moves" for /learn.
 *
 * `server/common.js` is captured-data only. This fills the positions the
 * capture never covered, using the offline Lichess band corpora and the same
 * saved-reply requirement. Captured entries are merged separately and win on
 * duplicates.
 */
export function explorerCommonQueue(
  db,
  repertoire,
  { coverageGoal = 50, limit = 40 } = {}
) {
  const settings = repertoire?.user_id ? readSettings(db, repertoire.user_id) : null;
  const band = lichessBandFor(settings ?? { singleElo: 1800 });
  const threshold = 1 / Math.max(1, Number(coverageGoal) || 50);
  const lines = db
    .prepare("SELECT * FROM lines WHERE repertoire_id = ? ORDER BY id")
    .all(repertoire.id);
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
    const path = [];
    for (let i = 0; i < sans.length; i += 1) {
      const beforeEpd = epdOf(chess.fen());
      const side = chess.turn() === "w" ? "white" : "black";
      const san = sans[i];
      if (side !== repertoire.color) {
        const incidence = explorerMoveShare(db, beforeEpd, san, { band });
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
                    source: "lichess-band",
                    referenceColor: null,
                    band,
                  },
                  lineId: line.id,
                  lineName: line.name,
                  source: "offline-explorer",
                });
              }
            }
          }
        }
      }
      try {
        chess.move(san);
        path.push(san);
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

export async function applyEngineEvals(
  db,
  detail,
  { depth = null, candidateDepth = null, maxCandidates = 40 } = {}
) {
  if (!detail) return detail;
  const engineDepth = Math.max(
    4,
    Math.min(24, Number(depth ?? process.env.CHESSBOOK_ENGINE_DEPTH) || 12)
  );
  const evalDepth = Math.max(
    4,
    Math.min(engineDepth, Number(candidateDepth ?? process.env.CHESSBOOK_CANDIDATE_DEPTH) || 10)
  );
  const engineAvailable = engineStatus().available;

  if (engineAvailable && !detail.stockfish?.available) {
    const positionEval = await evaluateCached(db, detail.fen, { depth: engineDepth });
    if (positionEval.available) {
      detail.stockfish = {
        eval: positionEval.evalCp,
        cp: positionEval.evalCp,
        mate: positionEval.mate,
        pawns: positionEval.evalPawns,
        available: true,
        depth: positionEval.depth,
        engine: positionEval.engine?.name ?? null,
        source: "stockfish",
        cached: Boolean(positionEval.cached),
      };
      if (detail.sources) detail.sources.engine = "stockfish";
    } else {
      detail.engineAvailable = false;
      detail.engineReason = positionEval.reason ?? "engine_unavailable";
    }
  }

  const candidates = (detail.candidates || []).slice(0, Math.max(0, maxCandidates));
  for (const candidate of candidates) {
    if (candidate.evalAvailable) continue;
    const fen = candidate.fenAfter || (() => {
      const move = findLegalMove(detail.fen, candidate.san);
      return move?.after ?? null;
    })();
    if (!fen) continue;
    if (!engineAvailable) {
      candidate.evalAvailable = false;
      candidate.evalReason = "engine_unavailable";
      continue;
    }
    const result = await evaluateCached(db, fen, { depth: evalDepth });
    if (!result.available) {
      candidate.evalAvailable = false;
      candidate.evalReason = result.reason ?? "engine_unavailable";
      continue;
    }
    candidate.eval = result.evalCp;
    candidate.evalCp = result.evalCp;
    candidate.evalPawn = result.evalPawns;
    candidate.evalAvailable = true;
    candidate.mate = result.mate;
    candidate.evalDepth = result.depth;
    candidate.evalEngine = result.engine?.name ?? null;
    candidate.evalSource = "stockfish";
    candidate.evalCached = Boolean(result.cached);
    if (candidate.sourceDetail) candidate.sourceDetail.engine = "stockfish";
  }
  detail.engineAvailable = engineAvailable;
  return detail;
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
