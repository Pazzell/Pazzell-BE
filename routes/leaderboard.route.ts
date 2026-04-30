import express from "express";
import {
  getWeeklyLeaderboard,
  getLeaderboardByWeek,
  getAllTimeLeaderboard,
} from "../controllers/leaderboard.controller";

const router = express.Router();

// Public endpoints - no authentication required
router.get("/leaderboards/weekly", getWeeklyLeaderboard);
router.get("/leaderboards/weekly/:weekKey", getLeaderboardByWeek);
router.get("/leaderboards/all-time", getAllTimeLeaderboard);

export default router;
