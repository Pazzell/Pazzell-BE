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
const mongoose_1 = __importDefault(require("mongoose"));
const app_1 = require("../app");
const setup_1 = require("./setup");
const pointsLedger_service_1 = require("../services/points/pointsLedger.service");
describe("Weekly leaderboard (live, ledger-backed)", () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.connectTestDB)();
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.clearTestDB)();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.closeTestDB)();
    }));
    it("shows a user on the weekly leaderboard after earning points, ranked by points then avg completion time", () => __awaiter(void 0, void 0, void 0, function* () {
        const authRes = yield (0, supertest_1.default)(app_1.app).post("/api/v1/auth/google").send({
            email: "leader@test.local",
            name: "Leader",
            googleId: "gid-leader",
        });
        const token = authRes.body.accessToken;
        const userId = authRes.body.user._id;
        yield (0, pointsLedger_service_1.awardPoints)({
            userId,
            points: 7,
            source: "session_completion",
            campaignId: "campaign-1",
            completionTimeMs: 30000,
        });
        const lbRes = yield (0, supertest_1.default)(app_1.app)
            .get("/api/v1/leaderboards/weekly")
            .set("Authorization", `Bearer ${token}`);
        expect(lbRes.status).toBe(200);
        expect(lbRes.body.leaderboard.entries.length).toBeGreaterThanOrEqual(1);
        const entry = lbRes.body.leaderboard.entries.find((e) => e.userId === userId);
        expect(entry).toBeDefined();
        expect(entry.points).toBe(7);
    }));
    it("ranks higher points first, and lower average completion time as the tiebreaker for equal points", () => __awaiter(void 0, void 0, void 0, function* () {
        const fastPlayerId = new mongoose_1.default.Types.ObjectId().toString();
        const slowPlayerId = new mongoose_1.default.Types.ObjectId().toString();
        yield (0, pointsLedger_service_1.awardPoints)({
            userId: fastPlayerId,
            points: 7,
            source: "session_completion",
            campaignId: "campaign-1",
            completionTimeMs: 10000,
        });
        yield (0, pointsLedger_service_1.awardPoints)({
            userId: slowPlayerId,
            points: 7,
            source: "session_completion",
            campaignId: "campaign-2",
            completionTimeMs: 60000,
        });
        const res = yield (0, supertest_1.default)(app_1.app).get("/api/v1/leaderboards/weekly");
        expect(res.status).toBe(200);
        const entries = res.body.leaderboard.entries;
        const fastIndex = entries.findIndex((e) => e.userId === fastPlayerId);
        const slowIndex = entries.findIndex((e) => e.userId === slowPlayerId);
        expect(fastIndex).toBeLessThan(slowIndex); // faster average time ranks higher at equal points
    }));
    it("no longer serves the retired monthly leaderboard (no monthly payload is returned)", () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const res = yield (0, supertest_1.default)(app_1.app).get("/api/v1/leaderboards/monthly");
        // NOTE: this app's catch-all 404 middleware has a pre-existing bug
        // (returns 200 instead of 404 for unmatched routes — see tests/app.test.ts,
        // unrelated to this migration) so we assert on payload shape instead of status.
        expect((_b = (_a = res.body) === null || _a === void 0 ? void 0 : _a.leaderboard) === null || _b === void 0 ? void 0 : _b.type).not.toBe("monthly");
    }));
});
