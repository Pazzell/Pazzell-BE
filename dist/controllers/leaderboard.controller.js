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
exports.getAllTimeLeaderboard = exports.getLeaderboardByWeek = exports.getLeaderboardByMonth = exports.getMonthlyLeaderboard = exports.getWeeklyLeaderboard = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const puzzleAttempt_model_1 = __importDefault(require("../models/puzzleAttempt.model"));
const leaderboard_model_1 = __importDefault(require("../models/leaderboard.model"));
const user_model_1 = __importDefault(require("../models/user.model"));
const MONTHLY_PRIZES = [
    100000, 60000, 50000, 40000, 35000, 30000, 25000, 20000, 15000, 10000,
];
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
                    avgTime: { $avg: "$timeTaken" },
                },
            },
            { $sort: { points: -1, avgTime: 1, puzzlesSolved: -1 } },
            { $limit: 100 },
        ]);
        const entries = agg.map((a) => ({
            userId: a._id,
            puzzlesSolved: a.puzzlesSolved,
            points: a.points,
            avgTime: a.avgTime || null,
        }));
        // Create week key
        const weekKey = `${weekStart.toISOString().slice(0, 10)}_to_${weekEnd
            .toISOString()
            .slice(0, 10)}`;
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
                fullName: user
                    ? `${user.firstName} ${user.lastName}`
                    : "Unknown User",
                username: (user === null || user === void 0 ? void 0 : user.username) || "",
                avatar: (user === null || user === void 0 ? void 0 : user.avatar) || "",
                puzzlesSolved: entry.puzzlesSolved,
                points: entry.points,
                avgCompletionTimeMs: entry.avgTime || null,
                avgCompletionTimeSec: entry.avgTime
                    ? Math.round(entry.avgTime / 1000)
                    : null,
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
// Get current month's leaderboard (monthly)
exports.getMonthlyLeaderboard = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        // Try to fetch existing monthly leaderboard
        const board = yield leaderboard_model_1.default.findOne({
            type: "monthly",
            date: monthKey,
        });
        let entries = [];
        if (board && board.entries && board.entries.length) {
            entries = board.entries.map((e, idx) => ({
                position: idx + 1,
                userId: e.userId,
                points: e.points,
                puzzlesSolved: e.puzzlesSolved || 0,
                prizeAmount: MONTHLY_PRIZES[idx] || 0,
            }));
        }
        const entriesWithUserDetails = yield Promise.all(entries.map((entry) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield user_model_1.default.findById(entry.userId)
                .select("firstName lastName username avatar")
                .lean();
            return {
                position: entry.position,
                userId: entry.userId,
                fullName: user
                    ? `${user.firstName} ${user.lastName}`
                    : "Unknown User",
                username: (user === null || user === void 0 ? void 0 : user.username) || "",
                avatar: (user === null || user === void 0 ? void 0 : user.avatar) || "",
                puzzlesSolved: entry.puzzlesSolved,
                points: entry.points,
                prizeAmount: entry.prizeAmount,
            };
        })));
        res.status(200).json({
            success: true,
            leaderboard: {
                type: "monthly",
                monthKey,
                totalPlayers: entriesWithUserDetails.length,
                entries: entriesWithUserDetails,
                jackpot: {
                    amount: 65000,
                    note: "Top 10 qualify for ₦65,000 Jackpot Draw",
                },
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// Get monthly leaderboard by monthKey (YYYY-MM)
exports.getLeaderboardByMonth = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { monthKey } = req.params; // e.g., "2026-04"
        const board = yield leaderboard_model_1.default.findOne({
            type: "monthly",
            date: monthKey,
        });
        if (!board) {
            return res
                .status(200)
                .json({
                success: true,
                leaderboard: {
                    type: "monthly",
                    monthKey,
                    totalPlayers: 0,
                    entries: [],
                },
            });
        }
        const entries = board.entries.map((e, idx) => ({
            position: idx + 1,
            userId: e.userId,
            points: e.points,
            puzzlesSolved: e.puzzlesSolved || 0,
            prizeAmount: MONTHLY_PRIZES[idx] || 0,
        }));
        const entriesWithUserDetails = yield Promise.all(entries.map((entry) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield user_model_1.default.findById(entry.userId)
                .select("firstName lastName username avatar")
                .lean();
            return {
                position: entry.position,
                userId: entry.userId,
                fullName: user
                    ? `${user.firstName} ${user.lastName}`
                    : "Unknown User",
                username: (user === null || user === void 0 ? void 0 : user.username) || "",
                avatar: (user === null || user === void 0 ? void 0 : user.avatar) || "",
                puzzlesSolved: entry.puzzlesSolved,
                points: entry.points,
                prizeAmount: entry.prizeAmount,
            };
        })));
        res
            .status(200)
            .json({
            success: true,
            leaderboard: {
                type: "monthly",
                monthKey,
                totalPlayers: entriesWithUserDetails.length,
                entries: entriesWithUserDetails,
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
                fullName: user
                    ? `${user.firstName} ${user.lastName}`
                    : "Unknown User",
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
        // Aggregate all puzzle attempts (no time filter) and compute avg completion time
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
                    avgTime: { $avg: "$timeTaken" },
                },
            },
            { $sort: { points: -1, avgTime: 1, puzzlesSolved: -1 } },
            { $limit: 100 },
        ]);
        const entries = agg.map((a) => ({
            userId: a._id,
            puzzlesSolved: a.puzzlesSolved,
            points: a.points,
            avgTime: a.avgTime || null,
        }));
        // Fetch user details for each entry
        const entriesWithUserDetails = yield Promise.all(entries.map((entry, index) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield user_model_1.default.findById(entry.userId)
                .select("firstName lastName avatar username")
                .lean();
            return {
                position: index + 1,
                userId: entry.userId,
                fullName: user
                    ? `${user.firstName} ${user.lastName}`
                    : "Unknown User",
                username: (user === null || user === void 0 ? void 0 : user.username) || "",
                avatar: (user === null || user === void 0 ? void 0 : user.avatar) || "",
                puzzlesSolved: entry.puzzlesSolved,
                points: entry.points,
                avgCompletionTimeMs: entry.avgTime || null,
                avgCompletionTimeSec: entry.avgTime
                    ? Math.round(entry.avgTime / 1000)
                    : null,
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
