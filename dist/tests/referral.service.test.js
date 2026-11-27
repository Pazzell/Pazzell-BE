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
const referral_model_1 = __importDefault(require("../models/referral.model"));
const pointsLedger_service_1 = require("../services/points/pointsLedger.service");
describe("Referral 21-point qualification", () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.connectTestDB)();
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.clearTestDB)();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.closeTestDB)();
    }));
    it("does not credit the referrer before the referee reaches the points threshold", () => __awaiter(void 0, void 0, void 0, function* () {
        const referrerId = "referrer-1";
        const refereeId = "referee-1";
        yield referral_model_1.default.create({ referrerId, referredUserId: refereeId });
        // Two session completions = 14 points, below the 21-point threshold
        yield (0, pointsLedger_service_1.awardPoints)({ userId: refereeId, points: 7, source: "session_completion" });
        yield (0, pointsLedger_service_1.awardPoints)({ userId: refereeId, points: 7, source: "session_completion" });
        const referral = yield referral_model_1.default.findOne({ referredUserId: refereeId });
        expect(referral.successful).toBe(false);
        const referrerPoints = yield (0, pointsLedger_service_1.getUserLifetimePoints)(referrerId);
        expect(referrerPoints).toBe(0);
    }));
    it("credits the referrer exactly 5 points once the referee crosses 21 points", () => __awaiter(void 0, void 0, void 0, function* () {
        const referrerId = "referrer-2";
        const refereeId = "referee-2";
        yield referral_model_1.default.create({ referrerId, referredUserId: refereeId });
        // Three session completions = 21 points, crossing the threshold
        yield (0, pointsLedger_service_1.awardPoints)({ userId: refereeId, points: 7, source: "session_completion" });
        yield (0, pointsLedger_service_1.awardPoints)({ userId: refereeId, points: 7, source: "session_completion" });
        yield (0, pointsLedger_service_1.awardPoints)({ userId: refereeId, points: 7, source: "session_completion" });
        const referral = yield referral_model_1.default.findOne({ referredUserId: refereeId });
        expect(referral.successful).toBe(true);
        expect(referral.pointsAwarded).toBe(5);
        expect(referral.successfulAt).toBeDefined();
        const referrerPoints = yield (0, pointsLedger_service_1.getUserLifetimePoints)(referrerId);
        expect(referrerPoints).toBe(5);
    }));
    it("does not re-credit the referrer on further points earned by an already-qualified referee", () => __awaiter(void 0, void 0, void 0, function* () {
        const referrerId = "referrer-3";
        const refereeId = "referee-3";
        yield referral_model_1.default.create({ referrerId, referredUserId: refereeId });
        yield (0, pointsLedger_service_1.awardPoints)({ userId: refereeId, points: 21, source: "session_completion" });
        yield (0, pointsLedger_service_1.awardPoints)({ userId: refereeId, points: 7, source: "session_completion" }); // further points, already qualified
        const referrerPoints = yield (0, pointsLedger_service_1.getUserLifetimePoints)(referrerId);
        expect(referrerPoints).toBe(5); // still just the one 5pt credit, not repeated
    }));
    it("is a no-op when the user has no pending referral", () => __awaiter(void 0, void 0, void 0, function* () {
        const soloUserId = "solo-user";
        yield expect((0, pointsLedger_service_1.awardPoints)({ userId: soloUserId, points: 21, source: "session_completion" })).resolves.toBeDefined();
        // no throw, no referral rows exist — nothing to assert beyond "didn't crash"
    }));
});
