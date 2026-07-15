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
exports.getMyReferralStats = exports.getReferralEvents = exports.getReferralSummary = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const referral_model_1 = __importDefault(require("../models/referral.model"));
const referralEvent_model_1 = __importDefault(require("../models/referralEvent.model"));
const user_model_1 = __importDefault(require("../models/user.model"));
function monthRangeFromKey(monthKey) {
    const [y, m] = monthKey.split("-").map(Number);
    const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const end = new Date(y, m, 0, 23, 59, 59, 999);
    return { start, end };
}
// GET /referrals/summary?month=YYYY-MM&limit=20
// Admin/public: top referrers for a given month
exports.getReferralSummary = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const monthKey = req.query.month || new Date().toISOString().slice(0, 7);
        const limit = parseInt(req.query.limit || "100", 10);
        const { start, end } = monthRangeFromKey(monthKey);
        const agg = yield referral_model_1.default.aggregate([
            {
                $match: {
                    successful: true,
                    successfulAt: { $gte: start, $lte: end },
                },
            },
            {
                $group: {
                    _id: "$referrerId",
                    successfulCount: { $sum: 1 },
                    pointsEarned: { $sum: "$pointsAwarded" },
                    referred: { $push: "$referredUserId" },
                },
            },
            { $sort: { successfulCount: -1 } },
            { $limit: limit },
        ]);
        const results = yield Promise.all(agg.map((row, idx) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield user_model_1.default.findById(row._id)
                .select("firstName lastName username email avatar")
                .lean();
            return {
                rank: idx + 1,
                user: user || { userId: row._id },
                successfulCount: row.successfulCount,
                pointsEarned: row.pointsEarned || 0,
                referredUserIds: row.referred,
            };
        })));
        res
            .status(200)
            .json({ success: true, month: monthKey, summary: results });
    }
    catch (err) {
        return next(new ErrorHandler_1.default(err.message || "Failed to get referral summary", 500));
    }
}));
// GET /referrals/events?month=YYYY-MM&eventType=signup|first_puzzle
exports.getReferralEvents = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const monthKey = req.query.month || new Date().toISOString().slice(0, 7);
        const eventType = req.query.eventType || undefined;
        const { start, end } = monthRangeFromKey(monthKey);
        const filter = { eventAt: { $gte: start, $lte: end } };
        if (eventType)
            filter.eventType = eventType;
        const events = yield referralEvent_model_1.default.find(filter)
            .sort({ eventAt: -1 })
            .lean();
        res
            .status(200)
            .json({ success: true, month: monthKey, count: events.length, events });
    }
    catch (err) {
        return next(new ErrorHandler_1.default(err.message || "Failed to get referral events", 500));
    }
}));
// GET /referrals/my-stats?month=YYYY-MM
// Authenticated user: own referral count and points for a given month
exports.getMyReferralStats = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (!user)
            return next(new ErrorHandler_1.default("User not authenticated", 401));
        const userId = String(user._id);
        const monthKey = req.query.month || new Date().toISOString().slice(0, 7);
        const { start, end } = monthRangeFromKey(monthKey);
        // Total referrals created by this user (all time)
        const totalReferrals = yield referral_model_1.default.countDocuments({
            referrerId: userId,
        });
        // Successful referrals this month
        const successfulThisMonth = yield referral_model_1.default.find({
            referrerId: userId,
            successful: true,
            successfulAt: { $gte: start, $lte: end },
        }).lean();
        const referralPointsThisMonth = successfulThisMonth.reduce((sum, r) => sum + (r.pointsAwarded || 0), 0);
        // All successful referrals ever
        const allSuccessful = yield referral_model_1.default.find({
            referrerId: userId,
            successful: true,
        }).lean();
        const totalReferralPoints = allSuccessful.reduce((sum, r) => sum + (r.pointsAwarded || 0), 0);
        // Pending (not yet successful) referrals
        const pendingReferrals = yield referral_model_1.default.countDocuments({
            referrerId: userId,
            successful: false,
        });
        // Enrich referred users list for this month
        const referredUsers = yield Promise.all(successfulThisMonth.map((r) => __awaiter(void 0, void 0, void 0, function* () {
            const refUser = yield user_model_1.default.findById(r.referredUserId)
                .select("firstName lastName username avatar")
                .lean();
            return {
                userId: r.referredUserId,
                fullName: refUser
                    ? `${refUser.firstName} ${refUser.lastName}`
                    : "Unknown",
                username: (refUser === null || refUser === void 0 ? void 0 : refUser.username) || "",
                avatar: (refUser === null || refUser === void 0 ? void 0 : refUser.avatar) || "",
                successfulAt: r.successfulAt,
                pointsAwarded: r.pointsAwarded,
            };
        })));
        res.status(200).json({
            success: true,
            month: monthKey,
            stats: {
                totalReferrals,
                pendingReferrals,
                successfulReferralsThisMonth: successfulThisMonth.length,
                referralPointsThisMonth,
                totalReferralPointsAllTime: totalReferralPoints,
                referredUsersThisMonth: referredUsers,
            },
        });
    }
    catch (err) {
        return next(new ErrorHandler_1.default(err.message || "Failed to get referral stats", 500));
    }
}));
exports.default = {};
