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
exports.getAllTimeLeaderboard = exports.getLeaderboardByWeek = exports.getWeeklyLeaderboard = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const puzzleAttempt_model_1 = __importDefault(require("../models/puzzleAttempt.model"));
const leaderboard_model_1 = __importDefault(require("../models/leaderboard.model"));
const user_model_1 = __importDefault(require("../models/user.model"));
// Get current week's leaderboard
exports.getWeeklyLeaderboard = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        // Calculate current week's start (Monday) and end (Sunday)
        const dayOfWeek = now.getDay();
        const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday is 0, Monday is 1
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysFromMonday);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6); // Sunday
        weekEnd.setHours(23, 59, 59, 999);
        // DEBUG: Count all attempts regardless of week
        const totalAttempts = yield puzzleAttempt_model_1.default.countDocuments({
            firstTimeSolved: true,
        });
        // DEBUG: Count attempts in current week
        const weekAttempts = yield puzzleAttempt_model_1.default.countDocuments({
            firstTimeSolved: true,
            timestamp: { $gte: weekStart, $lte: weekEnd },
        });
        // count firstTimeSolved attempts that occurred this week grouped by user
        const agg = yield puzzleAttempt_model_1.default.aggregate([
            {
                $match: {
                    firstTimeSolved: true,
                    timestamp: { $gte: weekStart, $lte: weekEnd },
                },
            },
            {
                $group: {
                    _id: "$userId",
                    puzzlesSolved: { $sum: 1 },
                    points: { $sum: "$pointsEarned" },
                },
            },
            { $sort: { points: -1, puzzlesSolved: -1 } },
            { $limit: 100 },
        ]);
        const entries = agg.map((a) => ({
            userId: a._id,
            puzzlesSolved: a.puzzlesSolved,
            points: a.points,
        }));
        // Create week key
        const weekKey = `${weekStart.toISOString().slice(0, 10)}_to_${weekEnd.toISOString().slice(0, 10)}`;
        // upsert leaderboard document for this week
        yield leaderboard_model_1.default.findOneAndUpdate({ type: "weekly", date: weekKey }, { type: "weekly", date: weekKey, entries }, { upsert: true });
        // Fetch user details for each entry
        const entriesWithUserDetails = yield Promise.all(entries.map((entry, index) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield user_model_1.default.findById(entry.userId)
                .select("firstName lastName username avatar")
                .lean();
            return {
                position: index + 1,
                userId: entry.userId,
                fullName: user ? `${user.firstName} ${user.lastName}` : "Unknown User",
                username: (user === null || user === void 0 ? void 0 : user.username) || "",
                avatar: (user === null || user === void 0 ? void 0 : user.avatar) || "",
                puzzlesSolved: entry.puzzlesSolved,
                points: entry.points,
                amountEarned: entry.points, // Points = amount earned
            };
        })));
        res.status(200).json({
            success: true,
            leaderboard: {
                type: "weekly",
                weekStart: weekStart.toISOString().slice(0, 10),
                weekEnd: weekEnd.toISOString().slice(0, 10),
                totalPlayers: entriesWithUserDetails.length,
                entries: entriesWithUserDetails,
            },
            debug: {
                totalAttemptsWithFirstTimeSolved: totalAttempts,
                attemptsInCurrentWeek: weekAttempts,
                weekStartFull: weekStart.toISOString(),
                weekEndFull: weekEnd.toISOString(),
                currentDate: now.toISOString(),
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// Get leaderboard for a specific week
exports.getLeaderboardByWeek = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { weekKey } = req.params; // Format: "2025-01-06_to_2025-01-12"
        const board = yield leaderboard_model_1.default.findOne({
            type: "weekly",
            date: weekKey,
        });
        if (!board) {
            return res.status(200).json({
                success: true,
                leaderboard: {
                    type: "weekly",
                    weekKey,
                    totalPlayers: 0,
                    entries: [],
                },
            });
        }
        // Fetch user details for each entry
        const entriesWithUserDetails = yield Promise.all(board.entries.map((entry, index) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield user_model_1.default.findById(entry.userId)
                .select("firstName lastName username avatar")
                .lean();
            return {
                position: index + 1,
                userId: entry.userId,
                fullName: user ? `${user.firstName} ${user.lastName}` : "Unknown User",
                username: (user === null || user === void 0 ? void 0 : user.username) || "",
                avatar: (user === null || user === void 0 ? void 0 : user.avatar) || "",
                puzzlesSolved: entry.puzzlesSolved,
                points: entry.points,
                amountEarned: entry.points, // Points = amount earned
            };
        })));
        res.status(200).json({
            success: true,
            leaderboard: {
                type: "weekly",
                weekKey,
                totalPlayers: entriesWithUserDetails.length,
                entries: entriesWithUserDetails,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// Get all-time leaderboard
exports.getAllTimeLeaderboard = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Aggregate all puzzle attempts (no time filter)
        const agg = yield puzzleAttempt_model_1.default.aggregate([
            {
                $match: {
                    firstTimeSolved: true,
                },
            },
            {
                $group: {
                    _id: "$userId",
                    puzzlesSolved: { $sum: 1 },
                    points: { $sum: "$pointsEarned" },
                },
            },
            { $sort: { points: -1, puzzlesSolved: -1 } },
            { $limit: 100 },
        ]);
        const entries = agg.map((a) => ({
            userId: a._id,
            puzzlesSolved: a.puzzlesSolved,
            points: a.points,
        }));
        // Fetch user details for each entry
        const entriesWithUserDetails = yield Promise.all(entries.map((entry, index) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield user_model_1.default.findById(entry.userId)
                .select("firstName lastName avatar username")
                .lean();
            return {
                position: index + 1,
                userId: entry.userId,
                fullName: user ? `${user.firstName} ${user.lastName}` : "Unknown User",
                username: (user === null || user === void 0 ? void 0 : user.username) || "",
                avatar: (user === null || user === void 0 ? void 0 : user.avatar) || "",
                puzzlesSolved: entry.puzzlesSolved,
                points: entry.points,
                amountEarned: entry.points, // Points = amount earned
            };
        })));
        res.status(200).json({
            success: true,
            leaderboard: {
                type: "all-time",
                totalPlayers: entriesWithUserDetails.length,
                entries: entriesWithUserDetails,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch all-time leaderboard: ${error.message}`, 500));
    }
}));
