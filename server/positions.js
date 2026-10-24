import { Chess } from "chess.js";

export const START_FEN = new Chess().fen();

/** EPD = the first four FEN fields (board, side, castling, en passant). */
export function epdOf(fen) {
  return String(fen || "").split(" ").slice(0, 4).join(" ");
}

export function fenFromEpd(epd) {
  const parts = String(epd || "").trim().split(/\s+/);
  return parts.length === 4 ? `${parts.join(" ")} 0 1` : null;
}

export function isEpdLike(value) {
  const parts = String(value || "").trim().split(/\s+/);
  return parts.length === 4 && parts[0].includes("/") && ["w", "b"].includes(parts[1]);
}

/** Compare SANs by move identity, ignoring check/mate/annotation suffixes. */
export function sanKey(san) {
  return String(san || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[!?]+$/g, "")
    .replace(/0/g, "O")
    .replace(/[+#]+$/g, "");
}

export function normalizeSan(san) {
  return String(san || "").trim();
}

export function uciOf(move) {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

export function lineSans(line) {
  if (!line) return [];
  const raw = Array.isArray(line.moves) ? line.moves.join(" ") : String(line.moves || "");
  return raw.split(/\s+/).filter(Boolean);
}

export function pgnFromSans(sans) {
  const chess = new Chess();
  let out = "";
  sans.forEach((san, i) => {
    if (i % 2 === 0) out += `${i / 2 + 1}. `;
    chess.move(san);
    out += `${san} `;
  });
  return out.trim();
}

/**
 * Replay a line and describe every position/move.
 *
 * Each entry is the unit the trainer stores and quizzes: EPD of the position
 * *before* the move, the SAN, the ply, the side that owns the move, and the
 * full FEN (for the board). `isUser` is true when the move belongs to the
 * repertoire colour; those are the moves the user must recall.
 */
export function deriveLineMoves(sans, color) {
  const chess = new Chess();
  const out = [];
  for (let i = 0; i < sans.length; i += 1) {
    const before = chess.fen();
    const move = chess.move(sans[i]);
    const side = move.color === "w" ? "white" : "black";
    out.push({
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      san: move.san,
      uci: uciOf(move),
      fen: before,
      epd: epdOf(before),
      side,
      isUser: side === color,
      from: move.from,
      to: move.to,
      promotion: move.promotion || null,
      after: move.after,
    });
  }
  return out;
}

/** Verbose moves, including from/to, for a prefix of the line. */
export function prefixFor(sans, ply) {
  const chess = new Chess();
  const moves = [];
  const target = Math.max(0, Math.trunc(Number(ply) || 0));
  for (let i = 0; i < target - 1 && i < sans.length; i += 1) {
    const before = chess.fen();
    const move = chess.move(sans[i]);
    moves.push({
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      san: move.san,
      uci: uciOf(move),
      from: move.from,
      to: move.to,
      fen: before,
      after: move.after,
      epd: epdOf(before),
      side: move.color === "w" ? "white" : "black",
    });
  }
  return { moves, fen: chess.fen(), epd: epdOf(chess.fen()) };
}

export function positionAfter(sans) {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return { fen: chess.fen(), epd: epdOf(chess.fen()) };
}

/**
 * Find a legal move from the position itself. The client's SAN is only used
 * to *identify* a move; legality always comes from chess.js (audit D021).
 */
export function findLegalMove(fen, san) {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  const wanted = sanKey(san);
  const raw = String(san || "").trim().toLowerCase().replace(/\s+/g, "");

  const bySan = moves.find((m) => sanKey(m.san) === wanted);
  if (bySan) return bySan;

  const byLan = moves.find((m) => String(m.lan || "").toLowerCase() === raw);
  if (byLan) return byLan;

  // Accept a from/to pair such as "e2e4" even when the promotion suffix differs.
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(raw)) {
    const byUci = moves.find((m) => uciOf(m).toLowerCase() === raw);
    if (byUci) return byUci;
  }
  return null;
}

export function legalSans(fen) {
  try {
    return new Chess(fen).moves();
  } catch {
    return [];
  }
}

export function validateSans(sans) {
  const chess = new Chess();
  for (let i = 0; i < sans.length; i += 1) {
    try {
      chess.move(sans[i]);
    } catch {
      return { ok: false, ply: i + 1, san: sans[i], message: `Illegal move ${sans[i]} at ply ${i + 1}` };
    }
  }
  return { ok: true };
}

/**
 * Full data-integrity check for one stored line (audit D221):
 * legal PGN, PGN history matches `moves`, `fen` is the position before the
 * last move, `expected_san` is that move, and `side` matches the mover.
 */
export function validateLine(line, color) {
  const errors = [];
  const sans = lineSans(line);

  if (!sans.length) {
    errors.push({ code: "line_empty", message: "Line has no moves" });
    return errors;
  }

  const legality = validateSans(sans);
  if (!legality.ok) {
    errors.push({ code: "illegal_move", message: legality.message });
    return errors;
  }

  if (line.pgn) {
    try {
      const pgnChess = new Chess();
      pgnChess.loadPgn(String(line.pgn));
      const history = pgnChess.history();
      if (history.length !== sans.length || history.some((san, i) => sanKey(san) !== sanKey(sans[i]))) {
        errors.push({
          code: "pgn_mismatch",
          message: `PGN has ${history.length} moves but the line stores ${sans.length}`,
        });
      }
    } catch {
      errors.push({ code: "pgn_invalid", message: "PGN could not be parsed" });
    }
  }

  const before = prefixFor(sans, sans.length);
  if (line.fen && line.fen !== before.fen) {
    errors.push({
      code: "fen_mismatch",
      message: `Stored FEN does not match the position before the last move`,
    });
  }

  const last = sans[sans.length - 1];
  if (line.expected_san && sanKey(line.expected_san) !== sanKey(last)) {
    errors.push({
      code: "expected_san_mismatch",
      message: `expected_san ${line.expected_san} is not the last move ${last}`,
    });
  }

  const lastSide = sans.length % 2 === 1 ? "white" : "black";
  if (line.side && line.side !== lastSide) {
    errors.push({
      code: "side_mismatch",
      message: `Line ends with a ${lastSide} move but is stored as ${line.side}`,
    });
  }
  if (color && line.side !== color) {
    errors.push({
      code: "repertoire_color_mismatch",
      message: `Line side ${line.side} does not match repertoire colour ${color}`,
    });
  }

  return errors;
}
