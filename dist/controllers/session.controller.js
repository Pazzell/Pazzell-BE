"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.postCompleteSession = exports.postQuizAttempt = exports.postCompleteVideoStage = exports.postStartVideoStage = exports.postCompleteGameStage = exports.postStartGameStage = exports.postStartSession = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const gameSession_service_1 = require("../services/session/gameSession.service");
function handleSessionError(error, next) {
    if (error instanceof gameSession_service_1.SessionError) {
        return next(new ErrorHandler_1.default(error.message, error.statusCode));
    }
    return next(new ErrorHandler_1.default(error.message || "Session operation failed", 500));
}
// POST /sessions/start  { campaignId }
exports.postStartSession = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { campaignId } = req.body;
        if (!campaignId) {
            return next(new ErrorHandler_1.default("campaignId is required", 400));
        }
        const session = yield (0, gameSession_service_1.startSession)(userId, campaignId);
        res.status(201).json({ success: true, session });
    }
    catch (error) {
        handleSessionError(error, next);
    }
}));
// POST /sessions/:id/games/:gameType/start
exports.postStartGameStage = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { id, gameType } = req.params;
        const session = yield (0, gameSession_service_1.startGameStage)(id, userId, gameType);
        res.status(200).json({ success: true, session });
    }
    catch (error) {
        handleSessionError(error, next);
    }
}));
// POST /sessions/:id/games/:gameType/complete  { movesTaken?, timeTakenMs? }
exports.postCompleteGameStage = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { id, gameType } = req.params;
        const { movesTaken, timeTakenMs } = req.body;
        const session = yield (0, gameSession_service_1.completeGameStage)(id, userId, gameType, movesTaken !== undefined ? Number(movesTaken) : undefined, timeTakenMs !== undefined ? Number(timeTakenMs) : undefined);
        res.status(200).json({ success: true, session });
    }
    catch (error) {
        handleSessionError(error, next);
    }
}));
// POST /sessions/:id/video/start
exports.postStartVideoStage = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { id } = req.params;
        const session = yield (0, gameSession_service_1.startVideoStage)(id, userId);
        res.status(200).json({ success: true, session });
    }
    catch (error) {
        handleSessionError(error, next);
    }
}));
// POST /sessions/:id/video/complete
exports.postCompleteVideoStage = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { id } = req.params;
        const session = yield (0, gameSession_service_1.completeVideoStage)(id, userId);
        res.status(200).json({ success: true, session });
    }
    catch (error) {
        handleSessionError(error, next);
    }
}));
// POST /sessions/:id/quiz/attempt  { answers: number[] }
exports.postQuizAttempt = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = String(req.user._id);
        const { id } = req.params;
        const { answers } = req.body;
        if (!Array.isArray(answers)) {
            return next(new ErrorHandler_1.default("answers must be an array", 400));
        }
        const { session, score, allCorrect } = yield (0, gameSession_service_1.submitQuizAttempt)(id, userId, answers);
        res.status(200).json({
            success: true,
            score,
            allCorrect,
            attemptsSoFar: session.quiz.attempts.length,
            firstAttemptScore: (_a = session.quiz.firstAttempt) === null || _a === void 0 ? void 0 : _a.score,
        });
    }
    catch (error) {
        handleSessionError(error, next);
    }
}));
// POST /sessions/:id/complete  { totalMoves? }
exports.postCompleteSession = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { id } = req.params;
        const { totalMoves } = req.body;
        const result = yield (0, gameSession_service_1.completeSession)(id, userId, totalMoves !== undefined ? Number(totalMoves) : undefined);
        res.status(200).json({
            success: true,
            isFirstCompletion: result.isFirstCompletion,
            pointsAwarded: result.pointsAwarded,
            totalCompletionTimeMs: result.totalCompletionTimeMs,
            totalMoves: result.totalMoves,
            voided: result.voided,
            flagged: result.flagged,
        });
    }
    catch (error) {
        handleSessionError(error, next);
    }
}));
