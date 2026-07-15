import express from "express";
import {
  postStartSession,
  postStartGameStage,
  postCompleteGameStage,
  postStartVideoStage,
  postCompleteVideoStage,
  postQuizAttempt,
  postCompleteSession,
} from "../controllers/session.controller";
import { isAuthenticated } from "../utils/auth";

const router = express.Router();

router.post("/sessions/start", isAuthenticated, postStartSession);
router.post(
  "/sessions/:id/games/:gameType/start",
  isAuthenticated,
  postStartGameStage
);
router.post(
  "/sessions/:id/games/:gameType/complete",
  isAuthenticated,
  postCompleteGameStage
);
router.post("/sessions/:id/video/start", isAuthenticated, postStartVideoStage);
router.post(
  "/sessions/:id/video/complete",
  isAuthenticated,
  postCompleteVideoStage
);
router.post("/sessions/:id/quiz/attempt", isAuthenticated, postQuizAttempt);
router.post("/sessions/:id/complete", isAuthenticated, postCompleteSession);

export default router;
