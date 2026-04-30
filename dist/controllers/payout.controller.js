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
exports.getDailyPrizeTableByDate = exports.getCurrentDailyPrizeTable = exports.getPlatformEarnings = exports.processPayouts = exports.getWeekPayouts = exports.getGamerPayouts = exports.triggerWeeklyPayoutCalculation = exports.fetchWeeklyPrizePoolSummary = exports.triggerDailyPrizePoolCalculation = exports.fetchDailyPrizePool = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const payout_model_1 = __importDefault(require("../models/payout.model"));
const user_model_1 = __importDefault(require("../models/user.model"));
const prizePool_service_1 = require("../services/prizePool.service");
const dailyPrizeTable_service_1 = require("../services/dailyPrizeTable.service");
// Get daily prize pool
exports.fetchDailyPrizePool = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { date } = req.params; // Format: "2025-01-15"
        const prizePool = yield (0, prizePool_service_1.getDailyPrizePool)(date);
        res.status(200).json({
            success: true,
            prizePool,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch daily prize pool: ${error.message}`, 500));
    }
}));
// Calculate daily prize pool (admin/cron)
exports.triggerDailyPrizePoolCalculation = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { date } = req.body; // Format: "2025-01-15"
        if (!date) {
            return next(new ErrorHandler_1.default("Date is required", 400));
        }
        const prizePool = yield (0, prizePool_service_1.calculateDailyPrizePool)(date);
        res.status(200).json({
            success: true,
            message: "Daily prize pool calculated successfully",
            prizePool,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to calculate daily prize pool: ${error.message}`, 500));
    }
}));
// Get weekly prize pool summary
exports.fetchWeeklyPrizePoolSummary = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const summary = yield (0, prizePool_service_1.getWeeklyPrizePoolSummary)();
        res.status(200).json({
            success: true,
            summary,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch weekly prize pool summary: ${error.message}`, 500));
    }
}));
// Calculate weekly payouts (admin/cron - runs on Sunday night)
exports.triggerWeeklyPayoutCalculation = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { weekKey } = req.body; // Format: "2025-01-06_to_2025-01-12"
        if (!weekKey) {
            return next(new ErrorHandler_1.default("Week key is required", 400));
        }
        const result = yield (0, prizePool_service_1.calculateWeeklyPayouts)(weekKey);
        res.status(200).json({
            success: true,
            message: "Weekly payouts calculated successfully",
            result,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to calculate weekly payouts: ${error.message}`, 500));
    }
}));
// Get gamer's payout history
exports.getGamerPayouts = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const payouts = yield payout_model_1.default.find({ userId: user._id })
            .sort({ createdAt: -1 })
            .lean();
        const totalEarnings = payouts.reduce((sum, payout) => sum + payout.amount, 0);
        res.status(200).json({
            success: true,
            payouts,
            totalEarnings,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch payout history: ${error.message}`, 500));
    }
}));
// Get specific week's payouts (admin)
exports.getWeekPayouts = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { weekKey } = req.params; // Format: "2025-01-06_to_2025-01-12"
        const payouts = yield payout_model_1.default.find({ weekKey })
            .sort({ position: 1 })
            .lean();
        // Fetch user details for each payout
        const payoutsWithUserDetails = yield Promise.all(payouts.map((payout) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield user_model_1.default.findById(payout.userId)
                .select("firstName lastName email avatar")
                .lean();
            return Object.assign(Object.assign({}, payout), { user: user
                    ? {
                        firstName: user.firstName,
                        lastName: user.lastName,
                        email: user.email,
                        avatar: user.avatar,
                    }
                    : null });
        })));
        const totalAmount = payouts.reduce((sum, payout) => sum + payout.amount, 0);
        res.status(200).json({
            success: true,
            weekKey,
            payouts: payoutsWithUserDetails,
            totalAmount,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch week payouts: ${error.message}`, 500));
    }
}));
// Mark payouts as processed (admin)
exports.processPayouts = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { weekKey, payoutIds } = req.body;
        if (!weekKey || !Array.isArray(payoutIds) || payoutIds.length === 0) {
            return next(new ErrorHandler_1.default("Week key and payout IDs array are required", 400));
        }
        // Update payouts status to processed
        const result = yield payout_model_1.default.updateMany({ _id: { $in: payoutIds }, weekKey }, {
            $set: {
                status: "processed",
                processedAt: new Date(),
            },
        });
        // Update user analytics with total earnings
        for (const payoutId of payoutIds) {
            const payout = yield payout_model_1.default.findById(payoutId);
            if (payout) {
                const user = yield user_model_1.default.findById(payout.userId);
                if (user) {
                    user.analytics.lifetime.totalEarnings =
                        (user.analytics.lifetime.totalEarnings || 0) + payout.amount;
                    yield user.save();
                }
            }
        }
        res.status(200).json({
            success: true,
            message: `${result.modifiedCount} payouts marked as processed`,
            modifiedCount: result.modifiedCount,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to process payouts: ${error.message}`, 500));
    }
}));
// Get platform earnings summary
exports.getPlatformEarnings = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return next(new ErrorHandler_1.default("Start date and end date are required", 400));
        }
        const DailyPrizePoolModel = require("../models/dailyPrizePool.model").default;
        const dailyPools = yield DailyPrizePoolModel.find({
            date: {
                $gte: startDate,
                $lte: endDate,
            },
        });
        const totalRevenue = dailyPools.reduce((sum, pool) => sum + pool.totalDailyPool, 0);
        const totalPlatformFee = dailyPools.reduce((sum, pool) => sum + pool.platformFee, 0);
        const totalGamerShare = dailyPools.reduce((sum, pool) => sum + pool.gamerShare, 0);
        res.status(200).json({
            success: true,
            period: { startDate, endDate },
            summary: {
                totalRevenue,
                totalPlatformFee,
                totalGamerShare,
                platformPercentage: 30,
                gamerPercentage: 70,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch platform earnings: ${error.message}`, 500));
    }
}));
// Get current daily prize table (real-time potential earnings)
exports.getCurrentDailyPrizeTable = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const prizeTable = yield (0, dailyPrizeTable_service_1.calculateDailyPrizeTable)();
        res.status(200).json({
            success: true,
            prizeTable,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch daily prize table: ${error.message}`, 500));
    }
}));
// Get prize table for a specific date
exports.getDailyPrizeTableByDate = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { date } = req.params; // Format: "2025-01-20"
        if (!date) {
            return next(new ErrorHandler_1.default("Date is required", 400));
        }
        const prizeTable = yield (0, dailyPrizeTable_service_1.getPrizeTableForDate)(date);
        res.status(200).json({
            success: true,
            prizeTable,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch prize table for date: ${error.message}`, 500));
    }
}));
