import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import { fenFromEpd } from "../positions.js";
import { seededRandom } from "../bot.js";
import {
  clamp,
  createDrill,
  db,
  finishDrill,
  getDrill,
  profileFor,
  recordProfileResult,
} from "./db.js";

export const visionRouter = Router();

export const VISION_KINDS = [
  {
    id: "hanging",
    label: "Hanging pieces",
    prompt: "Select every piece of the side to move that is attacked and undefended.",
  },
  {
    id: "undefended",
    label: "Undefended pieces",
    prompt: "Select every piece of the side to move that has no defender.",
  },
  {
    id: "pawns",
    label: "Undefended pawns",
    prompt: "Select every pawn of the side to move that has no defender.",
  },
  {
    id: "checks",
    label: "Checks",
    prompt: "Select every piece that can give check right now.",
  },
  {
    id: "king-safety",
    label: "King zone",
    prompt: "Select every square around the king that an enemy piece attacks.",
  },
];

function opposite(color) {
  return color === "w" ? "b" : "w";
}

function defenders(chess, square, color) {
  return chess.attackers(square, color).length;
}

function attackers(chess, square, color) {
  return chess.attackers(square, color).length;
}

function answersFor(fen, kind) {
  const chess = new Chess(fen);
  const target = chess.turn();
  const enemy = opposite(target);
  const board = chess.board();
  const squares = [];
  if (kind === "checks") {
    const checkingFrom = new Set();
    for (const move of chess.moves({ verbose: true })) {
      try {
        chess.move({ from: move.from, to: move.to, promotion: move.promotion });
        if (chess.inCheck()) checkingFrom.add(move.from);
        chess.undo();
      } catch {
        // Ignore positions chess.js cannot replay.
      }
    }
    return {
      targetColor: target === "w" ? "white" : "black",
      squares: [...checkingFrom].sort(),
      prompt: "Select every piece that can give check right now.",
    };
  }
  if (kind === "king-safety") {
    const king = board
      .flat()
      .find((piece) => piece && piece.type === "k" && piece.color === target);
    if (!king) return { targetColor: target === "w" ? "white" : "black", squares: [], prompt: "" };
    const file = "abcdefgh".indexOf(king.square[0]);
    const rank = Number(king.square[1]);
    const zone = [];
    for (let df = -1; df <= 1; df += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        if (df === 0 && dr === 0) continue;
        const f = file + df;
        const r = rank + dr;
        if (f < 0 || f > 7 || r < 1 || r > 8) continue;
        const square = `${"abcdefgh"[f]}${r}`;
        if (attackers(chess, square, enemy) > 0) zone.push(square);
      }
    }
    return {
      targetColor: target === "w" ? "white" : "black",
      squares: zone.sort(),
      prompt: "Select every square around your king that an enemy piece attacks.",
    };
  }
  for (const row of board) {
    for (const piece of row) {
      if (!piece || piece.type === "k") continue;
      if (kind === "pawns" && piece.type !== "p") continue;
      const defended = defenders(chess, piece.square, target) > 0;
      const attacked = attackers(chess, piece.square, enemy) > 0;
      if (kind === "hanging" && attacked && !defended) squares.push(piece.square);
      else if (kind === "undefended" && !defended) squares.push(piece.square);
      else if (kind === "pawns" && !defended) squares.push(piece.square);
    }
  }
  return {
    targetColor: target === "w" ? "white" : "black",
    squares: squares.sort(),
    prompt: VISION_KINDS.find((entry) => entry.id === kind)?.prompt ?? "Select the target squares.",
  };
}

function candidatePositions() {
  const seen = new Set();
  const positions = [];
  const model = db
    .prepare(
      `SELECT m.game_id, m.ply, m.epd_before, g.white, g.black
       FROM model_game_moves m JOIN model_games g ON g.id = m.game_id
       WHERE m.epd_before IS NOT NULL ORDER BY m.game_id, m.ply`
    )
    .all();
  for (const row of model) {
    const fen = fenFromEpd(row.epd_before);
    if (!fen || seen.has(fen)) continue;
    seen.add(fen);
    positions.push({
      fen,
      source: "model-game",
      label: `${row.white}–${row.black}, ply ${row.ply}`,
      detail: "Captured model-game position.",
    });
  }
  const lines = db
    .prepare(
      `SELECT l.id, l.name, l.fen, r.name AS repertoire_name
       FROM lines l JOIN repertoires r ON r.id = l.repertoire_id
       WHERE l.saved = 1 ORDER BY l.id`
    )
    .all();
  for (const row of lines) {
    if (!row.fen || seen.has(row.fen)) continue;
    seen.add(row.fen);
    positions.push({
      fen: row.fen,
      source: "repertoire-position",
      label: `${row.repertoire_name} · ${row.name}`,
      detail: "Saved repertoire position.",
    });
  }
  return positions;
}

function buildDrill(kind, difficulty, seed) {
  const rng = seededRandom(seed);
  const positions = candidatePositions();
  if (!positions.length) return null;
  const shuffled = [...positions];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const valid = [];
  for (const position of shuffled) {
    let answers;
    try {
      answers = answersFor(position.fen, kind);
    } catch {
      continue;
    }
    if (!answers.squares.length) continue;
    valid.push({ ...position, ...answers });
    if (valid.length >= 40) break;
  }
  if (!valid.length) return null;
  const maxAnswers = Math.max(1, 1 + Number(difficulty));
  const preferred = valid.filter((entry) => entry.squares.length <= maxAnswers);
  const pool = preferred.length ? preferred : valid;
  return { ...pool[Math.floor(rng() * pool.length)], rng };
}

visionRouter.get("/", (req, res) => {
  const profile = profileFor(req.user.id, "vision");
  const positions = candidatePositions();
  res.json({
    kinds: VISION_KINDS,
    profile,
    sources: {
      positions: positions.length,
      modelGames: positions.filter((entry) => entry.source === "model-game").length,
      repertoirePositions: positions.filter((entry) => entry.source === "repertoire-position").length,
      available: positions.length > 0,
    },
    lastResult: profile.data?.lastResult ?? null,
    note: "Drills are generated from real captured model-game positions and saved repertoire positions. Answers are computed from the board, not stored by hand.",
  });
});

visionRouter.post("/session", (req, res) => {
  const body = req.body || {};
  const kind = VISION_KINDS.some((entry) => entry.id === body.kind) ? body.kind : "hanging";
  const difficulty = clamp(Number(body.difficulty) || 2, 1, 5);
  const sessionId = randomUUID();
  const seed = `${req.user.id}|${sessionId}|${kind}|${difficulty}`;
  const built = buildDrill(kind, difficulty, seed);
  if (!built) {
    return res.status(409).json({
      error: `No real position with a "${kind}" answer is available`,
      code: "no_visible_targets",
      kind,
    });
  }
  const payload = {
    kind,
    difficulty,
    fen: built.fen,
    source: { type: built.source, label: built.label, detail: built.detail },
    answer: built.squares,
    prompt: built.prompt,
    targetColor: built.targetColor,
  };
  createDrill({
    id: sessionId,
    userId: req.user.id,
    feature: "vision",
    kind,
    payload,
  });
  res.status(201).json({
    session: {
      id: sessionId,
      kind,
      difficulty,
      fen: built.fen,
      prompt: built.prompt,
      targetColor: built.targetColor,
      count: built.squares.length,
      source: payload.source,
      instructions: "Click every square that answers the prompt, then submit.",
    },
    profile: profileFor(req.user.id, "vision"),
  });
});

visionRouter.post("/answer", (req, res) => {
  const body = req.body || {};
  const sessionId = String(body.sessionId || body.id || "");
  const drill = getDrill(sessionId, req.user.id, "vision");
  if (!drill) return res.status(404).json({ error: "Vision drill not found" });
  if (drill.status !== "open") {
    return res.json({
      idempotent: true,
      result: drill.result,
      profile: profileFor(req.user.id, "vision"),
    });
  }
  const answer = new Set(drill.payload.answer || []);
  const selected = new Set(
    (Array.isArray(body.squares) ? body.squares : []).map((square) => String(square))
  );
  const correctSquares = [...selected].filter((square) => answer.has(square)).sort();
  const wrongSquares = [...selected].filter((square) => !answer.has(square)).sort();
  const missedSquares = [...answer].filter((square) => !selected.has(square)).sort();
  const exact = wrongSquares.length === 0 && missedSquares.length === 0;
  const denominator = correctSquares.length * 2 + wrongSquares.length + missedSquares.length;
  const score = exact ? 100 : denominator === 0 ? 0 : Math.round((correctSquares.length * 2 * 100) / denominator);
  const result = {
    kind: drill.payload.kind,
    difficulty: drill.payload.difficulty,
    exact,
    score,
    answer: [...answer].sort(),
    selected: [...selected].sort(),
    correctSquares,
    wrongSquares,
    missedSquares,
    targetColor: drill.payload.targetColor,
    source: drill.payload.source,
  };
  const profile = recordProfileResult(req.user.id, "vision", {
    score: score / 100,
    opponentRating: 900 + Number(drill.payload.difficulty) * 160,
    k: 22,
    gamesDelta: 1,
    perfect: exact,
    data: {
      lastResult: {
        ...result,
        at: new Date().toISOString(),
      },
    },
    attempt: {
      itemKey: `${drill.payload.kind}:${drill.payload.fen.slice(0, 24)}`,
      detail: { kind: drill.payload.kind, exact, score, difficulty: drill.payload.difficulty },
    },
  });
  finishDrill(drill.id, req.user.id, result);
  res.json({ result, profile });
});
