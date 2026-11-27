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
exports.mintTicketOnFirstCompletion = mintTicketOnFirstCompletion;
exports.getEligibilityFloor = getEligibilityFloor;
exports.isEligibleThisWeek = isEligibleThisWeek;
exports.runDraw = runDraw;
exports.verifyDraw = verifyDraw;
const crypto_1 = __importDefault(require("crypto"));
const raffleTicket_model_1 = __importDefault(require("../models/raffleTicket.model"));
const raffleDraw_model_1 = __importDefault(require("../models/raffleDraw.model"));
const puzzleCampaign_model_1 = __importDefault(require("../models/puzzleCampaign.model"));
const config_service_1 = require("./config/config.service");
const pointsLedger_service_1 = require("./points/pointsLedger.service");
/**
 * Mints a raffle ticket for a first completion. Called from
 * gameSession.service.ts completeSession() right after the flat points award —
 * a no-op (idempotent) if a ticket for this user+campaign already exists,
 * since the unique {userId, campaignId} index guarantees one ticket ever per
 * player per campaign regardless of how many times this is called.
 */
function mintTicketOnFirstCompletion(userId, campaignId, sessionId, weekKey) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield raffleTicket_model_1.default.create({
                userId,
                campaignId,
                weekKey,
                sourceSessionId: sessionId,
            });
        }
        catch (e) {
            if (e.code === 11000)
                return null; // already has a ticket for this campaign
            throw e;
        }
    });
}
/**
 * N = lesser of the configured cap (default 3) or the number of platform-wide
 * active campaigns. A player becomes eligible for ANY draw that week once
 * they've completed at least N distinct campaigns that week — banked tickets
 * for campaigns beyond that don't require anything further once the floor is met.
 */
function getEligibilityFloor() {
    return __awaiter(this, void 0, void 0, function* () {
        const cap = yield (0, config_service_1.getRaffleEligibilityFloorCap)();
        const activeCampaignCount = yield puzzleCampaign_model_1.default.countDocuments({
            status: "active",
        });
        return Math.min(cap, activeCampaignCount || 0);
    });
}
function isEligibleThisWeek(userId, weekKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const floor = yield getEligibilityFloor();
        if (floor <= 0)
            return true; // no active campaigns to require completions against
        const distinctCampaigns = yield (0, pointsLedger_service_1.getUserDistinctCampaignCompletionsInWeek)(userId, weekKey);
        return distinctCampaigns.length >= floor;
    });
}
/**
 * Provably-random draw: seed = crypto.randomBytes(32); ticket holders are
 * sorted deterministically (lexicographically by userId) before indexing;
 * winnerIndex = HMAC-SHA256(seed, campaignId:weekKey) mod eligibleList.length.
 * Anyone can recompute the same winnerIndex from the stored seed + the
 * snapshotted eligible-ticket list + this documented algorithm — that's the
 * audit trail (see verifyDraw below).
 */
function computeWinnerIndex(seed, campaignId, weekKey, eligibleCount) {
    const hmac = crypto_1.default.createHmac("sha256", Buffer.from(seed, "hex"));
    hmac.update(`${campaignId}:${weekKey}`);
    const digest = hmac.digest();
    // Use the first 4 bytes as an unsigned 32-bit integer for the modulo draw.
    const asUint32 = digest.readUInt32BE(0);
    return asUint32 % eligibleCount;
}
function runDraw(campaignId, weekKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const existing = yield raffleDraw_model_1.default.findOne({ campaignId, weekKey });
        if (existing && existing.status !== "pending")
            return existing; // idempotent — don't re-draw
        const tickets = yield raffleTicket_model_1.default.find({ campaignId, weekKey }).lean();
        if (tickets.length === 0)
            return null;
        const allTicketUserIds = tickets.map((t) => t.userId);
        const eligibilityChecks = yield Promise.all(allTicketUserIds.map((userId) => __awaiter(this, void 0, void 0, function* () {
            return ({
                userId,
                eligible: yield isEligibleThisWeek(userId, weekKey),
            });
        })));
        const eligibleTicketUserIds = eligibilityChecks
            .filter((c) => c.eligible)
            .map((c) => c.userId)
            .sort(); // deterministic ordering for reproducible verification
        if (eligibleTicketUserIds.length === 0) {
            return raffleDraw_model_1.default.findOneAndUpdate({ campaignId, weekKey }, { campaignId, weekKey, allTicketUserIds, eligibleTicketUserIds: [], status: "pending" }, { upsert: true, new: true });
        }
        const seed = crypto_1.default.randomBytes(32).toString("hex");
        const winnerIndex = computeWinnerIndex(seed, campaignId, weekKey, eligibleTicketUserIds.length);
        const winnerUserId = eligibleTicketUserIds[winnerIndex];
        return raffleDraw_model_1.default.findOneAndUpdate({ campaignId, weekKey }, {
            campaignId,
            weekKey,
            allTicketUserIds,
            eligibleTicketUserIds,
            seed,
            winnerIndex,
            winnerUserId,
            status: "drawn",
            drawnAt: new Date(),
        }, { upsert: true, new: true });
    });
}
/** Independently re-derives the winner from the stored seed + snapshot ticket list. */
function verifyDraw(drawId) {
    return __awaiter(this, void 0, void 0, function* () {
        const draw = yield raffleDraw_model_1.default.findById(drawId);
        if (!draw)
            throw new Error("Draw not found");
        if (!draw.seed || draw.eligibleTicketUserIds.length === 0) {
            throw new Error("Draw has no recorded seed/eligible list to verify");
        }
        const recomputedWinnerIndex = computeWinnerIndex(draw.seed, draw.campaignId, draw.weekKey, draw.eligibleTicketUserIds.length);
        const recomputedWinnerUserId = draw.eligibleTicketUserIds[recomputedWinnerIndex];
        return {
            valid: recomputedWinnerIndex === draw.winnerIndex &&
                recomputedWinnerUserId === draw.winnerUserId,
            recomputedWinnerIndex,
            recomputedWinnerUserId,
        };
    });
}
