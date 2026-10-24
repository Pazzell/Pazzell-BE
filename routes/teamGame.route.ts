import express from "express";
import {
  answer,
  assignLeader,
  assignPlayer,
  createGame,
  end,
  getGame,
  getResult,
  join,
  leave,
  listMessages,
  listMyGames,
  pick,
  sendMessage,
  start,
  updateSettings,
} from "../controllers/teamGame.controller";
import { isAuthenticated } from "../utils/auth";
import { chatLimiter, linkResolveLimiter, submitLimiter, writeLimiter } from "../middlewares/rateLimit";

const router = express.Router();

// Public: the shareable result card of a finished game
router.get("/team-games/:code/result", linkResolveLimiter, getResult);

router.post("/team-games", isAuthenticated, writeLimiter, createGame);
router.get("/team-games", isAuthenticated, listMyGames);
router.get("/team-games/:code", isAuthenticated, getGame);
router.patch("/team-games/:code", isAuthenticated, writeLimiter, updateSettings);

router.post("/team-games/:code/join", isAuthenticated, writeLimiter, join);
router.post("/team-games/:code/leave", isAuthenticated, writeLimiter, leave);
router.post("/team-games/:code/players/:userId/team", isAuthenticated, writeLimiter, assignPlayer);
router.post("/team-games/:code/teams/:teamId/leader", isAuthenticated, writeLimiter, assignLeader);

router.post("/team-games/:code/start", isAuthenticated, start);
router.post("/team-games/:code/pick", isAuthenticated, submitLimiter, pick);
router.post("/team-games/:code/answer", isAuthenticated, submitLimiter, answer);
router.post("/team-games/:code/end", isAuthenticated, end);

router.get("/team-games/:code/messages", isAuthenticated, listMessages);
router.post("/team-games/:code/messages", isAuthenticated, chatLimiter, sendMessage);

export default router;
