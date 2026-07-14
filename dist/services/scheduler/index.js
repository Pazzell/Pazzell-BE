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
exports.runWeeklyRollover = runWeeklyRollover;
exports.runHourlyCampaignExpiry = runHourlyCampaignExpiry;
exports.runNightlyWalletReconciliation = runNightlyWalletReconciliation;
exports.startScheduler = startScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const mongoose_1 = __importDefault(require("mongoose"));
const raffleTicket_model_1 = __importDefault(require("../../models/raffleTicket.model"));
const scheduler_1 = require("../../utils/scheduler");
const prizePool_service_1 = require("../prizePool.service");
const raffle_service_1 = require("../raffle.service");
const wallet_service_1 = require("../wallet/wallet.service");
const weekBoundary_1 = require("../../utils/weekBoundary");
/**
 * Consolidated node-cron scheduler — replaces the hand-rolled setInterval
 * jobs (utils/scheduler.ts's old startScheduler, and the monthly-leaderboard
 * setTimeout chain that used to live in server.ts) with discrete, legible
 * cron-scheduled jobs. No explicit "leaderboard reset" job is needed: the
 * weekly leaderboard is a live query bounded by the week range (see
 * services/leaderboard.service.ts), so the reset is implicit once the
 * boundary passes.
 */
function runWeeklyRollover() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (mongoose_1.default.connection.readyState !== 1)
            return;
        const weekKey = (0, weekBoundary_1.getPreviousWeekKey)();
        try {
            const result = yield (0, prizePool_service_1.calculateWeeklyPayouts)(weekKey);
            console.log(`Weekly payouts calculated for ${weekKey}: ${(_b = (_a = result.payouts) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0} payout(s), revenue=${result.totalRevenue}`);
        }
        catch (err) {
            console.error(`Weekly payout calculation failed for ${weekKey}:`, err);
        }
        try {
            // Only campaigns that actually sold a ticket that week need a draw.
            const campaignIds = yield raffleTicket_model_1.default.distinct("campaignId", { weekKey });
            for (const campaignId of campaignIds) {
                try {
                    yield (0, raffle_service_1.runDraw)(campaignId, weekKey);
                }
                catch (err) {
                    console.error(`Raffle draw failed for campaign ${campaignId}, week ${weekKey}:`, err);
                }
            }
            console.log(`Weekly raffle draws completed for ${weekKey}: ${campaignIds.length} campaign(s)`);
        }
        catch (err) {
            console.error(`Weekly raffle draw lookup failed for ${weekKey}:`, err);
        }
    });
}
function runHourlyCampaignExpiry() {
    return __awaiter(this, void 0, void 0, function* () {
        if (mongoose_1.default.connection.readyState !== 1)
            return;
        yield (0, scheduler_1.checkExpiredCampaigns)();
    });
}
function runNightlyWalletReconciliation() {
    return __awaiter(this, void 0, void 0, function* () {
        if (mongoose_1.default.connection.readyState !== 1)
            return;
        try {
            const result = yield (0, wallet_service_1.reconcileAllWallets)();
            if (result.corrected > 0) {
                console.log(`Wallet reconciliation corrected ${result.corrected}/${result.checked} wallet(s)`);
            }
        }
        catch (err) {
            console.error("Wallet reconciliation failed:", err);
        }
    });
}
let started = false;
function startScheduler() {
    if (started)
        return;
    started = true;
    // Monday 00:00 — weekly payout calculation + per-campaign raffle draws for the week that just ended
    node_cron_1.default.schedule("0 0 * * 1", () => {
        runWeeklyRollover().catch((err) => console.error("Weekly rollover error:", err));
    });
    // Hourly — campaign auto-complete/expiry
    node_cron_1.default.schedule("0 * * * *", () => {
        runHourlyCampaignExpiry().catch((err) => console.error("Campaign expiry check error:", err));
    });
    // Nightly at 03:00 — wallet ledger reconciliation (defense-in-depth against the narrow
    // crash window described in services/wallet/wallet.service.ts)
    node_cron_1.default.schedule("0 3 * * *", () => {
        runNightlyWalletReconciliation().catch((err) => console.error("Wallet reconciliation error:", err));
    });
    // Run the expiry check immediately on startup, same as the old hand-rolled scheduler did.
    runHourlyCampaignExpiry().catch((err) => console.error("Campaign expiry check error:", err));
}
