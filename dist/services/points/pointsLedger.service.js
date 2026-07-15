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
exports.awardPoints = awardPoints;
exports.getUserLifetimePoints = getUserLifetimePoints;
exports.getWeeklyPointsAggregate = getWeeklyPointsAggregate;
exports.getAllTimePointsAggregate = getAllTimePointsAggregate;
exports.getUserDistinctCampaignCompletionsInWeek = getUserDistinctCampaignCompletionsInWeek;
const pointsLedger_model_1 = __importDefault(require("../../models/pointsLedger.model"));
const weekBoundary_1 = require("../../utils/weekBoundary");
const referral_service_1 = require("../referral.service");
/**
 * Single write path for every point-earning event on the platform (session
 * completions, referral bonuses, forum winner-share bonuses, admin
 * adjustments) — one ledger, one aggregation, and weekKey is stamped at
 * write time so the weekly leaderboard reset is just "query bounded by
 * week" with no explicit reset step required.
 */
function awardPoints(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const weekKey = (0, weekBoundary_1.getWeekKey)((_a = params.at) !== null && _a !== void 0 ? _a : new Date());
        const entry = yield pointsLedger_model_1.default.create({
            userId: params.userId,
            points: params.points,
            source: params.source,
            sourceRefId: params.sourceRefId,
            campaignId: params.campaignId,
            completionTimeMs: params.completionTimeMs,
            weekKey,
        });
        // Event-driven referral qualification check: if this user was referred and
        // has now crossed the points threshold, credit their referrer. Non-fatal —
        // a referral-side failure should never roll back the points that were just
        // legitimately earned.
        try {
            yield (0, referral_service_1.checkReferralQualification)(params.userId);
        }
        catch (e) {
            console.error("Referral qualification check failed:", e);
        }
        return entry;
    });
}
/** Lifetime point total for a user across all sources — used by the referral
 * 21-point qualification check. */
function getUserLifetimePoints(userId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const agg = yield pointsLedger_model_1.default.aggregate([
            { $match: { userId } },
            { $group: { _id: null, total: { $sum: "$points" } } },
        ]);
        return ((_a = agg[0]) === null || _a === void 0 ? void 0 : _a.total) || 0;
    });
}
/**
 * Per-user point totals for a given week, plus the average completion time
 * computed ONLY from session_completion entries (i.e. first completions only —
 * replays never write a ledger entry, so this is automatically first-completion-only).
 */
function getWeeklyPointsAggregate(weekKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const agg = yield pointsLedger_model_1.default.aggregate([
            { $match: { weekKey } },
            {
                $group: {
                    _id: "$userId",
                    points: { $sum: "$points" },
                    avgCompletionTimeMs: {
                        $avg: {
                            $cond: [
                                { $eq: ["$source", "session_completion"] },
                                "$completionTimeMs",
                                "$$REMOVE",
                            ],
                        },
                    },
                    sessionCompletions: {
                        $sum: {
                            $cond: [{ $eq: ["$source", "session_completion"] }, 1, 0],
                        },
                    },
                },
            },
        ]);
        return agg.map((a) => {
            var _a;
            return ({
                userId: a._id,
                points: a.points,
                avgCompletionTimeMs: (_a = a.avgCompletionTimeMs) !== null && _a !== void 0 ? _a : null,
                sessionCompletions: a.sessionCompletions || 0,
            });
        });
    });
}
/**
 * Per-user point totals across all time, plus average completion time from
 * session_completion entries only (first completions — replays never write
 * a ledger entry). Used by the all-time leaderboard.
 */
function getAllTimePointsAggregate() {
    return __awaiter(this, void 0, void 0, function* () {
        const agg = yield pointsLedger_model_1.default.aggregate([
            {
                $group: {
                    _id: "$userId",
                    points: { $sum: "$points" },
                    avgCompletionTimeMs: {
                        $avg: {
                            $cond: [
                                { $eq: ["$source", "session_completion"] },
                                "$completionTimeMs",
                                "$$REMOVE",
                            ],
                        },
                    },
                    sessionCompletions: {
                        $sum: {
                            $cond: [{ $eq: ["$source", "session_completion"] }, 1, 0],
                        },
                    },
                },
            },
        ]);
        return agg.map((a) => {
            var _a;
            return ({
                userId: a._id,
                points: a.points,
                avgCompletionTimeMs: (_a = a.avgCompletionTimeMs) !== null && _a !== void 0 ? _a : null,
                sessionCompletions: a.sessionCompletions || 0,
            });
        });
    });
}
/** Distinct campaigns a user completed (session_completion entries) within a week — used by the raffle eligibility floor. */
function getUserDistinctCampaignCompletionsInWeek(userId, weekKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield pointsLedger_model_1.default.distinct("campaignId", {
            userId,
            source: "session_completion",
            campaignId: { $ne: null },
            weekKey,
        });
        return rows;
    });
}
