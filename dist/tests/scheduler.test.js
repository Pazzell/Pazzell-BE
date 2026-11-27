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
const transaction_model_1 = __importDefault(require("../models/transaction.model"));
const payout_model_1 = __importDefault(require("../models/payout.model"));
const raffleTicket_model_1 = __importDefault(require("../models/raffleTicket.model"));
const raffleDraw_model_1 = __importDefault(require("../models/raffleDraw.model"));
const gameSession_model_1 = __importDefault(require("../models/gameSession.model"));
const pointsLedger_service_1 = require("../services/points/pointsLedger.service");
const weekBoundary_1 = require("../utils/weekBoundary");
const scheduler_1 = require("../services/scheduler");
const scheduler_2 = require("../utils/scheduler");
function makeSession(overrides = {}) {
    return gameSession_model_1.default.create(Object.assign({ userId: "user-1", campaignId: "campaign-1", status: "in_progress", startedAt: new Date(), games: [], video: {}, quiz: { firstAttempt: null, attempts: [] }, pointsAwarded: 0, raffleTicketAwarded: false, anticheat: { flagged: false, flaggedReasons: [], voided: false } }, overrides));
}
describe("services/scheduler runWeeklyRollover", () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.connectTestDB)();
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.clearTestDB)();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.closeTestDB)();
    }));
    it("calculates last week's payouts and draws raffles for campaigns that sold tickets last week", () => __awaiter(void 0, void 0, void 0, function* () {
        const lastWeekDate = new Date();
        lastWeekDate.setDate(lastWeekDate.getDate() - 7);
        const previousWeekKey = (0, weekBoundary_1.getPreviousWeekKey)();
        // Revenue + a top player for last week's payout calculation
        yield transaction_model_1.default.create({
            campaignId: "campaign-1",
            brandId: "brand-1",
            packageType: "basic",
            amount: 5000,
            currency: "NGN",
            reference: `ref-${Math.random()}`,
            status: "success",
            createdAt: lastWeekDate,
        });
        yield (0, pointsLedger_service_1.awardPoints)({
            userId: "player-1",
            points: 7,
            source: "session_completion",
            campaignId: "campaign-1",
            at: lastWeekDate,
        });
        // A raffle ticket minted last week for campaign-1
        yield raffleTicket_model_1.default.create({
            userId: "player-1",
            campaignId: "campaign-1",
            weekKey: previousWeekKey,
            sourceSessionId: "session-1",
            createdAt: lastWeekDate,
        });
        yield (0, scheduler_1.runWeeklyRollover)();
        const payout = yield payout_model_1.default.findOne({ userId: "player-1", weekKey: previousWeekKey });
        expect(payout).not.toBeNull();
        expect(payout.amount).toBeGreaterThan(0);
        const draw = yield raffleDraw_model_1.default.findOne({ campaignId: "campaign-1", weekKey: previousWeekKey });
        expect(draw).not.toBeNull();
        expect(draw.winnerUserId).toBe("player-1");
    }));
    it("is a no-op for weeks with no revenue or ticket activity", () => __awaiter(void 0, void 0, void 0, function* () {
        yield expect((0, scheduler_1.runWeeklyRollover)()).resolves.toBeUndefined();
        const payoutCount = yield payout_model_1.default.countDocuments({});
        expect(payoutCount).toBe(0);
    }));
});
describe("utils/scheduler checkAbandonedSessions", () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.connectTestDB)();
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.clearTestDB)();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.closeTestDB)();
    }));
    it("marks a session started well past the TTL as abandoned", () => __awaiter(void 0, void 0, void 0, function* () {
        const staleStart = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago
        const session = yield makeSession({ status: "in_progress", startedAt: staleStart });
        yield (0, scheduler_2.checkAbandonedSessions)();
        const updated = yield gameSession_model_1.default.findById(session._id);
        expect(updated.status).toBe("abandoned");
    }));
    it("leaves a recently-started in_progress session alone", () => __awaiter(void 0, void 0, void 0, function* () {
        const session = yield makeSession({ status: "in_progress", startedAt: new Date() });
        yield (0, scheduler_2.checkAbandonedSessions)();
        const updated = yield gameSession_model_1.default.findById(session._id);
        expect(updated.status).toBe("in_progress");
    }));
    it("does not touch already-completed sessions even if old", () => __awaiter(void 0, void 0, void 0, function* () {
        const staleStart = new Date(Date.now() - 7 * 60 * 60 * 1000);
        const session = yield makeSession({
            status: "completed",
            startedAt: staleStart,
            completedAt: staleStart,
        });
        yield (0, scheduler_2.checkAbandonedSessions)();
        const updated = yield gameSession_model_1.default.findById(session._id);
        expect(updated.status).toBe("completed");
    }));
});
