import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import { epdOf } from "../positions.js";
import { seededRandom } from "../bot.js";
import {
  createDrill,
  db,
  finishDrill,
  getDrill,
  profileFor,
  recordProfileResult,
} from "./db.js";

export const visualizationRouter = Router();

const DIFFICULTIES = [
  { level: 1, hiddenMoves: 2, speedMs: 950, label: "Easy" },
  { level: 2, hiddenMoves: 3, speedMs: 800, label: "Steady" },
  { level: 3, hiddenMoves: 4, speedMs: 650, label: "Standard" },
  { level: 4, hiddenMoves: 5, speedMs: 500, label: "Hard" },
  { level: 5, hiddenMoves: 6, speedMs: 380, label: "Blindfold" },
];

function difficultyFor(level) {
  return DIFFICULTIES.find((entry) => entry.level === Number(level)) ?? DIFFICULTIES[2];
}

function modelGameSequences() {
  const rows = db
    .prepare(
      `SELECT m.game_id, m.ply, m.san, m.epd_before, m.epd_after,
              g.white, g.black, g.event, d.event_name
       FROM model_game_moves m
       JOIN model_games g ON g.id = m.game_id
       LEFT JOIN model_game_data d ON d.game_id = m.game_id
       ORDER BY m.game_id, m.ply`
    )
    .all();
  const byGame = new Map();
  for (const row of rows) {
    if (!byGame.has(row.game_id)) {
      byGame.set(row.game_id, {
        gameId: row.game_id,
        label: `${row.white}–${row.black}`,
        event: row.event_name || row.event,
        moves: [],
      });
    }
    byGame.get(row.game_id).moves.push({
      san: row.san,
      epdBefore: row.epd_before,
      epdAfter: row.epd_after,
    });
  }
  return [...byGame.values()].filter((game) => game.moves.length >= 12);
}

function repertoireSequences() {
  const rows = db
    .prepare(
      `SELECT l.id AS line_id, l.name, l.moves, r.name AS repertoire_name
       FROM lines l JOIN repertoires r ON r.id = l.repertoire_id
       WHERE l.saved = 1 AND LENGTH(l.moves) > 0
       ORDER BY l.id`
    )
    .all();
  return rows
    .map((row) => ({
      lineId: row.line_id,
      label: row.name,
      event: row.repertoire_name,
      sans: String(row.moves || "").split(/\s+/).filter(Boolean),
    }))
    .filter((entry) => entry.sans.length >= 6);
}

function replay(startFen, sans) {
  const chess = new Chess(startFen);
  const frames = [];
  for (const san of sans) {
    const before = chess.fen();
    let move;
    try {
      move = chess.move(san);
    } catch {
      break;
    }
    frames.push({
      san: move.san,
      from: move.from,
      to: move.to,
      fenBefore: before,
      fenAfter: chess.fen(),
      epdAfter: epdOf(chess.fen()),
    });
  }
  return frames;
}

/**
 * Build a hidden-move sequence from a real game. The client receives FENs to
 * animate, not the SANs, so the reconstruction is a memory task rather than a
 * move-list reading task.
 */
function buildSequence(level, mode, seed) {
  const rng = seededRandom(seed);
  const games = modelGameSequences();
  const lines = repertoireSequences();
  const useModel = games.length > 0 && (lines.length === 0 || rng() < 0.65);
  const source = useModel
    ? games[Math.floor(rng() * games.length)]
    : lines[Math.floor(rng() * lines.length)];
  const difficulty = difficultyFor(level);
  let sans;
  let startFen;
  let sourceLabel;
  let sourceDetail;
  if (useModel) {
    const total = source.moves.length;
    const hiddenMoves = Math.min(difficulty.hiddenMoves, Math.max(2, total - 2));
    const startPly = Math.floor(rng() * Math.max(1, total - hiddenMoves));
    startFen = startPly === 0 ? new Chess().fen() : `${source.moves[startPly - 1].epdAfter} 0 1`;
    sans = source.moves.slice(startPly, startPly + hiddenMoves).map((move) => move.san);
    sourceLabel = `${source.label} · ${source.event || "captured model game"}`;
    sourceDetail = `Captured model game, starting at ply ${startPly + 1}.`;
    const frames = replay(startFen, sans);
    return {
      startFen,
      hiddenMoves: frames.length,
      speedMs: difficulty.speedMs,
      frames,
      sourceLabel,
      sourceDetail,
      sourceType: "model-game",
      startPly,
    };
  }
  const total = source.sans.length;
  const hiddenMoves = Math.min(difficulty.hiddenMoves, Math.max(2, total - 1));
  const startPly = Math.floor(rng() * Math.max(1, total - hiddenMoves));
  let prefix = [];
  if (startPly > 0) {
    prefix = replay(new Chess().fen(), source.sans.slice(0, startPly));
  }
  startFen = startPly === 0 ? new Chess().fen() : prefix[prefix.length - 1]?.fenAfter ?? new Chess().fen();
  sans = source.sans.slice(startPly, startPly + hiddenMoves);
  const frames = replay(startFen, sans);
  return {
    startFen,
    hiddenMoves: frames.length,
    speedMs: difficulty.speedMs,
    frames,
    sourceLabel: `${source.label} · ${source.event}`,
    sourceDetail: `Saved repertoire line, starting at ply ${startPly + 1}.`,
    sourceType: "repertoire-line",
    startPly,
  };
}

function pieceName(type) {
  return (
    {
      p: "Pawn",
      n: "Knight",
      b: "Bishop",
      r: "Rook",
      q: "Queen",
      k: "King",
    }[type] || "Piece"
  );
}

function kingSquare(chess, color) {
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece && piece.type === "k" && piece.color === color) return piece.square;
    }
  }
  return null;
}

function countPawns(chess, color) {
  let count = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece && piece.type === "p" && piece.color === color) count += 1;
    }
  }
  return count;
}

function shuffled(list, rng) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeQuestions(finalFen, rng) {
  const chess = new Chess(finalFen);
  const questions = [];
  const allSquares = [];
  for (const file of "abcdefgh") {
    for (let rank = 1; rank <= 8; rank += 1) allSquares.push(`${file}${rank}`);
  }

  const whiteKing = kingSquare(chess, "w");
  if (whiteKing) {
    const options = shuffled(
      [whiteKing, ...shuffled(allSquares.filter((square) => square !== whiteKing), rng).slice(0, 3)],
      rng
    );
    questions.push({
      prompt: "Which square is the white king on?",
      options,
      answer: options.indexOf(whiteKing),
    });
  }

  const blackPawns = countPawns(chess, "b");
  const pawnOptions = shuffled(
    [...new Set([blackPawns, Math.max(0, blackPawns - 1), blackPawns + 1, Math.max(0, blackPawns + 2)])],
    rng
  ).map(String);
  questions.push({
    prompt: "How many black pawns are on the board?",
    options: pawnOptions,
    answer: pawnOptions.indexOf(String(blackPawns)),
  });

  const occupied = [];
  for (const row of chess.board()) {
    for (const piece of row) if (piece) occupied.push(piece);
  }
  if (occupied.length) {
    const target = occupied[Math.floor(rng() * occupied.length)];
    const options = shuffled(
      ["Pawn", "Knight", "Bishop", "Rook", "Queen", "King", "Empty"],
      rng
    );
    questions.push({
      prompt: `Which piece is on ${target.square}?`,
      options,
      answer: options.indexOf(pieceName(target.type)),
    });
  }
  return questions.slice(0, 3).map((question) => ({
    prompt: question.prompt,
    options: question.options,
    answer: question.answer,
  }));
}

visualizationRouter.get("/", (req, res) => {
  const profile = profileFor(req.user.id, "visualization");
  const games = modelGameSequences();
  const lines = repertoireSequences();
  res.json({
    profile,
    difficulties: DIFFICULTIES,
    modes: [
      { id: "reconstruct", label: "Reconstruct the moves", detail: "Watch, then replay the hidden moves from memory." },
      { id: "questions", label: "Answer position questions", detail: "Watch, then answer questions about the final position." },
    ],
    sources: {
      modelGames: games.length,
      repertoireLines: lines.length,
      available: games.length + lines.length > 0,
    },
    lastResult: profile.data?.lastResult ?? null,
  });
});

visualizationRouter.post("/session", (req, res) => {
  const body = req.body || {};
  const mode = body.mode === "questions" ? "questions" : "reconstruct";
  const difficulty = difficultyFor(body.difficulty);
  const sessionId = randomUUID();
  const seed = `${req.user.id}|${sessionId}|${difficulty.level}|${mode}`;
  const built = buildSequence(difficulty.level, mode, seed);
  if (!built.frames.length) {
    return res.status(409).json({
      error: "No captured games or saved lines are available for visualization",
      code: "no_visualization_source",
    });
  }
  const rng = seededRandom(`${seed}|questions`);
  const finalFen = built.frames[built.frames.length - 1].fenAfter;
  const questions = mode === "questions" ? makeQuestions(finalFen, rng) : [];
  const payload = {
    mode,
    difficulty: difficulty.level,
    speedMs: built.speedMs,
    startFen: built.startFen,
    frames: built.frames,
    questions,
    source: {
      type: built.sourceType,
      label: built.sourceLabel,
      detail: built.sourceDetail,
    },
  };
  createDrill({
    id: sessionId,
    userId: req.user.id,
    feature: "visualization",
    kind: mode,
    payload,
  });
  res.status(201).json({
    session: {
      id: sessionId,
      mode,
      difficulty: difficulty.level,
      difficultyLabel: difficulty.label,
      hiddenMoves: built.frames.length,
      speedMs: built.speedMs,
      startFen: built.startFen,
      source: payload.source,
      playback: built.frames.map((frame, index) => ({
        index,
        fen: frame.fenAfter,
        from: frame.from,
        to: frame.to,
      })),
      questions: questions.map(({ prompt, options }) => ({ prompt, options })),
      instructions:
        mode === "questions"
          ? "Watch the moves, then answer the questions about the final position."
          : "Watch the moves, then replay them on the board from the start position.",
    },
    profile: profileFor(req.user.id, "visualization"),
  });
});

visualizationRouter.post("/answer", (req, res) => {
  const body = req.body || {};
  const sessionId = String(body.sessionId || body.id || "");
  const drill = getDrill(sessionId, req.user.id, "visualization");
  if (!drill) return res.status(404).json({ error: "Visualization session not found" });
  if (drill.status !== "open") {
    return res.json({
      idempotent: true,
      result: drill.result,
      profile: profileFor(req.user.id, "visualization"),
    });
  }
  const { payload } = drill;
  const mode = payload.mode;
  let result;
  if (mode === "questions") {
    const submitted = Array.isArray(body.answers) ? body.answers.map((value) => Number(value)) : [];
    const questions = payload.questions || [];
    const graded = questions.map((question, index) => {
      const submittedIndex = submitted[index];
      return {
        prompt: question.prompt,
        options: question.options,
        answer: question.answer,
        submitted: Number.isInteger(submittedIndex) ? submittedIndex : null,
        correct: submittedIndex === question.answer,
      };
    });
    const correct = graded.filter((question) => question.correct).length;
    const score = questions.length ? Math.round((correct / questions.length) * 100) : 0;
    result = {
      mode,
      correct,
      total: questions.length,
      score,
      questions: graded,
      engine: "captured game positions",
    };
  } else {
    const submitted = Array.isArray(body.moves)
      ? body.moves.map((move) => String(move || "").trim()).filter(Boolean)
      : [];
    const expected = payload.frames.map((frame) => frame.san);
    const graded = expected.map((san, index) => {
      const played = submitted[index] ?? null;
      const correct = played != null && normalize(played) === normalize(san);
      return { index, expected: san, played, correct };
    });
    const prefix = graded.findIndex((entry) => !entry.correct);
    const correctCount = prefix === -1 ? graded.length : prefix;
    const score = graded.length ? Math.round((correctCount / graded.length) * 100) : 0;
    result = {
      mode,
      correct: correctCount,
      total: graded.length,
      score,
      prefix: correctCount,
      moves: graded,
      expected,
      played: submitted,
      engine: "captured game positions",
    };
  }
  const profile = recordProfileResult(req.user.id, "visualization", {
    score: (result.score || 0) / 100,
    opponentRating: 900 + Number(payload.difficulty) * 160,
    k: 22,
    gamesDelta: 1,
    perfect: result.score === 100,
    data: {
      lastResult: {
        ...result,
        difficulty: payload.difficulty,
        mode,
        source: payload.source,
        at: new Date().toISOString(),
      },
    },
    attempt: {
      itemKey: `${payload.source?.type || "game"}:${payload.startFen.slice(0, 24)}`,
      detail: { mode, score: result.score, difficulty: payload.difficulty },
    },
  });
  finishDrill(drill.id, req.user.id, result);
  res.json({ result, profile });
});

function normalize(value) {
  return String(value || "")
    .replace(/[!?]+$/g, "")
    .replace(/0/g, "O")
    .replace(/[+#]+$/g, "")
    .trim();
}

