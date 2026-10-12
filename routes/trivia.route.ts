import express from "express";
import {
  listTopics,
  getTopic,
  postStartSession,
  getSessionState,
  getQuestion,
  postAnswer,
  getSessionResult,
  postAbandon,
} from "../controllers/trivia.controller";
import { isAuthenticated } from "../utils/auth";
import { sessionStartLimiter, submitLimiter } from "../middlewares/rateLimit";

const router = express.Router();

router.get("/trivia/topics", isAuthenticated, listTopics);
router.get("/trivia/topics/:id", isAuthenticated, getTopic);

// One session engine for topics, custom quizzes and campaigns
router.post("/trivia/sessions", isAuthenticated, sessionStartLimiter, postStartSession);
router.get("/trivia/sessions/:id", isAuthenticated, getSessionState);
router.get("/trivia/sessions/:id/question", isAuthenticated, submitLimiter, getQuestion);
router.post("/trivia/sessions/:id/answer", isAuthenticated, submitLimiter, postAnswer);
router.get("/trivia/sessions/:id/result", isAuthenticated, getSessionResult);
router.post("/trivia/sessions/:id/abandon", isAuthenticated, postAbandon);

export default router;
