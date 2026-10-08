import express from "express";
import {
  getArtifacts,
  getArtifactSvg,
  getLevels,
  getProgress,
  postStartAttempt,
  getAttemptState,
  getQuestion,
  postAnswer,
  postFinish,
} from "../controllers/match.controller";
import { isAuthenticated } from "../utils/auth";
import { sessionStartLimiter, submitLimiter } from "../middlewares/rateLimit";

const router = express.Router();

// Artifact registry — public
router.get("/match/artifacts", getArtifacts);
router.get("/match/artifacts/svg", getArtifactSvg);

router.get("/match/levels", isAuthenticated, getLevels);
router.get("/match/progress", isAuthenticated, getProgress);
router.post("/match/levels/:level/attempts", isAuthenticated, sessionStartLimiter, postStartAttempt);

router.get("/match/attempts/:id", isAuthenticated, getAttemptState);
router.get("/match/attempts/:id/question", isAuthenticated, submitLimiter, getQuestion);
router.post("/match/attempts/:id/answer", isAuthenticated, submitLimiter, postAnswer);
router.post("/match/attempts/:id/finish", isAuthenticated, postFinish);

export default router;
