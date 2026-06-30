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
const referral_model_1 = __importDefault(require("../models/referral.model"));
// Get current week's leaderboard (puzzle points only — no referral breakdown for weekly)
exports.getWeeklyLeaderboard = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysFromMonday);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        const agg = yield puzzleAttempt_model_1.default.aggregate([
            {
                $match: {
                    pointsEarned: { $gt: 0 },
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
        const weekKey = `${weekStart.toISOString().slice(0, 10)}_to_${weekEnd
            .toISOString()
            .slice(0, 10)}`;
        yield leaderboard_model_1.default.findOneAndUpdate({ type: "weekly", date: weekKey }, { type: "weekly", date: weekKey, entries }, { upsert: true });
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
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// Build monthly leaderboard entries for a given month range (live computation)
function buildMonthlyEntries(monthStart, monthEnd) {
    return __awaiter(this, void 0, void 0, function* () {
        // Puzzle points earned this month
        const puzzleAgg = yield puzzleAttempt_model_1.default.aggregate([
            {
                $match: {
                    pointsEarned: { $gt: 0 },
                    timestamp: { $gte: monthStart, $lte: monthEnd },
                },
            },
            {
                $group: {
                    _id: "$userId",
                    puzzlePoints: { $sum: "$pointsEarned" },
                    puzzlesSolved: { $sum: 1 },
                },
            },
        ]);
        // Referral bonus points earned this month (when referral became successful)
        const referralAgg = yield referral_model_1.default.aggregate([
            {
                $match: {
                    successful: true,
                    successfulAt: { $gte: monthStart, $lte: monthEnd },
                },
            },
            {
                $group: {
                    _id: "$referrerId",
                    referralPoints: { $sum: "$pointsAwarded" },
                    referralCount: { $sum: 1 },
                },
            },
        ]);
        // Merge puzzle and referral points by userId
        const userMap = new Map();
        for (const p of puzzleAgg) {
            userMap.set(String(p._id), {
                puzzlePoints: p.puzzlePoints,
                puzzlesSolved: p.puzzlesSolved,
                referralPoints: 0,
                referralCount: 0,
            });
        }
        for (const r of referralAgg) {
            const uid = String(r._id);
            const existing = userMap.get(uid) || {
                puzzlePoints: 0,
                puzzlesSolved: 0,
                referralPoints: 0,
                referralCount: 0,
            };
            existing.referralPoints = r.referralPoints;
            existing.referralCount = r.referralCount;
            userMap.set(uid, existing);
        }
        // Sort by totalPoints desc, then puzzlePoints desc
        return Array.from(userMap.entries())
            .map(([userId, data]) => ({
            userId,
            puzzlePoints: data.puzzlePoints,
            puzzlesSolved: data.puzzlesSolved,
            referralPoints: data.referralPoints,
            referralCount: data.referralCount,
            totalPoints: data.puzzlePoints + data.referralPoints,
        }))
            .sort((a, b) => b.totalPoints - a.totalPoints || b.puzzlePoints - a.puzzlePoints)
            .slice(0, 100);
    });
}
// Get current month's leaderboard
exports.getMonthlyLeaderboard = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        const entries = yield buildMonthlyEntries(monthStart, monthEnd);
        // Cache snapshot
        yield leaderboard_model_1.default.findOneAndUpdate({ type: "monthly", date: monthKey }, {
            type: "monthly",
            date: monthKey,
            entries: entries.map((e) => ({
                userId: e.userId,
                puzzlesSolved: e.puzzlesSolved,
                points: e.totalPoints,
            })),
        }, { upsert: true });
        const entriesWithUserDetails = yield Promise.all(entries.map((entry, idx) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield user_model_1.default.findById(entry.userId)
                .select("firstName lastName username avatar")
                .lean();
            return {
                position: idx + 1,
                userId: entry.userId,
                fullName: user
                    ? `${user.firstName} ${user.lastName}`
                    : "Unknown User",
                username: (user === null || user === void 0 ? void 0 : user.username) || "",
                avatar: (user === null || user === void 0 ? void 0 : user.avatar) || "",
                puzzlesSolved: entry.puzzlesSolved,
                puzzlePoints: entry.puzzlePoints,
                referralPoints: entry.referralPoints,
                referralCount: entry.referralCount,
                totalPoints: entry.totalPoints,
            };
        })));
        res.status(200).json({
            success: true,
            leaderboard: {
                type: "monthly",
                monthKey,
                resetsAt: `End of ${monthKey}`,
                totalPlayers: entriesWithUserDetails.length,
                entries: entriesWithUserDetails,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// Get monthly leaderboard by monthKey (YYYY-MM) — computed live from source data
exports.getLeaderboardByMonth = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { monthKey } = req.params;
        const [y, m] = monthKey.split("-").map(Number);
        const monthStart = new Date(y, m - 1, 1);
        const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);
        const entries = yield buildMonthlyEntries(monthStart, monthEnd);
        const entriesWithUserDetails = yield Promise.all(entries.map((entry, idx) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield user_model_1.default.findById(entry.userId)
                .select("firstName lastName username avatar")
                .lean();
            return {
                position: idx + 1,
                userId: entry.userId,
                fullName: user
                    ? `${user.firstName} ${user.lastName}`
                    : "Unknown User",
                username: (user === null || user === void 0 ? void 0 : user.username) || "",
                avatar: (user === null || user === void 0 ? void 0 : user.avatar) || "",
                puzzlesSolved: entry.puzzlesSolved,
                puzzlePoints: entry.puzzlePoints,
                referralPoints: entry.referralPoints,
                referralCount: entry.referralCount,
                totalPoints: entry.totalPoints,
            };
        })));
        res.status(200).json({
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
        const { weekKey } = req.params;
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
// Get all-time leaderboard (puzzle points only)
exports.getAllTimeLeaderboard = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const agg = yield puzzleAttempt_model_1.default.aggregate([
            {
                $match: {
                    pointsEarned: { $gt: 0 },
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
