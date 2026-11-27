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
const supertest_1 = __importDefault(require("supertest"));
const app_1 = require("../app");
const setup_1 = require("./setup");
const redis_1 = require("../utils/redis");
const gameSession_model_1 = __importDefault(require("../models/gameSession.model"));
/** Minimal GameSession doc — only the fields getAppAnalytics cares about
 * (status, startedAt, completedAt) need to be meaningful. */
function makeSession(overrides = {}) {
    return gameSession_model_1.default.create(Object.assign({ userId: "user-1", campaignId: "campaign-1", status: "in_progress", startedAt: new Date(), games: [], video: {}, quiz: { firstAttempt: null, attempts: [] }, pointsAwarded: 0, raffleTicketAwarded: false, anticheat: { flagged: false, flaggedReasons: [], voided: false } }, overrides));
}
describe("GET /api/v1/analytics/app — live stats", () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.connectTestDB)();
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.clearTestDB)();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.closeTestDB)();
        yield (0, redis_1.closeRedisConnection)();
    }));
    it("does not count a session the instant it's started (no completedAt yet)", () => __awaiter(void 0, void 0, void 0, function* () {
        yield makeSession({ status: "in_progress", startedAt: new Date() });
        const res = yield (0, supertest_1.default)(app_1.app).get("/api/v1/analytics/app");
        expect(res.status).toBe(200);
        expect(res.body.analytics.totalGamesPlayed).toBe(0);
        expect(res.body.analytics.gamesPlayedToday).toBe(0);
    }));
    it("counts a session only once it's been submitted (status completed, completedAt set)", () => __awaiter(void 0, void 0, void 0, function* () {
        const now = new Date();
        yield makeSession({ status: "completed", startedAt: now, completedAt: now });
        const res = yield (0, supertest_1.default)(app_1.app).get("/api/v1/analytics/app");
        expect(res.body.analytics.totalGamesPlayed).toBe(1);
        expect(res.body.analytics.gamesPlayedToday).toBe(1);
    }));
    it("excludes abandoned and voided sessions from both counters", () => __awaiter(void 0, void 0, void 0, function* () {
        const now = new Date();
        yield makeSession({ status: "abandoned", startedAt: now });
        yield makeSession({ status: "voided", startedAt: now, completedAt: now });
        const res = yield (0, supertest_1.default)(app_1.app).get("/api/v1/analytics/app");
        expect(res.body.analytics.totalGamesPlayed).toBe(0);
        expect(res.body.analytics.gamesPlayedToday).toBe(0);
    }));
    it("excludes a session completed on a previous day from 'today', but still counts it in the total", () => __awaiter(void 0, void 0, void 0, function* () {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yield makeSession({ status: "completed", startedAt: yesterday, completedAt: yesterday });
        const res = yield (0, supertest_1.default)(app_1.app).get("/api/v1/analytics/app");
        expect(res.body.analytics.totalGamesPlayed).toBe(1);
        expect(res.body.analytics.gamesPlayedToday).toBe(0);
    }));
});
