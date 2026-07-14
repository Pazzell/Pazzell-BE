"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const session_controller_1 = require("../controllers/session.controller");
const auth_1 = require("../utils/auth");
const router = express_1.default.Router();
router.post("/sessions/start", auth_1.isAuthenticated, session_controller_1.postStartSession);
router.post("/sessions/:id/games/:gameType/start", auth_1.isAuthenticated, session_controller_1.postStartGameStage);
router.post("/sessions/:id/games/:gameType/complete", auth_1.isAuthenticated, session_controller_1.postCompleteGameStage);
router.post("/sessions/:id/video/start", auth_1.isAuthenticated, session_controller_1.postStartVideoStage);
router.post("/sessions/:id/video/complete", auth_1.isAuthenticated, session_controller_1.postCompleteVideoStage);
router.post("/sessions/:id/quiz/attempt", auth_1.isAuthenticated, session_controller_1.postQuizAttempt);
router.post("/sessions/:id/complete", auth_1.isAuthenticated, session_controller_1.postCompleteSession);
exports.default = router;
