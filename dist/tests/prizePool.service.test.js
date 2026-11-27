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
const pointsLedger_service_1 = require("../services/points/pointsLedger.service");
const prizePool_service_1 = require("../services/prizePool.service");
const weekBoundary_1 = require("../utils/weekBoundary");
const config_service_1 = require("../services/config/config.service");
function makeSuccessfulTransaction(amount) {
    return __awaiter(this, void 0, void 0, function* () {
        return transaction_model_1.default.create({
            campaignId: "campaign-1",
            brandId: "brand-1",
            packageType: "basic",
            amount,
            currency: "NGN",
            reference: `ref-${Math.random()}`,
            status: "success",
        });
    });
}
describe("prizePool.service.calculateWeeklyPayouts", () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.connectTestDB)();
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.clearTestDB)();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.closeTestDB)();
    }));
    it("splits the week's revenue 50/50 by default and distributes the player pool by configured rank percentages", () => __awaiter(void 0, void 0, void 0, function* () {
        const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
        yield makeSuccessfulTransaction(10000);
        yield (0, pointsLedger_service_1.awardPoints)({ userId: "player-1", points: 21, source: "session_completion" });
        yield (0, pointsLedger_service_1.awardPoints)({ userId: "player-2", points: 14, source: "session_completion" });
        const result = yield (0, prizePool_service_1.calculateWeeklyPayouts)(weekKey);
        expect(result.totalRevenue).toBe(10000);
        expect(result.playerPool).toBe(5000); // 50% default
        expect(result.platformShare).toBe(5000);
        const first = result.payouts.find((p) => p.userId === "player-1");
        const second = result.payouts.find((p) => p.userId === "player-2");
        expect(first.position).toBe(1);
        expect(second.position).toBe(2);
        // rank 1 = 20% of the 5000 player pool = 1000; rank 2 = 15% = 750
        expect(first.amount).toBe(1000);
        expect(second.amount).toBe(750);
        expect(first.playerSharePercent).toBe(50);
        expect(first.platformSharePercent).toBe(50);
    }));
    it("reflects an updated split once Config is changed (e.g. 60/40 in players' favor)", () => __awaiter(void 0, void 0, void 0, function* () {
        const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
        yield makeSuccessfulTransaction(10000);
        yield (0, pointsLedger_service_1.awardPoints)({ userId: "player-1", points: 7, source: "session_completion" });
        yield (0, config_service_1.setConfigValue)("payout.playerSharePercent", 60);
        yield (0, config_service_1.setConfigValue)("payout.platformSharePercent", 40);
        const result = yield (0, prizePool_service_1.calculateWeeklyPayouts)(weekKey);
        expect(result.playerPool).toBe(6000);
        expect(result.platformShare).toBe(4000);
        // reset for other tests relying on the default (config cache is process-wide)
        yield (0, config_service_1.setConfigValue)("payout.playerSharePercent", 50);
        yield (0, config_service_1.setConfigValue)("payout.platformSharePercent", 50);
    }));
    it("upserts (not duplicates) a payout row when recalculated for the same user+week", () => __awaiter(void 0, void 0, void 0, function* () {
        const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
        yield makeSuccessfulTransaction(1000);
        yield (0, pointsLedger_service_1.awardPoints)({ userId: "player-1", points: 7, source: "session_completion" });
        yield (0, prizePool_service_1.calculateWeeklyPayouts)(weekKey);
        yield (0, prizePool_service_1.calculateWeeklyPayouts)(weekKey);
        const count = yield payout_model_1.default.countDocuments({ userId: "player-1", weekKey });
        expect(count).toBe(1);
    }));
    it("returns no payouts when nobody earned points that week", () => __awaiter(void 0, void 0, void 0, function* () {
        const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
        yield makeSuccessfulTransaction(5000);
        const result = yield (0, prizePool_service_1.calculateWeeklyPayouts)(weekKey);
        expect(result.payouts).toEqual([]);
    }));
});
