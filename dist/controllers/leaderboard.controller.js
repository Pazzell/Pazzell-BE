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
const user_model_1 = __importDefault(require("../models/user.model"));
const weekBoundary_1 = require("../utils/weekBoundary");
const leaderboard_service_1 = require("../services/leaderboard.service");
const pointsLedger_service_1 = require("../services/points/pointsLedger.service");
function buildWeeklyResponseEntries(weekStart, weekEnd, weekKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const entries = yield (0, leaderboard_service_1.getUnifiedWeeklyEntries)(weekStart, weekEnd, weekKey);
        const hiddenIds = yield (0, leaderboard_service_1.getHiddenUserIds)();
        const visible = entries.filter((e) => !hiddenIds.has(String(e.userId))).slice(0, 100);
        return Promise.all(visible.map((entry, index) => __awaiter(this, void 0, void 0, function* () {
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
                avgCompletionTimeMs: entry.avgCompletionTimeMs,
                avgCompletionTimeSec: entry.avgCompletionTimeMs
                    ? Math.round(entry.avgCompletionTimeMs / 1000)
                    : null,
            };
        })));
    });
}
// Get current week's leaderboard. Aggregates points weekly and resets at week
// end (a live query bounded by the week range — no explicit reset job needed).
// Tiebreaker: lower average completion time ranks higher, computed from first
// completions only within the week (see services/leaderboard.service.ts).
exports.getWeeklyLeaderboard = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { weekStart, weekEnd, weekKey } = (0, weekBoundary_1.getWeekBounds)();
        const entriesWithUserDetails = yield buildWeeklyResponseEntries(weekStart, weekEnd, weekKey);
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
// Get leaderboard for a specific past (or current) week — computed live from
// source data, same as the current-week endpoint above.
exports.getLeaderboardByWeek = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { weekKey } = req.params;
        const { weekStart, weekEnd } = (0, weekBoundary_1.parseWeekKey)(weekKey);
        const entriesWithUserDetails = yield buildWeeklyResponseEntries(weekStart, weekEnd, weekKey);
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
// Get all-time leaderboard (lifetime PointsLedger totals — session
// completions + referral/winner-share bonuses)
exports.getAllTimeLeaderboard = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const agg = yield (0, pointsLedger_service_1.getAllTimePointsAggregate)();
        agg.sort((a, b) => {
            var _a, _b;
            if (b.points !== a.points)
                return b.points - a.points;
            const aTime = (_a = a.avgCompletionTimeMs) !== null && _a !== void 0 ? _a : Infinity;
            const bTime = (_b = b.avgCompletionTimeMs) !== null && _b !== void 0 ? _b : Infinity;
            if (aTime !== bTime)
                return aTime - bTime;
            return b.sessionCompletions - a.sessionCompletions;
        });
        const top100 = agg.slice(0, 100);
        const hiddenIds = yield (0, leaderboard_service_1.getHiddenUserIds)();
        const entries = top100
            .filter((a) => !hiddenIds.has(String(a.userId)))
            .map((a) => ({
            userId: a.userId,
            puzzlesSolved: a.sessionCompletions,
            points: a.points,
            avgTime: a.avgCompletionTimeMs,
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
