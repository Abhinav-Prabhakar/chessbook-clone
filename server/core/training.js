/**
 * Training games against a bot that plays like people at a given rating.
 *
 *  - In the opening it samples real moves played by Lichess players in that
 *    rating band (so you meet the lines you will actually face).
 *  - After that it asks Stockfish for several candidate moves and picks one,
 *    making more and bigger mistakes the lower its rating.
 */
import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import { db, nowIso } from "./db.js";
import { analyse } from "../engine.js";
import { epdOf, START_FEN, turnOf } from "./chess.js";
import { peers } from "./explorer.js";
import { bandFor } from "./settings.js";
import { graphOf, getRepertoire, httpError } from "./repertoire.js";

export const BOT_RATINGS = [800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

function load(id) {
  const row = db.prepare("SELECT * FROM training_games WHERE id = ?").get(String(id));
  if (!row) throw httpError(404, "Game not found");
  return row;
}

function chessFor(row) {
  const chess = new Chess(row.start_fen);
  for (const san of row.sans.split(" ").filter(Boolean)) chess.move(san);
  return chess;
}

function statusOf(chess) {
  if (chess.isCheckmate()) {
    return { status: "over", result: chess.turn() === "w" ? "0-1" : "1-0", reason: "checkmate" };
  }
  if (chess.isStalemate()) return { status: "over", result: "1/2-1/2", reason: "stalemate" };
  if (chess.isThreefoldRepetition()) return { status: "over", result: "1/2-1/2", reason: "repetition" };
  if (chess.isInsufficientMaterial()) return { status: "over", result: "1/2-1/2", reason: "insufficient material" };
  if (chess.isDraw()) return { status: "over", result: "1/2-1/2", reason: "50-move rule" };
  return { status: "playing", result: null, reason: null };
}

/** Where the game left your saved moves (first move not in your repertoire). */
function bookStatus(row, chess) {
  if (!row.repertoire_id) return null;
  let repertoire;
  try {
    repertoire = getRepertoire(row.repertoire_id);
  } catch {
    return null;
  }
  const graph = graphOf(repertoire.id);
  const replay = new Chess(row.start_fen);
  const sans = row.sans.split(" ").filter(Boolean);
  for (let i = 0; i < sans.length; i += 1) {
    const epd = epdOf(replay.fen());
    const saved = graph.get(epd) || [];
    const yours = turnOf(replay.fen()) === repertoire.color;
    const played = replay.move(sans[i]);
    if (!saved.some((m) => m.san === played.san)) {
      const mineSaved = saved.filter((m) => m.mine === 1).map((m) => m.san);
      return {
        ply: i,
        san: played.san,
        yours,
        expected: yours ? mineSaved : [],
        unprepared: !yours && saved.length === 0 ? true : !yours,
      };
    }
  }
  void chess;
  return { ply: sans.length, inBook: true };
}

export function view(row) {
  const chess = chessFor(row);
  const sans = row.sans.split(" ").filter(Boolean);
  const history = chess.history({ verbose: true });
  const last = history[history.length - 1];
  return {
    id: row.id,
    color: row.color,
    botRating: row.bot_rating,
    startFen: row.start_fen,
    fen: chess.fen(),
    sans,
    lastMove: last ? { from: last.from, to: last.to } : null,
    status: row.status,
    result: row.result,
    reason: row.reason,
    turn: chess.turn() === "w" ? "white" : "black",
    repertoireId: row.repertoire_id,
    book: bookStatus(row, chess),
    review: row.review ? JSON.parse(row.review) : null,
    createdAt: row.created_at,
  };
}

function save(row, chess, extra = {}) {
  const sans = chess.history();
  const base = new Chess(row.start_fen);
  void base;
  const outcome = statusOf(chess);
  const next = {
    ...row,
    sans: sans.join(" "),
    status: extra.status || outcome.status,
    result: extra.result ?? outcome.result,
    reason: extra.reason ?? outcome.reason,
  };
  db.prepare(
    "UPDATE training_games SET sans = ?, status = ?, result = ?, reason = ?, updated_at = ? WHERE id = ?"
  ).run(next.sans, next.status, next.result, next.reason, nowIso(), row.id);
  return next;
}

/** Pick the bot's move. */
export async function botMove(fen, rating, plyIndex) {
  const chess = new Chess(fen);
  const epd = epdOf(fen);
  // Opening: play like a human at this rating.
  if (plyIndex < 24) {
    const stats = peers(epd, bandFor(rating));
    if (stats && stats.games >= 30) {
      const options = stats.moves.filter((m) => m.games >= 3);
      const total = options.reduce((sum, m) => sum + m.games, 0);
      let roll = Math.random() * total;
      for (const option of options) {
        roll -= option.games;
        if (roll <= 0) {
          try {
            return { san: chess.move(option.san).san, source: "players" };
          } catch {
            break;
          }
        }
      }
    }
  }
  const depth = rating < 1200 ? 6 : rating < 1600 ? 8 : rating < 2000 ? 11 : 14;
  const analysis = await analyse(fen, { depth, multipv: 5 });
  if (!analysis.available || !analysis.lines.length) {
    const moves = chess.moves();
    return { san: moves[Math.floor(Math.random() * moves.length)], source: "random" };
  }
  // Softmax over evaluations; temperature shrinks as rating grows.
  const temperature = Math.max(8, (2600 - rating) / 9); // centipawns
  // Scores come from White's point of view; flip them for Black.
  const sign = chess.turn() === "w" ? 1 : -1;
  const value = (line) => {
    if (line.mate != null) {
      const m = line.mate * sign;
      return m > 0 ? 3000 - m : -3000 - m;
    }
    return (line.cp ?? 0) * sign;
  };
  const best = Math.max(...analysis.lines.map(value));
  const weights = analysis.lines.map((line) => Math.exp((value(line) - best) / temperature));
  const sum = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * sum;
  for (const [i, line] of analysis.lines.entries()) {
    roll -= weights[i];
    if (roll <= 0) return { san: line.san, source: "engine" };
  }
  return { san: analysis.lines[0].san, source: "engine" };
}

export async function startGame({ color = "white", botRating = 1500, path = [], repertoireId = null }) {
  if (!["white", "black"].includes(color)) throw httpError(400, "Pick white or black");
  const rating = BOT_RATINGS.reduce((a, b) => (Math.abs(b - botRating) < Math.abs(a - botRating) ? b : a));
  const chess = new Chess(START_FEN);
  try {
    for (const san of path || []) chess.move(san);
  } catch {
    throw httpError(400, "That starting line is not legal");
  }
  const id = randomUUID();
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO training_games (id, color, bot_rating, start_fen, sans, repertoire_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, color, rating, START_FEN, chess.history().join(" "), repertoireId ? Number(repertoireId) : null, stamp, stamp);
  let row = load(id);
  // Bot moves first when it is its turn.
  if ((chess.turn() === "w" ? "white" : "black") !== color) {
    const reply = await botMove(chess.fen(), rating, chess.history().length);
    chess.move(reply.san);
    row = save(row, chess);
  }
  return view(load(id));
}

export async function playMove(id, { san, uci }) {
  const row = load(id);
  if (row.status !== "playing") throw httpError(409, "This game is over");
  const chess = chessFor(row);
  if ((chess.turn() === "w" ? "white" : "black") !== row.color) throw httpError(409, "Not your turn");
  let move;
  try {
    move = uci
      ? chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" })
      : chess.move(san);
  } catch {
    throw httpError(400, "Illegal move");
  }
  void move;
  let next = save(row, chess);
  let reply = null;
  if (next.status === "playing") {
    reply = await botMove(chess.fen(), row.bot_rating, chess.history().length);
    chess.move(reply.san);
    next = save(next, chess);
  }
  return { ...view(load(id)), reply };
}

export function resign(id) {
  const row = load(id);
  if (row.status !== "playing") return view(row);
  const chess = chessFor(row);
  save(row, chess, { status: "over", result: row.color === "white" ? "0-1" : "1-0", reason: "resignation" });
  return view(load(id));
}

export function listGames(limit = 30) {
  return db
    .prepare("SELECT * FROM training_games ORDER BY created_at DESC LIMIT ?")
    .all(limit)
    .map((row) => {
      const v = view(row);
      return { id: v.id, color: v.color, botRating: v.botRating, result: v.result, reason: v.reason, status: v.status, moves: v.sans.length, createdAt: v.createdAt };
    });
}

export function getGame(id) {
  return view(load(id));
}
