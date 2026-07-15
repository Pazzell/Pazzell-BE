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
exports.getUnifiedWeeklyEntries = getUnifiedWeeklyEntries;
exports.getHiddenUserIds = getHiddenUserIds;
exports.getUserWeeklyRank = getUserWeeklyRank;
const user_model_1 = __importDefault(require("../models/user.model"));
const pointsLedger_service_1 = require("./points/pointsLedger.service");
/**
 * The single source of truth for "the weekly leaderboard" — points from
 * PointsLedgerModel (session completions + referral/winner-share bonuses).
 * Previously there were four independent, subtly-inconsistent sort
 * implementations across leaderboard.controller.ts, prizePool.service.ts,
 * user.controller.ts, and rewards.service.ts — this replaces all of them.
 *
 * Tiebreaker (lower average completion time ranks higher) is computed from
 * `session_completion` ledger entries, which, by construction via the
 * GameSession first-completion guard, only ever exist for genuine first
 * completions — replays never write a ledger entry.
 */
function getUnifiedWeeklyEntries(weekStart, weekEnd, weekKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const ledgerEntries = yield (0, pointsLedger_service_1.getWeeklyPointsAggregate)(weekKey);
        const entries = ledgerEntries.map((e) => ({
            userId: e.userId,
            points: e.points,
            puzzlesSolved: e.sessionCompletions,
            avgCompletionTimeMs: e.avgCompletionTimeMs,
        }));
        entries.sort((a, b) => {
            var _a, _b;
            if (b.points !== a.points)
                return b.points - a.points;
            const aTime = (_a = a.avgCompletionTimeMs) !== null && _a !== void 0 ? _a : Infinity;
            const bTime = (_b = b.avgCompletionTimeMs) !== null && _b !== void 0 ? _b : Infinity;
            return aTime - bTime;
        });
        return entries;
    });
}
function getHiddenUserIds() {
    return __awaiter(this, void 0, void 0, function* () {
        const hiddenUsers = yield user_model_1.default.find({ "privacy.showOnLeaderboard": false }, { _id: 1 }).lean();
        return new Set(hiddenUsers.map((u) => String(u._id)));
    });
}
/** 1-indexed rank of `userId` within the given week's leaderboard, or null if absent. */
function getUserWeeklyRank(userId, weekStart, weekEnd, weekKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const entries = yield getUnifiedWeeklyEntries(weekStart, weekEnd, weekKey);
        const idx = entries.findIndex((e) => String(e.userId) === String(userId));
        return idx === -1 ? null : idx + 1;
    });
}
