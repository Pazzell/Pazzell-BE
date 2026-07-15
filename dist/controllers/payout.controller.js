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
exports.getPlatformEarnings = exports.processPayouts = exports.getWeekPayouts = exports.getGamerPayouts = exports.triggerWeeklyPayoutCalculation = exports.fetchWeeklyPrizePoolSummary = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const payout_model_1 = __importDefault(require("../models/payout.model"));
const user_model_1 = __importDefault(require("../models/user.model"));
const transaction_model_1 = __importDefault(require("../models/transaction.model"));
const prizePool_service_1 = require("../services/prizePool.service");
const wallet_service_1 = require("../services/wallet/wallet.service");
// Get weekly prize pool summary (current week, live preview)
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
// Calculate weekly payouts (admin/cron - runs on Monday, see services/scheduler)
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
// Mark payouts as paid (admin) — credits each payout's amount to the
// player's wallet (idempotent via `payout:${payoutId}` ledger key) and
// advances status straight to "paid". Previously this only flipped a status
// field and bumped a dead `analytics.lifetime.totalEarnings` counter without
// ever moving real money — now it's the actual crediting step.
exports.processPayouts = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { weekKey, payoutIds } = req.body;
        if (!weekKey || !Array.isArray(payoutIds) || payoutIds.length === 0) {
            return next(new ErrorHandler_1.default("Week key and payout IDs array are required", 400));
        }
        const payouts = yield payout_model_1.default.find({
            _id: { $in: payoutIds },
            weekKey,
        });
        let processedCount = 0;
        for (const payout of payouts) {
            if (payout.status === "paid")
                continue; // already processed, idempotent no-op
            const ledgerEntry = yield (0, wallet_service_1.credit)({
                userId: payout.userId,
                amount: payout.amount,
                reason: "weekly_payout",
                referenceId: String(payout._id),
                idempotencyKey: `payout:${payout._id}`,
            });
            payout.status = "paid";
            payout.processedAt = new Date();
            payout.walletTransactionId = String(ledgerEntry._id);
            yield payout.save();
            processedCount++;
        }
        res.status(200).json({
            success: true,
            message: `${processedCount} payout(s) credited to player wallets`,
            processedCount,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to process payouts: ${error.message}`, 500));
    }
}));
// Get platform earnings summary (revenue collected vs. player pool paid out)
exports.getPlatformEarnings = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return next(new ErrorHandler_1.default("Start date and end date are required", 400));
        }
        const revenueAgg = yield transaction_model_1.default.aggregate([
            {
                $match: {
                    status: "success",
                    createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
                },
            },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);
        const totalRevenue = ((_a = revenueAgg[0]) === null || _a === void 0 ? void 0 : _a.total) || 0;
        const payoutAgg = yield payout_model_1.default.aggregate([
            {
                $match: {
                    createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
                },
            },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);
        const totalPlayerPayouts = ((_b = payoutAgg[0]) === null || _b === void 0 ? void 0 : _b.total) || 0;
        res.status(200).json({
            success: true,
            period: { startDate, endDate },
            summary: {
                totalRevenue,
                totalPlayerPayouts,
                platformRetained: totalRevenue - totalPlayerPayouts,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch platform earnings: ${error.message}`, 500));
    }
}));
