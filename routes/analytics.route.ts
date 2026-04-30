import express from "express";
import {
  getAppAnalytics,
  startPlayingGame,
  stopPlayingGame,
  markUserOnline,
  markUserOffline,
} from "../controllers/analytics.controller";
import { isAuthenticated } from "../utils/auth";

const router = express.Router();

// Public endpoint - Get global app analytics
router.get("/analytics/app", getAppAnalytics);

// Protected endpoints - Track user activity
router.post("/analytics/game/start", isAuthenticated, startPlayingGame);
router.post("/analytics/game/stop", isAuthenticated, stopPlayingGame);
router.post("/analytics/user/online", isAuthenticated, markUserOnline);
router.post("/analytics/user/offline", isAuthenticated, markUserOffline);

export default router;
