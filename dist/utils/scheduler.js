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
exports.checkExpiredCampaigns = exports.startScheduler = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const leaderboard_model_1 = __importDefault(require("../models/leaderboard.model"));
const puzzleAttempt_model_1 = __importDefault(require("../models/puzzleAttempt.model"));
const puzzleCampaign_model_1 = __importDefault(require("../models/puzzleCampaign.model"));
// Weekly leaderboard scheduler
const startScheduler = () => {
    // Run once per day at midnight to check if we need to finalize the weekly leaderboard
    const dailyCheckInterval = 24 * 60 * 60 * 1000; // 24 hours
    const hourlyCheckInterval = 60 * 60 * 1000; // 1 hour
    // Daily scheduler for weekly leaderboard
    setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            // Skip if database is not connected
            if (mongoose_1.default.connection.readyState !== 1) {
                return;
            }
            const now = new Date();
            // Check if it's Sunday (end of week)
            if (now.getDay() === 0) {
                // Calculate the week's date range (Monday to Sunday)
                const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const weekStart = new Date(weekEnd);
                weekStart.setDate(weekStart.getDate() - 6); // Go back 6 days to Monday
                // Get all first-time solved attempts from this week
                const weeklyAttempts = yield puzzleAttempt_model_1.default.aggregate([
                    {
                        $match: {
                            firstTimeSolved: true,
                            timestamp: { $gte: weekStart, $lt: weekEnd },
                        },
                    },
                    {
                        $group: {
                            _id: "$userId",
                            puzzlesSolved: { $sum: 1 },
                            points: { $sum: "$pointsEarned" },
                        },
                    },
                    { $sort: { puzzlesSolved: -1, points: -1 } },
                    { $limit: 100 },
                ]);
                const entries = weeklyAttempts.map((a) => ({
                    userId: a._id,
                    puzzlesSolved: a.puzzlesSolved,
                    points: a.points,
                }));
                // Create weekly leaderboard
                const weekKey = `${weekStart.toISOString().slice(0, 10)}_to_${weekEnd.toISOString().slice(0, 10)}`;
                yield leaderboard_model_1.default.findOneAndUpdate({ type: "weekly", date: weekKey }, { type: "weekly", date: weekKey, entries }, { upsert: true });
                console.log(`Created weekly leaderboard for week: ${weekKey}`);
            }
        }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error("Scheduler error:", err);
        }
    }), dailyCheckInterval);
    // Hourly scheduler for checking expired campaigns
    setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield (0, exports.checkExpiredCampaigns)();
        }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error("Campaign expiry check error:", err);
        }
    }), hourlyCheckInterval);
    // Run expired campaign check immediately on startup
    (0, exports.checkExpiredCampaigns)();
};
exports.startScheduler = startScheduler;
// Check and mark expired campaigns as ended
const checkExpiredCampaigns = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Skip if database is not connected
        if (mongoose_1.default.connection.readyState !== 1) {
            return;
        }
        const now = new Date();
        // Find all active campaigns that have passed their end date
        // Only auto-end campaigns that have been paid for
        const result = yield puzzleCampaign_model_1.default.updateMany({
            status: "active",
            paymentStatus: "paid", // Only end paid campaigns
            endDate: { $lt: now },
        }, {
            $set: { status: "ended" },
        });
        if (result.modifiedCount > 0) {
            console.log(`✅ Marked ${result.modifiedCount} campaign(s) as ended`);
        }
    }
    catch (error) {
        console.error("Error checking expired campaigns:", error);
    }
});
exports.checkExpiredCampaigns = checkExpiredCampaigns;
