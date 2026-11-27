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
exports.getWeeklyPrizePoolSummary = exports.calculateWeeklyPayouts = void 0;
exports.getWeeklyRevenue = getWeeklyRevenue;
const payout_model_1 = __importDefault(require("../models/payout.model"));
const transaction_model_1 = __importDefault(require("../models/transaction.model"));
const weekBoundary_1 = require("../utils/weekBoundary");
const leaderboard_service_1 = require("./leaderboard.service");
const config_service_1 = require("./config/config.service");
/**
 * Weekly revenue = sum of successful campaign payments (Transaction.amount)
 * within the week — replaces the old daily-drip DailyPrizePoolModel
 * mechanism (fed by campaign.dailyAllocation), which was built for the old
 * hours/month campaign-duration model and no longer reflects "that week's
 * campaign revenue" in a way that maps cleanly to the weekly billing revert.
 */
function getWeeklyRevenue(weekStart, weekEnd) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const agg = yield transaction_model_1.default.aggregate([
            {
                $match: {
                    status: "success",
                    createdAt: { $gte: weekStart, $lte: weekEnd },
                },
            },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);
        return ((_a = agg[0]) === null || _a === void 0 ? void 0 : _a.total) || 0;
    });
}
/**
 * Calculates and upserts weekly cash-reward Payout rows for the top 10
 * players that week. Player/platform split and rank distribution percentages
 * are Config-driven (default 50/50 split, may move to 60/40 later — see
 * services/config/config.service.ts) rather than hardcoded, and both are
 * snapshotted onto each Payout row for audit even if Config changes later.
 *
 * Top-10 selection reuses the exact same unified weekly leaderboard source
 * (services/leaderboard.service.ts) that the public leaderboard displays —
 * previously the payout calculation had its own independent aggregation
 * pipeline (sorted puzzlesSolved desc/points desc, no time tiebreaker) that
 * could silently disagree with what players saw on the leaderboard.
 */
const calculateWeeklyPayouts = (weekKey) => __awaiter(void 0, void 0, void 0, function* () {
    const { weekStart, weekEnd } = (0, weekBoundary_1.parseWeekKey)(weekKey);
    const totalRevenue = yield getWeeklyRevenue(weekStart, weekEnd);
    const { playerSharePercent, platformSharePercent } = yield (0, config_service_1.getPayoutSplit)();
    const playerPool = Math.round((totalRevenue * playerSharePercent) / 100 * 100) / 100;
    const platformShare = Math.round((totalRevenue * platformSharePercent) / 100 * 100) / 100;
    const entries = yield (0, leaderboard_service_1.getUnifiedWeeklyEntries)(weekStart, weekEnd, weekKey);
    const top10 = entries.slice(0, 10);
    if (top10.length === 0) {
        return { weekKey, totalRevenue, playerPool, platformShare, payouts: [] };
    }
    const rankDistribution = yield (0, config_service_1.getRankDistribution)();
    const payouts = [];
    for (let i = 0; i < top10.length; i++) {
        const gamer = top10[i];
        const position = i + 1;
        const distribution = rankDistribution[i];
        if (!distribution)
            break; // fewer configured ranks than players (shouldn't happen with 10 configured)
        const amount = Math.round(((playerPool * distribution.percentage) / 100) * 100) / 100;
        const payout = yield payout_model_1.default.findOneAndUpdate({ userId: gamer.userId, weekKey }, {
            userId: gamer.userId,
            weekKey,
            position,
            points: gamer.points,
            puzzlesSolved: gamer.puzzlesSolved,
            totalDailyPool: totalRevenue,
            gamerShare: playerPool,
            weeklyRevenue: totalRevenue,
            distributionPercentage: distribution.percentage,
            amount,
            currency: "NGN",
            status: "pending",
            playerSharePercent,
            platformSharePercent,
        }, { upsert: true, new: true });
        payouts.push(payout);
    }
    return { weekKey, totalRevenue, playerPool, platformShare, payouts };
});
exports.calculateWeeklyPayouts = calculateWeeklyPayouts;
/** Current week's prize pool preview (before Monday's finalization). */
const getWeeklyPrizePoolSummary = () => __awaiter(void 0, void 0, void 0, function* () {
    const { weekStart, weekEnd, weekKey } = (0, weekBoundary_1.getWeekBounds)();
    const totalRevenue = yield getWeeklyRevenue(weekStart, weekEnd);
    const { playerSharePercent, platformSharePercent } = yield (0, config_service_1.getPayoutSplit)();
    return {
        weekKey,
        weekStart,
        weekEnd,
        totalRevenue,
        playerPool: Math.round((totalRevenue * playerSharePercent) / 100 * 100) / 100,
        platformShare: Math.round((totalRevenue * platformSharePercent) / 100 * 100) / 100,
        playerSharePercent,
        platformSharePercent,
    };
});
exports.getWeeklyPrizePoolSummary = getWeeklyPrizePoolSummary;
