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
const setup_1 = require("./setup");
const puzzleCampaign_model_1 = __importDefault(require("../models/puzzleCampaign.model"));
const raffleTicket_model_1 = __importDefault(require("../models/raffleTicket.model"));
const raffleDraw_model_1 = __importDefault(require("../models/raffleDraw.model"));
const raffle_service_1 = require("../services/raffle.service");
const pointsLedger_service_1 = require("../services/points/pointsLedger.service");
const weekBoundary_1 = require("../utils/weekBoundary");
function createActiveV2Campaign() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        return puzzleCampaign_model_1.default.create({
            brandId: "brand-1",
            packageId: "000000000000000000000000",
            gameTypes: ["sliding_puzzle", "card_matching", "spot_the_difference", "word_hunt"],
            title: "Campaign",
            description: "desc",
            puzzleImageUrl: "http://example.com/i.png",
            videoUrl: "http://example.com/v.mp4",
            words: ["a"],
            questions: [
                { question: "q1", choices: ["a", "b"], correctIndex: 0 },
                { question: "q2", choices: ["a", "b"], correctIndex: 0 },
                { question: "q3", choices: ["a", "b"], correctIndex: 0 },
            ],
            prizeDescription: "prize",
            prizeUnitsAvailable: 1,
            durationWeeks: 1,
            timeLimit: 168,
            status: "active",
            paymentStatus: "paid",
            startDate: now,
            endDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        });
    });
}
describe("Raffle service", () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.connectTestDB)();
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.clearTestDB)();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.closeTestDB)();
    }));
    describe("ticket minting", () => {
        it("mints exactly one ticket per player per campaign, never on a replay", () => __awaiter(void 0, void 0, void 0, function* () {
            const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
            const first = yield (0, raffle_service_1.mintTicketOnFirstCompletion)("user-1", "campaign-1", "session-1", weekKey);
            expect(first).not.toBeNull();
            // Simulating a replay attempt trying to mint again for the same user+campaign
            const second = yield (0, raffle_service_1.mintTicketOnFirstCompletion)("user-1", "campaign-1", "session-2", weekKey);
            expect(second).toBeNull();
            const count = yield raffleTicket_model_1.default.countDocuments({ userId: "user-1", campaignId: "campaign-1" });
            expect(count).toBe(1);
        }));
    });
    describe("eligibility floor", () => {
        it("uses the lesser of the configured cap (3) or the number of active campaigns", () => __awaiter(void 0, void 0, void 0, function* () {
            // Only 2 active v2 campaigns exist this week -> floor should be 2, not 3
            yield createActiveV2Campaign();
            yield createActiveV2Campaign();
            const floor = yield (0, raffle_service_1.getEligibilityFloor)();
            expect(floor).toBe(2);
        }));
        it("caps the floor at the configured value (3) even with many more active campaigns", () => __awaiter(void 0, void 0, void 0, function* () {
            for (let i = 0; i < 5; i++)
                yield createActiveV2Campaign();
            const floor = yield (0, raffle_service_1.getEligibilityFloor)();
            expect(floor).toBe(3);
        }));
        it("a player is only eligible once they've completed at least the floor's worth of distinct campaigns this week", () => __awaiter(void 0, void 0, void 0, function* () {
            yield createActiveV2Campaign();
            yield createActiveV2Campaign(); // floor = 2
            const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
            yield (0, pointsLedger_service_1.awardPoints)({ userId: "user-1", points: 7, source: "session_completion", campaignId: "campaign-A" });
            expect(yield (0, raffle_service_1.isEligibleThisWeek)("user-1", weekKey)).toBe(false);
            yield (0, pointsLedger_service_1.awardPoints)({ userId: "user-1", points: 7, source: "session_completion", campaignId: "campaign-B" });
            expect(yield (0, raffle_service_1.isEligibleThisWeek)("user-1", weekKey)).toBe(true);
        }));
    });
    describe("provably-random draw", () => {
        it("returns null when nobody holds a ticket that week", () => __awaiter(void 0, void 0, void 0, function* () {
            const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
            const draw = yield (0, raffle_service_1.runDraw)("campaign-1", weekKey);
            expect(draw).toBeNull();
        }));
        it("draws exactly one winner from the eligible ticket holders and the result is independently verifiable", () => __awaiter(void 0, void 0, void 0, function* () {
            const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
            // No active-campaign floor requirement here (0 active campaigns -> floor 0 -> everyone eligible)
            for (const userId of ["user-1", "user-2", "user-3"]) {
                yield (0, raffle_service_1.mintTicketOnFirstCompletion)(userId, "campaign-1", `session-${userId}`, weekKey);
            }
            const draw = yield (0, raffle_service_1.runDraw)("campaign-1", weekKey);
            expect(draw).not.toBeNull();
            expect(draw.status).toBe("drawn");
            expect(draw.eligibleTicketUserIds.length).toBe(3);
            expect(draw.winnerUserId).toBeDefined();
            expect(draw.eligibleTicketUserIds).toContain(draw.winnerUserId);
            expect(draw.seed).toBeDefined();
            const verification = yield (0, raffle_service_1.verifyDraw)(String(draw._id));
            expect(verification.valid).toBe(true);
            expect(verification.recomputedWinnerUserId).toBe(draw.winnerUserId);
        }));
        it("is idempotent — re-running the draw for the same campaign+week does not pick a new winner", () => __awaiter(void 0, void 0, void 0, function* () {
            const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
            yield (0, raffle_service_1.mintTicketOnFirstCompletion)("user-1", "campaign-1", "s1", weekKey);
            yield (0, raffle_service_1.mintTicketOnFirstCompletion)("user-2", "campaign-1", "s2", weekKey);
            const first = yield (0, raffle_service_1.runDraw)("campaign-1", weekKey);
            const second = yield (0, raffle_service_1.runDraw)("campaign-1", weekKey);
            expect(second.winnerUserId).toBe(first.winnerUserId);
            expect(second.seed).toBe(first.seed);
            const drawCount = yield raffleDraw_model_1.default.countDocuments({ campaignId: "campaign-1", weekKey });
            expect(drawCount).toBe(1);
        }));
        it("excludes ineligible ticket holders from the winner pool (lesser-of-3 rule with fewer than 3 active campaigns)", () => __awaiter(void 0, void 0, void 0, function* () {
            yield createActiveV2Campaign(); // 1 active campaign -> floor = 1
            const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
            // user-1 has completed a campaign this week (eligible); user-2 has not (ineligible)
            yield (0, pointsLedger_service_1.awardPoints)({ userId: "user-1", points: 7, source: "session_completion", campaignId: "some-other-campaign" });
            yield (0, raffle_service_1.mintTicketOnFirstCompletion)("user-1", "campaign-1", "s1", weekKey);
            yield (0, raffle_service_1.mintTicketOnFirstCompletion)("user-2", "campaign-1", "s2", weekKey);
            const draw = yield (0, raffle_service_1.runDraw)("campaign-1", weekKey);
            expect(draw.allTicketUserIds.sort()).toEqual(["user-1", "user-2"]);
            expect(draw.eligibleTicketUserIds).toEqual(["user-1"]);
            expect(draw.winnerUserId).toBe("user-1");
        }));
        it("detects tampering when a draw's stored winner does not match its seed", () => __awaiter(void 0, void 0, void 0, function* () {
            const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
            yield (0, raffle_service_1.mintTicketOnFirstCompletion)("user-1", "campaign-1", "s1", weekKey);
            yield (0, raffle_service_1.mintTicketOnFirstCompletion)("user-2", "campaign-1", "s2", weekKey);
            const draw = yield (0, raffle_service_1.runDraw)("campaign-1", weekKey);
            // Tamper with the recorded winner without changing the seed
            const tamperedWinner = draw.eligibleTicketUserIds.find((u) => u !== draw.winnerUserId);
            yield raffleDraw_model_1.default.updateOne({ _id: draw._id }, { $set: { winnerUserId: tamperedWinner } });
            const verification = yield (0, raffle_service_1.verifyDraw)(String(draw._id));
            expect(verification.valid).toBe(false);
        }));
    });
});
