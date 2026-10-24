import { Router } from "express";
import { requireAuth } from "./api.js";
import {
  allProfiles,
  PLAY_FEATURES,
  profileFor,
  recentAttempts,
} from "./play/db.js";
import { gamesRouter } from "./play/games.js";
import { puzzlesRouter } from "./play/puzzles.js";
import { intuitionRouter } from "./play/intuition.js";
import { visualizationRouter } from "./play/visualization.js";
import { visionRouter } from "./play/vision.js";

/**
 * Play pillars API (audit D158–D162, D200, D202).
 *
 * Mounted at `/api/play`. Everything is local and single-player; no WebSocket
 * layer is used because each game is a request/response turn (D201 not needed).
 */
export const playApi = Router();

playApi.use(requireAuth);

playApi.get("/", (_req, res) => {
  res.json({
    features: PLAY_FEATURES,
    routes: {
      trainingGames: "/api/play/training-games",
      blunderPuzzles: "/api/play/blunder-puzzles",
      intuitionBuilder: "/api/play/intuition-builder",
      visualization: "/api/play/visualization",
      vision: "/api/play/vision",
      progress: "/api/play/progress",
    },
    engine: {
      name: "Chessbook local heuristic",
      stockfish: false,
      note: "Deterministic material + piece-square search; no cloud service and no Stockfish binary.",
    },
  });
});

playApi.get("/progress", (req, res) => {
  res.json({
    profiles: allProfiles(req.user.id),
    recent: Object.fromEntries(
      PLAY_FEATURES.map((feature) => [feature, recentAttempts(req.user.id, feature, 5)])
    ),
    engine: "Chessbook local heuristic",
  });
});

playApi.get("/progress/:feature", (req, res) => {
  const feature = String(req.params.feature);
  if (!PLAY_FEATURES.includes(feature)) {
    return res.status(404).json({ error: "Unknown play feature", feature });
  }
  res.json({
    profile: profileFor(req.user.id, feature),
    recent: recentAttempts(req.user.id, feature, 10),
  });
});

playApi.use("/training-games", gamesRouter);
playApi.use("/blunder-puzzles", puzzlesRouter);
playApi.use("/intuition-builder", intuitionRouter);
playApi.use("/visualization", visualizationRouter);
playApi.use("/vision", visionRouter);
