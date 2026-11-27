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
const gameSession_model_1 = __importDefault(require("../models/gameSession.model"));
const gameSession_service_1 = require("../services/session/gameSession.service");
const pointsLedger_service_1 = require("../services/points/pointsLedger.service");
const ALL_GAME_TYPES = [
    "sliding_puzzle",
    "card_matching",
    "spot_the_difference",
    "word_hunt",
];
function createV2Campaign() {
    return __awaiter(this, arguments, void 0, function* (overrides = {}) {
        const now = new Date();
        return puzzleCampaign_model_1.default.create(Object.assign({ brandId: "brand-1", packageId: "000000000000000000000000", gameTypes: ALL_GAME_TYPES, title: "Multi-game campaign", description: "A v2 test campaign", puzzleImageUrl: "http://example.com/image.png", videoUrl: "http://example.com/video.mp4", videoDurationSeconds: 120, words: ["apple", "banana"], questions: [
                { question: "q1", choices: ["a", "b"], correctIndex: 0 },
                { question: "q2", choices: ["a", "b"], correctIndex: 1 },
                { question: "q3", choices: ["a", "b"], correctIndex: 0 },
            ], prizeDescription: "A prize", prizeUnitsAvailable: 1, durationWeeks: 2, weeklyPrice: 7000, timeLimit: 2 * 7 * 24, status: "active", paymentStatus: "paid", startDate: now, endDate: new Date(now.getTime() + 2 * 7 * 24 * 60 * 60 * 1000) }, overrides));
    });
}
/** Backdates a just-started game stage so its duration comfortably clears the
 * anti-cheat soft floor, without needing a real sleep in the test. */
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
/** Drives a session through all 4 games + video + a wrong quiz attempt then a
 * correct one, backdating timestamps at each step so nothing trips the
 * anti-cheat floors, and returns the session id ready for completeSession(). */
function driveToQuizSuccess(userId, campaignId) {
    return __awaiter(this, void 0, void 0, function* () {
        const session = yield (0, gameSession_service_1.startSession)(userId, campaignId);
        const sessionId = String(session._id);
        for (const gameType of ALL_GAME_TYPES) {
            yield (0, gameSession_service_1.startGameStage)(sessionId, userId, gameType);
            yield backdateGameStage(sessionId, gameType, 5000);
            yield (0, gameSession_service_1.completeGameStage)(sessionId, userId, gameType, 10, 5000);
        }
        yield (0, gameSession_service_1.startVideoStage)(sessionId, userId);
        yield backdateVideoStart(sessionId, 130000); // 130s ago, comfortably over the 120s video's soft floor
        yield (0, gameSession_service_1.completeVideoStage)(sessionId, userId);
        yield backdateVideoCompleted(sessionId, 5000); // so the first quiz attempt isn't flagged as instant
        yield (0, gameSession_service_1.submitQuizAttempt)(sessionId, userId, [1, 0, 1]); // deliberately wrong
        yield backdateLastQuizAttempt(sessionId, 5000);
        const { allCorrect } = yield (0, gameSession_service_1.submitQuizAttempt)(sessionId, userId, [0, 1, 0]); // correct
        expect(allCorrect).toBe(true);
        return sessionId;
    });
}
describe("GameSession service — full funnel", () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.connectTestDB)();
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.clearTestDB)();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.closeTestDB)();
    }));
    it("awards a flat 7 points and records total completion time on first completion", () => __awaiter(void 0, void 0, void 0, function* () {
        const campaign = yield createV2Campaign();
        const userId = "user-1";
        const sessionId = yield driveToQuizSuccess(userId, String(campaign._id));
        const result = yield (0, gameSession_service_1.completeSession)(sessionId, userId);
        expect(result.isFirstCompletion).toBe(true);
        expect(result.pointsAwarded).toBe(7);
        expect(result.voided).toBe(false);
        expect(result.totalCompletionTimeMs).toBeGreaterThan(0);
        const lifetimePoints = yield (0, pointsLedger_service_1.getUserLifetimePoints)(userId);
        expect(lifetimePoints).toBe(7);
    }));
    it("logs the first quiz attempt separately from later retries", () => __awaiter(void 0, void 0, void 0, function* () {
        const campaign = yield createV2Campaign();
        const userId = "user-2";
        const sessionId = yield driveToQuizSuccess(userId, String(campaign._id));
        const session = yield gameSession_model_1.default.findById(sessionId);
        expect(session.quiz.attempts.length).toBe(2);
        expect(session.quiz.firstAttempt).not.toBeNull();
        expect(session.quiz.firstAttempt.allCorrect).toBe(false); // first attempt was the deliberate wrong one
        expect(session.quiz.attempts[1].allCorrect).toBe(true);
    }));
    it("rejects completion before all four games are finished", () => __awaiter(void 0, void 0, void 0, function* () {
        const campaign = yield createV2Campaign();
        const userId = "user-3";
        const session = yield (0, gameSession_service_1.startSession)(userId, String(campaign._id));
        yield expect((0, gameSession_service_1.completeSession)(String(session._id), userId)).rejects.toThrow(/all four games/i);
    }));
    describe("first-completion-only guard", () => {
        it("awards nothing on a replay (second completed session for the same user+campaign)", () => __awaiter(void 0, void 0, void 0, function* () {
            const campaign = yield createV2Campaign();
            const userId = "user-4";
            const firstSessionId = yield driveToQuizSuccess(userId, String(campaign._id));
            const firstResult = yield (0, gameSession_service_1.completeSession)(firstSessionId, userId);
            expect(firstResult.isFirstCompletion).toBe(true);
            expect(firstResult.pointsAwarded).toBe(7);
            const secondSessionId = yield driveToQuizSuccess(userId, String(campaign._id));
            const secondResult = yield (0, gameSession_service_1.completeSession)(secondSessionId, userId);
            expect(secondResult.isFirstCompletion).toBe(false);
            expect(secondResult.pointsAwarded).toBe(0);
            const lifetimePoints = yield (0, pointsLedger_service_1.getUserLifetimePoints)(userId);
            expect(lifetimePoints).toBe(7); // still just the one award, not 14
        }));
        it("is idempotent when /complete is called twice on the same session", () => __awaiter(void 0, void 0, void 0, function* () {
            const campaign = yield createV2Campaign();
            const userId = "user-5";
            const sessionId = yield driveToQuizSuccess(userId, String(campaign._id));
            const first = yield (0, gameSession_service_1.completeSession)(sessionId, userId);
            const second = yield (0, gameSession_service_1.completeSession)(sessionId, userId);
            expect(first.pointsAwarded).toBe(7);
            expect(second.pointsAwarded).toBe(7); // returns the same recorded result, doesn't re-award
            const lifetimePoints = yield (0, pointsLedger_service_1.getUserLifetimePoints)(userId);
            expect(lifetimePoints).toBe(7);
        }));
        it("under a concurrent race, exactly one of two simultaneous completions wins first-completion", () => __awaiter(void 0, void 0, void 0, function* () {
            const campaign = yield createV2Campaign();
            const userId = "user-6";
            const sessionIdA = yield driveToQuizSuccess(userId, String(campaign._id));
            const sessionIdB = yield driveToQuizSuccess(userId, String(campaign._id));
            const [resultA, resultB] = yield Promise.all([
                (0, gameSession_service_1.completeSession)(sessionIdA, userId),
                (0, gameSession_service_1.completeSession)(sessionIdB, userId),
            ]);
            const firstCompletions = [resultA.isFirstCompletion, resultB.isFirstCompletion];
            expect(firstCompletions.filter(Boolean).length).toBe(1);
            const totalPointsAwarded = resultA.pointsAwarded + resultB.pointsAwarded;
            expect(totalPointsAwarded).toBe(7);
            const lifetimePoints = yield (0, pointsLedger_service_1.getUserLifetimePoints)(userId);
            expect(lifetimePoints).toBe(7);
        }));
    });
    describe("anti-cheat timing", () => {
        it("voids a session when a game stage completes implausibly fast (hard floor)", () => __awaiter(void 0, void 0, void 0, function* () {
            const campaign = yield createV2Campaign();
            const userId = "user-7";
            const session = yield (0, gameSession_service_1.startSession)(userId, String(campaign._id));
            const sessionId = String(session._id);
            // Backdate startedAt into the future so completedAt - startedAt is
            // negative — deterministically below the hard floor without relying on
            // real elapsed wall-clock time.
            const doc = yield gameSession_model_1.default.findById(sessionId);
            const stage = doc.games.find((g) => g.gameType === ALL_GAME_TYPES[0]);
            stage.startedAt = new Date(Date.now() + 5000);
            yield doc.save();
            const updated = yield (0, gameSession_service_1.completeGameStage)(sessionId, userId, ALL_GAME_TYPES[0]);
            expect(updated.anticheat.voided).toBe(true);
            expect(updated.anticheat.flagged).toBe(true);
        }));
        it("flags but does not void a session when timing is suspicious but not impossible (soft floor)", () => __awaiter(void 0, void 0, void 0, function* () {
            const campaign = yield createV2Campaign();
            const userId = "user-8";
            const session = yield (0, gameSession_service_1.startSession)(userId, String(campaign._id));
            const sessionId = String(session._id);
            yield backdateGameStage(sessionId, ALL_GAME_TYPES[0], 1000); // 1s: between hard(500ms) and soft(3000ms)
            const updated = yield (0, gameSession_service_1.completeGameStage)(sessionId, userId, ALL_GAME_TYPES[0]);
            expect(updated.anticheat.flagged).toBe(true);
            expect(updated.anticheat.voided).toBe(false);
        }));
        it("awards nothing for a voided session even on first completion", () => __awaiter(void 0, void 0, void 0, function* () {
            const campaign = yield createV2Campaign();
            const userId = "user-9";
            const session = yield (0, gameSession_service_1.startSession)(userId, String(campaign._id));
            const sessionId = String(session._id);
            // Void via the first game stage (future startedAt trick), then still
            // drive the rest of the funnel to a valid quiz completion.
            const doc = yield gameSession_model_1.default.findById(sessionId);
            const firstStage = doc.games.find((g) => g.gameType === ALL_GAME_TYPES[0]);
            firstStage.startedAt = new Date(Date.now() + 5000);
            yield doc.save();
            yield (0, gameSession_service_1.completeGameStage)(sessionId, userId, ALL_GAME_TYPES[0]);
            for (const gameType of ALL_GAME_TYPES.slice(1)) {
                yield (0, gameSession_service_1.startGameStage)(sessionId, userId, gameType);
                yield backdateGameStage(sessionId, gameType, 5000);
                yield (0, gameSession_service_1.completeGameStage)(sessionId, userId, gameType, 10, 5000);
            }
            yield (0, gameSession_service_1.startVideoStage)(sessionId, userId);
            yield backdateVideoStart(sessionId, 130000);
            yield (0, gameSession_service_1.completeVideoStage)(sessionId, userId);
            yield backdateVideoCompleted(sessionId, 5000);
            yield (0, gameSession_service_1.submitQuizAttempt)(sessionId, userId, [0, 1, 0]);
            const result = yield (0, gameSession_service_1.completeSession)(sessionId, userId);
            expect(result.voided).toBe(true);
            expect(result.pointsAwarded).toBe(0);
            expect(result.isFirstCompletion).toBe(false);
            const lifetimePoints = yield (0, pointsLedger_service_1.getUserLifetimePoints)(userId);
            expect(lifetimePoints).toBe(0);
        }));
    });
});
