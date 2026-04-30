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
exports.markUserOffline = exports.markUserOnline = exports.stopPlayingGame = exports.startPlayingGame = exports.getAppAnalytics = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const puzzleAttempt_model_1 = __importDefault(require("../models/puzzleAttempt.model"));
const redis_1 = require("../utils/redis");
// Get global app analytics
exports.getAppAnalytics = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Total games played (all-time count of puzzle attempts)
        const totalGamesPlayed = yield puzzleAttempt_model_1.default.countDocuments();
        // 2. Total games played today (count of puzzle attempts created today)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const gamesPlayedToday = yield puzzleAttempt_model_1.default.countDocuments({
            timestamp: {
                $gte: todayStart,
                $lte: todayEnd,
            },
        });
        // 3. Currently playing (users actively in a game right now)
        const currentlyPlayingSet = yield redis_1.redis.smembers("users:currently_playing");
        const currentlyPlaying = currentlyPlayingSet.length;
        // 4. Online users (logged in users)
        const onlineUsersSet = yield redis_1.redis.smembers("users:online");
        const onlineUsers = onlineUsersSet.length;
        res.status(200).json({
            success: true,
            analytics: {
                totalGamesPlayed,
                gamesPlayedToday,
                currentlyPlaying,
                onlineUsers,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch analytics: ${error.message}`, 500));
    }
}));
// Mark user as starting to play a game
exports.startPlayingGame = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id;
        const { campaignId } = req.body;
        if (!userId) {
            return next(new ErrorHandler_1.default("User not authenticated", 401));
        }
        if (!campaignId) {
            return next(new ErrorHandler_1.default("Campaign ID is required", 400));
        }
        // Add user to "currently playing" set with expiry (auto-remove after 1 hour)
        yield redis_1.redis.sadd("users:currently_playing", userId);
        yield redis_1.redis.expire("users:currently_playing", 3600); // 1 hour
        // Store which campaign they're playing
        yield redis_1.redis.set(`user:${userId}:playing`, campaignId, "EX", 3600);
        res.status(200).json({
            success: true,
            message: "Started playing game",
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to start game: ${error.message}`, 500));
    }
}));
// Mark user as finished playing a game
exports.stopPlayingGame = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id;
        if (!userId) {
            return next(new ErrorHandler_1.default("User not authenticated", 401));
        }
        // Remove user from "currently playing" set
        yield redis_1.redis.srem("users:currently_playing", userId);
        // Remove the campaign they were playing
        yield redis_1.redis.del(`user:${userId}:playing`);
        res.status(200).json({
            success: true,
            message: "Stopped playing game",
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to stop game: ${error.message}`, 500));
    }
}));
// Track user as online (called on login and periodically via heartbeat)
exports.markUserOnline = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id;
        if (!userId) {
            return next(new ErrorHandler_1.default("User not authenticated", 401));
        }
        // Add user to "online" set with 5-minute expiry
        // Frontend should send heartbeat every 2-3 minutes to keep user marked as online
        yield redis_1.redis.sadd("users:online", userId);
        yield redis_1.redis.expire("users:online", 300); // 5 minutes
        // Update last activity timestamp
        yield redis_1.redis.set(`user:${userId}:last_active`, Date.now(), "EX", 300);
        res.status(200).json({
            success: true,
            message: "User marked as online",
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to mark user online: ${error.message}`, 500));
    }
}));
// Mark user as offline (called on logout)
exports.markUserOffline = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id;
        if (!userId) {
            return next(new ErrorHandler_1.default("User not authenticated", 401));
        }
        // Remove from online set
        yield redis_1.redis.srem("users:online", userId);
        // Remove from currently playing (in case they were playing)
        yield redis_1.redis.srem("users:currently_playing", userId);
        // Clean up keys
        yield redis_1.redis.del(`user:${userId}:last_active`);
        yield redis_1.redis.del(`user:${userId}:playing`);
        res.status(200).json({
            success: true,
            message: "User marked as offline",
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to mark user offline: ${error.message}`, 500));
    }
}));
