"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const leaderboard_controller_1 = require("../controllers/leaderboard.controller");
const router = express_1.default.Router();
// Public endpoints - no authentication required
router.get("/leaderboards/weekly", leaderboard_controller_1.getWeeklyLeaderboard);
router.get("/leaderboards/weekly/:weekKey", leaderboard_controller_1.getLeaderboardByWeek);
router.get("/leaderboards/all-time", leaderboard_controller_1.getAllTimeLeaderboard);
exports.default = router;
