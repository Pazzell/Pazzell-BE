"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const analytics_controller_1 = require("../controllers/analytics.controller");
const auth_1 = require("../utils/auth");
const router = express_1.default.Router();
// Public endpoint - Get global app analytics
router.get("/analytics/app", analytics_controller_1.getAppAnalytics);
// Protected endpoints - Track user activity
router.post("/analytics/game/start", auth_1.isAuthenticated, analytics_controller_1.startPlayingGame);
router.post("/analytics/game/stop", auth_1.isAuthenticated, analytics_controller_1.stopPlayingGame);
router.post("/analytics/user/online", auth_1.isAuthenticated, analytics_controller_1.markUserOnline);
router.post("/analytics/user/offline", auth_1.isAuthenticated, analytics_controller_1.markUserOffline);
exports.default = router;
