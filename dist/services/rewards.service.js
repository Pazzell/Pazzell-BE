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
exports.finalizeMonthlyRewards = void 0;
const puzzleAttempt_model_1 = __importDefault(require("../models/puzzleAttempt.model"));
const leaderboard_model_1 = __importDefault(require("../models/leaderboard.model"));
const rewardPayout_model_1 = __importDefault(require("../models/rewardPayout.model"));
const referral_model_1 = __importDefault(require("../models/referral.model"));
const raffleDraw_model_1 = __importDefault(require("../models/raffleDraw.model"));
// Fixed monthly payouts for top 10
const MONTHLY_TOP10 = [
    100000, 60000, 50000, 40000, 35000, 30000, 25000, 20000, 15000, 10000,
];
const REFERRAL_TOP1_PRIZE = 50000;
const RAFFLE_PRIZE = 65000;
function monthRangeFromKey(monthKey) {
    // monthKey format: YYYY-MM
    const [y, m] = monthKey.split("-").map(Number);
    const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const end = new Date(y, m, 0, 23, 59, 59, 999); // last day of month
    return { start, end };
}
const finalizeMonthlyRewards = (monthKey) => __awaiter(void 0, void 0, void 0, function* () {
    const { start, end } = monthRangeFromKey(monthKey);
    // 1) Compute monthly top 10 by points (firstTimeSolved within month)
    const agg = yield puzzleAttempt_model_1.default.aggregate([
        {
            $match: {
                firstTimeSolved: true,
                timestamp: { $gte: start, $lte: end },
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
        { $limit: 10 },
    ]);
    const top10 = agg.map((a, idx) => ({
        userId: a._id,
        position: idx + 1,
        points: a.points,
        puzzlesSolved: a.puzzlesSolved,
        avgTime: a.avgTime || null,
    }));
    // Save monthly leaderboard
    const monthKeyStr = monthKey;
    yield leaderboard_model_1.default.findOneAndUpdate({ type: "monthly", date: monthKeyStr }, {
        type: "monthly",
        date: monthKeyStr,
        entries: top10.map((t) => ({
            userId: t.userId,
            puzzlesSolved: t.puzzlesSolved,
            points: t.points,
        })),
    }, { upsert: true });
    const payouts = [];
    // 2) Create reward payouts for top 10 (fixed amounts)
    for (const t of top10) {
        const amount = MONTHLY_TOP10[t.position - 1] || 0;
        const payout = yield rewardPayout_model_1.default.findOneAndUpdate({ userId: t.userId, monthKey: monthKeyStr, type: "points" }, {
            userId: t.userId,
            monthKey: monthKeyStr,
            type: "points",
            position: t.position,
            amount,
            currency: "NGN",
            status: "pending",
        }, { upsert: true, new: true });
        payouts.push(payout);
    }
    // 3) Referral leaderboard - count successful referrals where success happened within the month (successfulAt within range)
    const referralAgg = yield referral_model_1.default.aggregate([
        { $match: { successful: true, successfulAt: { $gte: start, $lte: end } } },
        { $group: { _id: "$referrerId", successfulCount: { $sum: 1 } } },
        { $sort: { successfulCount: -1 } },
        { $limit: 100 },
    ]);
    const referralTop = referralAgg.map((r, idx) => ({
        userId: r._id,
        rank: idx + 1,
        successfulCount: r.successfulCount,
    }));
    // award top referral 1st place
    if (referralTop.length > 0) {
        const topRef = referralTop[0];
        const refPayout = yield rewardPayout_model_1.default.findOneAndUpdate({ userId: topRef.userId, monthKey: monthKeyStr, type: "referral" }, {
            userId: topRef.userId,
            monthKey: monthKeyStr,
            type: "referral",
            amount: REFERRAL_TOP1_PRIZE,
            currency: "NGN",
            status: "pending",
        }, { upsert: true, new: true });
        payouts.push(refPayout);
    }
    // 4) Jackpot raffle: pick one random from top10 candidates
    if (top10.length > 0) {
        const candidates = top10.map((t) => t.userId);
        // check if a raffle draw already exists for the month
        let existingDraw = yield raffleDraw_model_1.default.findOne({ monthKey: monthKeyStr });
        if (!existingDraw) {
            // fair random selection
            const winnerIndex = Math.floor(Math.random() * candidates.length);
            const winner = candidates[winnerIndex];
            const draw = yield raffleDraw_model_1.default.create({
                monthKey: monthKeyStr,
                candidates,
                winner,
                amount: RAFFLE_PRIZE,
                drawnAt: new Date(),
            });
            const rafflePayout = yield rewardPayout_model_1.default.findOneAndUpdate({ userId: winner, monthKey: monthKeyStr, type: "raffle" }, {
                userId: winner,
                monthKey: monthKeyStr,
                type: "raffle",
                amount: RAFFLE_PRIZE,
                currency: "NGN",
                status: "pending",
            }, { upsert: true, new: true });
            payouts.push(rafflePayout);
            existingDraw = draw;
        }
    }
    // 5) Freeze/mark monthly snapshot (you may extend with more fields)
    // Return summary
    return {
        monthKey: monthKeyStr,
        top10,
        referralTop: referralTop.slice(0, 10),
        payoutsCreated: payouts.length,
    };
});
exports.finalizeMonthlyRewards = finalizeMonthlyRewards;
