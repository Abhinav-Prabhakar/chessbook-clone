import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import { scoreCandidate } from "../opening-data.js";
import { epdOf, fenFromEpd, findLegalMove, sanKey } from "../positions.js";
import {
  db,
  clamp,
  createDrill,
  finishDrill,
  getDrill,
  profileFor,
  recordProfileResult,
} from "./db.js";

export const intuitionRouter = Router();

const STYLE_KEYS = ["aggressive", "solid", "sharp", "learnable"];
const STYLE_LABELS = {
  aggressive: "Attacking",
  solid: "Solid",
  sharp: "Tactical",
  learnable: "Classical",
};

function playedPath(epd) {
  const rows = db
    .prepare(
      `SELECT l.moves FROM line_moves lm JOIN lines l ON l.id = lm.line_id
       WHERE lm.epd = ? ORDER BY lm.id LIMIT 3`
    )
    .all(epd);
  for (const row of rows) {
    const sans = String(row.moves || "").split(/\s+/).filter(Boolean);
    const chess = new Chess();
    const path = [];
    if (epdOf(chess.fen()) === epd) return path;
    for (const san of sans) {
      try {
        chess.move(san);
      } catch {
        break;
      }
      path.push(san);
      if (epdOf(chess.fen()) === epd) return path;
    }
  }
  const opening = db
    .prepare("SELECT sans FROM openings WHERE epd_after = ? LIMIT 1")
    .get(epd);
  if (opening?.sans) return String(opening.sans).split(/\s+/).filter(Boolean);
  return [];
}

function candidatesFor(epd) {
  const rows = db
    .prepare(
      `SELECT pc.* FROM position_candidates pc
       WHERE pc.epd = ? ORDER BY pc.rank ASC, pc.san ASC`
    )
    .all(epd);
  return rows.map((row) => {
    const masterGames = Number(row.master_white || 0) + Number(row.master_draw || 0) + Number(row.master_black || 0);
    const peerGames = Number(row.peer_white || 0) + Number(row.peer_draw || 0) + Number(row.peer_black || 0);
    const pct = (part, total) => (total > 0 ? Math.round((part / total) * 1000) / 10 : null);
    return {
      san: row.san,
      sanKey: sanKey(row.san),
      rank: Number(row.rank),
      probability: row.probability == null ? null : Number(row.probability),
      incidence: row.incidence == null ? null : Number(row.incidence),
      eval: row.stockfish_eval == null ? null : Number(row.stockfish_eval),
      annotation: row.annotation ?? null,
      masters: masterGames > 0 ? masterGames : null,
      mastersAvailable: masterGames > 0,
      peerResults:
        peerGames > 0
          ? {
              white: pct(row.peer_white, peerGames),
              draw: pct(row.peer_draw, peerGames),
              black: pct(row.peer_black, peerGames),
            }
          : null,
      peersAvailable: peerGames > 0,
      masterResults:
        masterGames > 0
          ? {
              white: pct(row.master_white, masterGames),
              draw: pct(row.master_draw, masterGames),
              black: pct(row.master_black, masterGames),
            }
          : null,
    };
  });
}

function positionsWithCaptures() {
  const rows = db
    .prepare(
      `SELECT r.epd, r.side_to_move, MAX(r.complete) AS complete, COUNT(c.id) AS candidate_count
       FROM position_reports r JOIN position_candidates c ON c.report_id = r.id
       GROUP BY r.epd
       HAVING candidate_count >= 5
       ORDER BY complete DESC, candidate_count DESC, r.epd ASC`
    )
    .all();
  return rows.map((row) => ({
    epd: row.epd,
    fen: fenFromEpd(row.epd),
    side: row.side_to_move,
    complete: Boolean(row.complete),
    candidateCount: Number(row.candidate_count),
    path: playedPath(row.epd),
  }));
}

function stylePercentiles(candidates, chosen, style) {
  const values = candidates.map((candidate) => scoreCandidate(candidate, style));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const chosenValue = scoreCandidate(chosen, style);
  return clamp((chosenValue - min) / span, 0, 1);
}

function heuristicStyle(fen, san) {
  let chess;
  try {
    chess = new Chess(fen);
  } catch {
    return { aggressive: 0.5, solid: 0.5, sharp: 0.5, learnable: 0.5 };
  }
  let move;
  try {
    move = chess.move(san);
  } catch {
    return { aggressive: 0.5, solid: 0.5, sharp: 0.5, learnable: 0.5 };
  }
  const checks = chess.inCheck() ? 1 : 0;
  const capture = move.captured ? 1 : 0;
  const castle = /^O-O/.test(move.san) ? 1 : 0;
  const central = ["d4", "e4", "d5", "e5"].includes(move.to) ? 1 : 0;
  const development = ["n", "b"].includes(move.piece) && !capture ? 1 : 0;
  const promotion = move.promotion ? 1 : 0;
  return {
    aggressive: clamp(0.25 + capture * 0.25 + checks * 0.2 + promotion * 0.3, 0, 1),
    solid: clamp(0.3 + castle * 0.4 + development * 0.15 - checks * 0.15, 0, 1),
    sharp: clamp(0.2 + capture * 0.3 + checks * 0.35, 0, 1),
    learnable: clamp(0.3 + central * 0.3 + development * 0.25 + castle * 0.15, 0, 1),
  };
}

function currentStyles(profile) {
  const stored = profile.data?.styles || {};
  const out = {};
  for (const key of STYLE_KEYS) out[key] = Math.round(Number(stored[key] || 50));
  return out;
}

function summarizeStyles(styles, answers) {
  const ranked = [...STYLE_KEYS].sort((a, b) => styles[b] - styles[a]);
  const top = ranked[0];
  const second = ranked[1];
  const label = STYLE_LABELS[top] || "Balanced";
  const clarity = Math.round(clamp(styles[top] - styles[second] + 45, 0, 100));
  return {
    label,
    secondary: STYLE_LABELS[second] || null,
    ranked,
    clarity,
    summary:
      answers > 0
        ? `Your choices lean ${label.toLowerCase()}${
            STYLE_LABELS[second] ? ` with ${STYLE_LABELS[second].toLowerCase()} as the secondary trait` : ""
          }.`
        : "Play a few moves to reveal your style.",
  };
}

function sessionSummary(profile) {
  const styles = currentStyles(profile);
  return {
    styles,
    styleSource: profile.data?.styleSource || "captured-candidate",
    answers: Number(profile.data?.answers || 0),
    sessions: Number(profile.data?.sessions || 0),
    ...summarizeStyles(styles, Number(profile.data?.answers || 0)),
  };
}

function publicPosition(entry) {
  return {
    epd: entry.epd,
    fen: entry.fen,
    side: entry.side,
    path: entry.path,
    moveNumber: Math.floor(entry.path.length / 2) + 1,
    label: entry.path.length
      ? `${Math.ceil(entry.path.length / 2)}${entry.path.length % 2 === 1 ? "…" : "."} to move`
      : "Start position",
    prompt: entry.path.length
      ? `Play the move that feels most like you after ${entry.path.join(" ")}.`
      : "Play the first move that feels most like you.",
  };
}

function responseForDrill(drill, profile, index) {
  const positions = drill.payload.positions || [];
  const position = positions[index];
  return {
    session: {
      id: drill.id,
      total: positions.length,
      index,
      complete: index >= positions.length,
      position: position ? publicPosition(position) : null,
    },
    profile: profileFor(drill.userId, "intuition"),
    summary: sessionSummary(profile),
  };
}

intuitionRouter.get("/", (req, res) => {
  const profile = profileFor(req.user.id, "intuition");
  const positions = positionsWithCaptures();
  res.json({
    positions: positions.map((entry) => ({
      epd: entry.epd,
      side: entry.side,
      path: entry.path,
      candidateCount: entry.candidateCount,
      complete: entry.complete,
    })),
    available: positions.length > 0,
    profile,
    summary: sessionSummary(profile),
    source: {
      type: "captured-position-candidates",
      note: "Style points are derived from the captured candidate list (play rate, engine eval, master/peer splits and annotations). Moves outside that list use a transparent local heuristic and are labelled.",
    },
  });
});

intuitionRouter.post("/session", (req, res) => {
  const body = req.body || {};
  const count = clamp(Number(body.count) || 4, 2, 6);
  const positions = positionsWithCaptures();
  if (!positions.length) {
    return res.status(409).json({
      error: "No captured positions with candidate lists are available",
      code: "no_captured_positions",
    });
  }
  const shuffled = [...positions];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const chosen = [];
  const seen = new Set();
  for (const entry of shuffled) {
    if (seen.has(entry.epd)) continue;
    seen.add(entry.epd);
    chosen.push({
      ...entry,
      candidates: candidatesFor(entry.epd),
    });
    if (chosen.length >= count) break;
  }
  const sessionId = randomUUID();
  createDrill({
    id: sessionId,
    userId: req.user.id,
    feature: "intuition",
    kind: "style-session",
    payload: {
      positions: chosen,
      answers: [],
      createdAt: new Date().toISOString(),
    },
  });
  const drill = getDrill(sessionId, req.user.id, "intuition");
  const profile = profileFor(req.user.id, "intuition");
  res.status(201).json({
    ...responseForDrill(drill, profile, 0),
    instructions:
      "Play one move on each captured position. Your choices are compared with the captured candidate styles.",
  });
});

intuitionRouter.post("/answer", (req, res) => {
  const body = req.body || {};
  const sessionId = String(body.sessionId || body.id || "");
  const drill = getDrill(sessionId, req.user.id, "intuition");
  if (!drill) return res.status(404).json({ error: "Intuition session not found" });
  if (drill.status !== "open") {
    return res
      .status(409)
      .json({ error: "That session is already complete", code: "session_complete", result: drill.result });
  }
  const positions = drill.payload.positions || [];
  const index = Number.isInteger(body.index) ? Number(body.index) : drill.payload.answers.length;
  if (index < 0 || index >= positions.length) {
    return res.status(400).json({ error: "That question index is out of range" });
  }
  if (index !== drill.payload.answers.length) {
    return res.status(409).json({
      error: "Answer the questions in order",
      code: "out_of_order",
      expectedIndex: drill.payload.answers.length,
    });
  }
  const entry = positions[index];
  const legal = findLegalMove(entry.fen, String(body.san || ""));
  if (!legal) {
    return res.status(422).json({
      error: `Illegal move ${body.san || "(empty)"} in this position`,
      code: "illegal_move",
      fen: entry.fen,
      legalMoves: new Chess(entry.fen).moves(),
    });
  }
  const candidates = entry.candidates || [];
  const chosen = candidates.find((candidate) => candidate.sanKey === sanKey(legal.san));
  let stylePoints;
  let styleSource;
  if (chosen) {
    stylePoints = {};
    for (const style of STYLE_KEYS) {
      stylePoints[style] = Math.round(stylePercentiles(candidates, chosen, style) * 100);
    }
    styleSource = "captured-candidate";
  } else {
    const heuristic = heuristicStyle(entry.fen, legal.san);
    stylePoints = {};
    for (const style of STYLE_KEYS) stylePoints[style] = Math.round(heuristic[style] * 100);
    styleSource = "local-heuristic";
  }

  const profileBefore = profileFor(req.user.id, "intuition");
  const answersBefore = Number(profileBefore.data?.answers || 0);
  const stylesBefore = currentStyles(profileBefore);
  const styles = {};
  for (const style of STYLE_KEYS) {
    styles[style] = Math.round(
      (stylesBefore[style] * answersBefore + stylePoints[style]) / (answersBefore + 1)
    );
  }
  const top = candidates.slice(0, 5).map((candidate) => ({
    san: candidate.san,
    probability: candidate.probability,
    incidence: candidate.incidence,
    oneIn: candidate.incidence ? Math.max(1, Math.round(1 / candidate.incidence)) : null,
    eval: candidate.eval,
    masters: candidate.masters,
    peerResults: candidate.peerResults,
    annotation: candidate.annotation,
  }));
  const savedAnswer = {
    index,
    san: legal.san,
    captured: Boolean(chosen),
    stylePoints,
    styleSource,
    epd: entry.epd,
    at: new Date().toISOString(),
  };
  const answers = [...(drill.payload.answers || []), savedAnswer];
  const complete = answers.length >= positions.length;
  const profile = recordProfileResult(req.user.id, "intuition", {
    score: Math.max(...STYLE_KEYS.map((style) => stylePoints[style])) / 100,
    opponentRating: 1200,
    k: 18,
    perfect: null,
    gamesDelta: complete ? 1 : 0,
    data: {
      styles,
      answers: answersBefore + 1,
      sessions: Number(profileBefore.data?.sessions || 0) + (complete ? 1 : 0),
      styleSource: chosen ? "captured-candidate" : "local-heuristic",
      lastSummary: summarizeStyles(styles, answersBefore + 1),
      lastAt: new Date().toISOString(),
    },
  });
  const payload = { ...drill.payload, answers };
  if (complete) {
    const result = {
      styles,
      ...summarizeStyles(styles, answers.length),
      answers,
      styleSource,
      completedAt: new Date().toISOString(),
    };
    finishDrill(drill.id, req.user.id, result);
  } else {
    db.prepare("UPDATE play_drills SET payload_json = ? WHERE id = ? AND user_id = ?").run(
      JSON.stringify(payload),
      drill.id,
      req.user.id
    );
  }
  const nextIndex = answers.length;
  res.json({
    answer: {
      san: legal.san,
      from: legal.from,
      to: legal.to,
      captured: Boolean(chosen),
      stylePoints,
      styleSource,
      chosen: chosen
        ? {
            san: chosen.san,
            probability: chosen.probability,
            incidence: chosen.incidence,
            oneIn: chosen.incidence ? Math.max(1, Math.round(1 / chosen.incidence)) : null,
            eval: chosen.eval,
            annotation: chosen.annotation,
          }
        : null,
    },
    top,
    session: {
      id: drill.id,
      total: positions.length,
      index: nextIndex,
      complete,
      position: complete ? null : publicPosition(positions[nextIndex]),
    },
    profile,
    summary: sessionSummary(profile),
    complete,
    result: complete
      ? {
          styles,
          ...summarizeStyles(styles, answers.length),
          answers,
          styleSource,
        }
      : null,
  });
});
