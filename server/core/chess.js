import { Chess } from "chess.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const START_EPD = epdOf(START_FEN);

/** EPD = the first four FEN fields. Positions are identified by EPD. */
export function epdOf(fen) {
  return String(fen || "").split(" ").slice(0, 4).join(" ");
}

export function fenOf(epd) {
  return `${epd} 0 1`;
}

export function turnOf(epdOrFen) {
  return String(epdOrFen).split(" ")[1] === "b" ? "black" : "white";
}

/** Compare SANs ignoring check marks and annotations. */
export function sanKey(san) {
  return String(san || "")
    .trim()
    .replace(/[!?]+$/g, "")
    .replace(/0-0-0/g, "O-O-O")
    .replace(/0-0/g, "O-O")
    .replace(/[+#]+$/g, "");
}

/**
 * Replay SANs from the start (or a FEN). Returns every position along the way.
 * Throws on an illegal move.
 */
export function replay(sans, fen = START_FEN) {
  const chess = new Chess(fen);
  const steps = [];
  for (const san of sans) {
    const before = chess.fen();
    const move = chess.move(san);
    steps.push({
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion || ""}`,
      from: move.from,
      to: move.to,
      fenBefore: before,
      epdBefore: epdOf(before),
      fenAfter: chess.fen(),
      epdAfter: epdOf(chess.fen()),
      side: move.color === "w" ? "white" : "black",
    });
  }
  return { steps, fen: chess.fen(), epd: epdOf(chess.fen()), chess };
}

/** Apply one move given as SAN or UCI. Returns null when illegal. */
export function applyMove(fen, move) {
  const chess = new Chess(fen);
  let result = null;
  try {
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) {
      result = chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] || undefined });
    } else {
      result = chess.move(move);
    }
  } catch {
    return null;
  }
  if (!result) return null;
  return {
    san: result.san,
    uci: `${result.from}${result.to}${result.promotion || ""}`,
    from: result.from,
    to: result.to,
    side: result.color === "w" ? "white" : "black",
    fen: chess.fen(),
    epd: epdOf(chess.fen()),
    captured: Boolean(result.captured),
    check: chess.isCheck(),
  };
}

export function legalSans(fen) {
  try {
    return new Chess(fen).moves();
  } catch {
    return [];
  }
}

/** "1. e4 c5 2. Nf3" style text for a SAN list starting at ply 0. */
export function movesText(sans, startPly = 0) {
  let out = "";
  sans.forEach((san, i) => {
    const ply = startPly + i;
    if (ply % 2 === 0) out += `${ply / 2 + 1}. `;
    else if (i === 0) out += `${Math.floor(ply / 2) + 1}… `;
    out += `${san} `;
  });
  return out.trim();
}

/** Label for a move at a ply: "3." for white, "3…" for black. */
export function moveLabel(ply, san) {
  const number = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${number}. ${san}` : `${number}… ${san}`;
}

export function parsePgnSans(text) {
  const clean = String(text || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/;[^\n]*/g, " ")
    .replace(/\$\d+/g, " ");
  let depth = 0;
  let body = "";
  for (const ch of clean) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) body += ch;
  }
  return body
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.(\.\.)?/, ""))
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
    .map((t) => t.replace(/[?!]+$/, ""));
}

/**
 * Split a PGN file into games, each with its main-line SANs and variations
 * flattened into separate lines (so a study with sidelines imports every line).
 */
export function pgnLines(text) {
  const games = String(text || "")
    .replace(/\r/g, "")
    .split(/\n\s*\n(?=\[)/)
    .filter((chunk) => chunk.trim());
  const lines = [];
  for (const game of games) {
    const headers = {};
    for (const m of game.matchAll(/\[(\w+)\s+"([^"]*)"\]/g)) headers[m[1]] = m[2];
    if (headers.FEN && headers.SetUp !== "0") continue;
    const body = game
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\{[^}]*\}/g, " ")
      .replace(/;[^\n]*/g, " ")
      .replace(/\$\d+/g, " ");
    for (const variation of expandVariations(body)) {
      if (variation.length) lines.push({ headers, sans: variation });
    }
  }
  return lines;
}

/** Turn "1. e4 e5 (1... c5 2. Nf3) 2. Nf3" into [[e4,e5,Nf3],[e4,c5,Nf3]]. */
function expandVariations(body) {
  const tokens = body.match(/\(|\)|[^\s()]+/g) || [];
  const results = [];
  let pos = 0;
  // Parse a sequence until ")" or the end; `prefix` is the line before it.
  const parse = (prefix) => {
    const line = [...prefix];
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t === ")") {
        pos += 1;
        break;
      }
      if (t === "(") {
        pos += 1;
        // A variation replaces the move just played.
        parse(line.slice(0, -1));
        continue;
      }
      pos += 1;
      const san = t.replace(/^\d+\.(\.\.)?/, "").replace(/[?!]+$/, "");
      if (san && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(san)) line.push(san);
    }
    results.push(line);
  };
  parse([]);
  // The main line is pushed last; put it first.
  return [results.pop(), ...results].filter((l) => l && l.length);
}
