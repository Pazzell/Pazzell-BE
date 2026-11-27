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
const puzzleCampaign_model_1 = __importDefault(require("../models/puzzleCampaign.model"));
const gameSession_model_1 = __importDefault(require("../models/gameSession.model"));
const ALL_GAME_TYPES = [
    "sliding_puzzle",
    "card_matching",
    "spot_the_difference",
    "word_hunt",
];
function createV2Campaign() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        return puzzleCampaign_model_1.default.create({
            brandId: "brand-1",
            packageId: "000000000000000000000000",
            gameTypes: ALL_GAME_TYPES,
            title: "Test multi-game campaign",
            description: "A v2 test campaign",
            puzzleImageUrl: "http://example.com/image.png",
            videoUrl: "http://example.com/video.mp4",
            videoDurationSeconds: 120,
            words: ["apple", "banana"],
            questions: [
                { question: "q1", choices: ["a", "b"], correctIndex: 0 },
                { question: "q2", choices: ["a", "b"], correctIndex: 1 },
                { question: "q3", choices: ["a", "b"], correctIndex: 0 },
            ],
            prizeDescription: "A prize",
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
function getAuthToken(email, googleId) {
    return __awaiter(this, void 0, void 0, function* () {
        const authRes = yield (0, supertest_1.default)(app_1.app).post("/api/v1/auth/google").send({
            email,
            name: "Player",
            googleId,
        });
        return authRes.body.accessToken;
    });
}
/** Backdates a stage's start timestamp so its duration clears the anti-cheat
 * soft floor, avoiding real sleeps in the test. */
function backdateGameStage(sessionId, gameType, msAgo) {
    return __awaiter(this, void 0, void 0, function* () {
        const doc = yield gameSession_model_1.default.findById(sessionId);
        const stage = doc.games.find((g) => g.gameType === gameType);
        stage.startedAt = new Date(Date.now() - msAgo);
        yield doc.save();
    });
}
function backdateVideoStart(sessionId, msAgo) {
    return __awaiter(this, void 0, void 0, function* () {
        const doc = yield gameSession_model_1.default.findById(sessionId);
        doc.video.startedAt = new Date(Date.now() - msAgo);
        yield doc.save();
    });
}
function backdateVideoCompleted(sessionId, msAgo) {
    return __awaiter(this, void 0, void 0, function* () {
        const doc = yield gameSession_model_1.default.findById(sessionId);
        doc.video.completedAt = new Date(Date.now() - msAgo);
        yield doc.save();
    });
}
function backdateLastQuizAttempt(sessionId, msAgo) {
    return __awaiter(this, void 0, void 0, function* () {
        const doc = yield gameSession_model_1.default.findById(sessionId);
        const attempts = doc.quiz.attempts;
        attempts[attempts.length - 1].submittedAt = new Date(Date.now() - msAgo);
        yield doc.save();
    });
}
describe("Session-based gameplay flow (v2 multi-game campaigns)", () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.connectTestDB)();
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.clearTestDB)();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.closeTestDB)();
    }));
    it("drives a full session (4 games -> video -> quiz) to completion via the live HTTP endpoints and awards 7 points", () => __awaiter(void 0, void 0, void 0, function* () {
        const campaign = yield createV2Campaign();
        const token = yield getAuthToken("player@test.local", "gid-1");
        const authHeader = `Bearer ${token}`;
        const startRes = yield (0, supertest_1.default)(app_1.app)
            .post("/api/v1/sessions/start")
            .set("Authorization", authHeader)
            .send({ campaignId: String(campaign._id) });
        expect(startRes.status).toBe(201);
        const sessionId = startRes.body.session._id;
        for (const gameType of ALL_GAME_TYPES) {
            const startStage = yield (0, supertest_1.default)(app_1.app)
                .post(`/api/v1/sessions/${sessionId}/games/${gameType}/start`)
                .set("Authorization", authHeader);
            expect(startStage.status).toBe(200);
            yield backdateGameStage(sessionId, gameType, 5000);
            const completeStage = yield (0, supertest_1.default)(app_1.app)
                .post(`/api/v1/sessions/${sessionId}/games/${gameType}/complete`)
                .set("Authorization", authHeader)
                .send({ movesTaken: 10, timeTakenMs: 5000 });
            expect(completeStage.status).toBe(200);
        }
        const videoStart = yield (0, supertest_1.default)(app_1.app)
            .post(`/api/v1/sessions/${sessionId}/video/start`)
            .set("Authorization", authHeader);
        expect(videoStart.status).toBe(200);
        yield backdateVideoStart(sessionId, 130000);
        const videoComplete = yield (0, supertest_1.default)(app_1.app)
            .post(`/api/v1/sessions/${sessionId}/video/complete`)
            .set("Authorization", authHeader);
        expect(videoComplete.status).toBe(200);
        yield backdateVideoCompleted(sessionId, 5000);
        const wrongAttempt = yield (0, supertest_1.default)(app_1.app)
            .post(`/api/v1/sessions/${sessionId}/quiz/attempt`)
            .set("Authorization", authHeader)
            .send({ answers: [1, 0, 1] });
        expect(wrongAttempt.status).toBe(200);
        expect(wrongAttempt.body.allCorrect).toBe(false);
        yield backdateLastQuizAttempt(sessionId, 5000);
        const correctAttempt = yield (0, supertest_1.default)(app_1.app)
            .post(`/api/v1/sessions/${sessionId}/quiz/attempt`)
            .set("Authorization", authHeader)
            .send({ answers: [0, 1, 0] });
        expect(correctAttempt.status).toBe(200);
        expect(correctAttempt.body.allCorrect).toBe(true);
        expect(correctAttempt.body.firstAttemptScore).toBeLessThan(3); // first (wrong) attempt logged separately
        const completeRes = yield (0, supertest_1.default)(app_1.app)
            .post(`/api/v1/sessions/${sessionId}/complete`)
            .set("Authorization", authHeader);
        expect(completeRes.status).toBe(200);
        expect(completeRes.body.isFirstCompletion).toBe(true);
        expect(completeRes.body.pointsAwarded).toBe(7);
        expect(completeRes.body.voided).toBe(false);
    }));
    it("exposes completion status so the client can show the replay warning, and rejects a duplicate completion server-side", () => __awaiter(void 0, void 0, void 0, function* () {
        const campaign = yield createV2Campaign();
        const token = yield getAuthToken("player2@test.local", "gid-2");
        const authHeader = `Bearer ${token}`;
        const before = yield (0, supertest_1.default)(app_1.app)
            .get(`/api/v1/campaigns/${campaign._id}/completion`)
            .set("Authorization", authHeader);
        expect(before.body.hasCompletedByCurrentUser).toBe(false);
        // First full completion
        const startRes = yield (0, supertest_1.default)(app_1.app)
            .post("/api/v1/sessions/start")
            .set("Authorization", authHeader)
            .send({ campaignId: String(campaign._id) });
        const sessionId = startRes.body.session._id;
        for (const gameType of ALL_GAME_TYPES) {
            yield (0, supertest_1.default)(app_1.app)
                .post(`/api/v1/sessions/${sessionId}/games/${gameType}/start`)
                .set("Authorization", authHeader);
            yield backdateGameStage(sessionId, gameType, 5000);
            yield (0, supertest_1.default)(app_1.app)
                .post(`/api/v1/sessions/${sessionId}/games/${gameType}/complete`)
                .set("Authorization", authHeader);
        }
        yield (0, supertest_1.default)(app_1.app).post(`/api/v1/sessions/${sessionId}/video/start`).set("Authorization", authHeader);
        yield backdateVideoStart(sessionId, 130000);
        yield (0, supertest_1.default)(app_1.app).post(`/api/v1/sessions/${sessionId}/video/complete`).set("Authorization", authHeader);
        yield backdateVideoCompleted(sessionId, 5000);
        yield (0, supertest_1.default)(app_1.app)
            .post(`/api/v1/sessions/${sessionId}/quiz/attempt`)
            .set("Authorization", authHeader)
            .send({ answers: [0, 1, 0] });
        yield backdateLastQuizAttempt(sessionId, 5000);
        yield (0, supertest_1.default)(app_1.app).post(`/api/v1/sessions/${sessionId}/complete`).set("Authorization", authHeader);
        const after = yield (0, supertest_1.default)(app_1.app)
            .get(`/api/v1/campaigns/${campaign._id}/completion`)
            .set("Authorization", authHeader);
        expect(after.body.hasCompletedByCurrentUser).toBe(true);
        // Replay: a second session for the same campaign completes but earns nothing
        const replayStart = yield (0, supertest_1.default)(app_1.app)
            .post("/api/v1/sessions/start")
            .set("Authorization", authHeader)
            .send({ campaignId: String(campaign._id) });
        const replaySessionId = replayStart.body.session._id;
        for (const gameType of ALL_GAME_TYPES) {
            yield (0, supertest_1.default)(app_1.app)
                .post(`/api/v1/sessions/${replaySessionId}/games/${gameType}/start`)
                .set("Authorization", authHeader);
            yield backdateGameStage(replaySessionId, gameType, 5000);
            yield (0, supertest_1.default)(app_1.app)
                .post(`/api/v1/sessions/${replaySessionId}/games/${gameType}/complete`)
                .set("Authorization", authHeader);
        }
        yield (0, supertest_1.default)(app_1.app).post(`/api/v1/sessions/${replaySessionId}/video/start`).set("Authorization", authHeader);
        yield backdateVideoStart(replaySessionId, 130000);
        yield (0, supertest_1.default)(app_1.app).post(`/api/v1/sessions/${replaySessionId}/video/complete`).set("Authorization", authHeader);
        yield backdateVideoCompleted(replaySessionId, 5000);
        yield (0, supertest_1.default)(app_1.app)
            .post(`/api/v1/sessions/${replaySessionId}/quiz/attempt`)
            .set("Authorization", authHeader)
            .send({ answers: [0, 1, 0] });
        const replayComplete = yield (0, supertest_1.default)(app_1.app)
            .post(`/api/v1/sessions/${replaySessionId}/complete`)
            .set("Authorization", authHeader);
        expect(replayComplete.status).toBe(200);
        expect(replayComplete.body.isFirstCompletion).toBe(false);
        expect(replayComplete.body.pointsAwarded).toBe(0);
    }));
});
