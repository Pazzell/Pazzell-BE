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
exports.checkAbandonedSessions = exports.checkExpiredCampaigns = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const puzzleCampaign_model_1 = __importDefault(require("../models/puzzleCampaign.model"));
const gameSession_model_1 = __importDefault(require("../models/gameSession.model"));
// Sessions are meant to be played in one sitting (4 games + video + quiz).
// Anything still "in_progress" this long after it started was walked away
// from, not just slow.
const ABANDONED_SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
// Check and mark expired campaigns as ended. Scheduled hourly via
// services/scheduler/index.ts (node-cron) — this file just holds the check
// itself, reused by both the cron job and campaign.controller.ts's
// pre-read expiry sweep.
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
// Mark stale in_progress sessions as abandoned. They're already excluded
// from live stats (which only count status:"completed"), but without this
// they'd linger as "in_progress" forever, and completeSession() rejects
// abandoned sessions the same way it does voided ones — so a player who
// walks away and comes back after the TTL gets a clean "start over" instead
// of silently resuming a stale session.
const checkAbandonedSessions = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return;
        }
        const cutoff = new Date(Date.now() - ABANDONED_SESSION_TTL_MS);
        const result = yield gameSession_model_1.default.updateMany({
            status: "in_progress",
            startedAt: { $lt: cutoff },
        }, {
            $set: { status: "abandoned" },
        });
        if (result.modifiedCount > 0) {
            console.log(`✅ Marked ${result.modifiedCount} session(s) as abandoned`);
        }
    }
    catch (error) {
        console.error("Error checking abandoned sessions:", error);
    }
});
exports.checkAbandonedSessions = checkAbandonedSessions;
