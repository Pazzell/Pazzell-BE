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
exports.SessionError = void 0;
exports.hasFirstCompletion = hasFirstCompletion;
exports.startSession = startSession;
exports.startGameStage = startGameStage;
exports.completeGameStage = completeGameStage;
exports.startVideoStage = startVideoStage;
exports.completeVideoStage = completeVideoStage;
exports.submitQuizAttempt = submitQuizAttempt;
exports.completeSession = completeSession;
const gameSession_model_1 = __importDefault(require("../../models/gameSession.model"));
const puzzleCampaign_model_1 = __importDefault(require("../../models/puzzleCampaign.model"));
const pointsLedger_service_1 = require("../points/pointsLedger.service");
const config_service_1 = require("../config/config.service");
const antiCheat_1 = require("./antiCheat");
const raffle_service_1 = require("../raffle.service");
const weekBoundary_1 = require("../../utils/weekBoundary");
class SessionError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}
exports.SessionError = SessionError;
const ALL_GAME_TYPES = [
    "sliding_puzzle",
    "card_matching",
    "spot_the_difference",
    "word_hunt",
];
function loadOwnedSession(sessionId, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const session = yield gameSession_model_1.default.findById(sessionId);
        if (!session)
            throw new SessionError("Session not found", 404);
        if (String(session.userId) !== String(userId)) {
            throw new SessionError("You do not own this session", 403);
        }
        return session;
    });
}
function flagSession(session, reason, hard) {
    session.anticheat.flagged = true;
    session.anticheat.flaggedReasons.push(reason);
    if (hard) {
        session.anticheat.voided = true;
        session.anticheat.voidReason = session.anticheat.voidReason || reason;
    }
}
/** Whether this user already has a completed first-completion session for this campaign
 * (v2) — used by the completion-status endpoint to show the "replay is just for fun" warning. */
function hasFirstCompletion(userId, campaignId) {
    return __awaiter(this, void 0, void 0, function* () {
        const existing = yield gameSession_model_1.default.findOne({
            userId,
            campaignId,
            isFirstCompletionForUser: true,
        }).lean();
        return !!existing;
    });
}
function startSession(userId, campaignId) {
    return __awaiter(this, void 0, void 0, function* () {
        const campaign = yield puzzleCampaign_model_1.default.findById(campaignId);
        if (!campaign)
            throw new SessionError("Campaign not found", 404);
        if (campaign.status !== "active") {
            throw new SessionError("Campaign is not active", 400);
        }
        const gameTypes = campaign.gameTypes && campaign.gameTypes.length
            ? campaign.gameTypes
            : ALL_GAME_TYPES;
        return gameSession_model_1.default.create({
            userId,
            campaignId,
            status: "in_progress",
            startedAt: new Date(),
            games: gameTypes.map((gameType) => ({ gameType })),
            video: {},
            quiz: { firstAttempt: null, attempts: [] },
            pointsAwarded: 0,
            raffleTicketAwarded: false,
            anticheat: { flagged: false, flaggedReasons: [], voided: false },
        });
    });
}
function startGameStage(sessionId, userId, gameType) {
    return __awaiter(this, void 0, void 0, function* () {
        const session = yield loadOwnedSession(sessionId, userId);
        if (session.status !== "in_progress") {
            throw new SessionError(`Session is ${session.status}, cannot continue`, 400);
        }
        const stage = session.games.find((g) => g.gameType === gameType);
        if (!stage)
            throw new SessionError(`Unknown game type for this session: ${gameType}`, 400);
        if (!stage.startedAt)
            stage.startedAt = new Date();
        yield session.save();
        return session;
    });
}
function completeGameStage(sessionId, userId, gameType, clientMovesTaken, clientTimeTakenMs) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const session = yield loadOwnedSession(sessionId, userId);
        if (session.status !== "in_progress") {
            throw new SessionError(`Session is ${session.status}, cannot continue`, 400);
        }
        const stage = session.games.find((g) => g.gameType === gameType);
        if (!stage)
            throw new SessionError(`Unknown game type for this session: ${gameType}`, 400);
        if (!stage.startedAt) {
            throw new SessionError(`Game stage ${gameType} was never started`, 400);
        }
        const now = new Date();
        stage.completedAt = now;
        if (clientMovesTaken !== undefined)
            stage.clientMovesTaken = clientMovesTaken;
        if (clientTimeTakenMs !== undefined)
            stage.clientTimeTakenMs = clientTimeTakenMs;
        const durationMs = now.getTime() - stage.startedAt.getTime();
        const floors = yield (0, config_service_1.getAntiCheatFloors)();
        const verdict = (0, antiCheat_1.evaluateTiming)(durationMs, (_a = floors.softFloorMs[gameType]) !== null && _a !== void 0 ? _a : 0, (_b = floors.hardFloorMs[gameType]) !== null && _b !== void 0 ? _b : 0);
        if (verdict !== "ok") {
            flagSession(session, `${gameType} completed in ${durationMs}ms (implausibly fast)`, verdict === "hard");
        }
        yield session.save();
        return session;
    });
}
function startVideoStage(sessionId, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const session = yield loadOwnedSession(sessionId, userId);
        if (session.status !== "in_progress") {
            throw new SessionError(`Session is ${session.status}, cannot continue`, 400);
        }
        const allGamesDone = session.games.every((g) => !!g.completedAt);
        if (!allGamesDone) {
            throw new SessionError("Complete all four games before watching the video", 400);
        }
        if (!session.video.startedAt)
            session.video.startedAt = new Date();
        yield session.save();
        return session;
    });
}
function completeVideoStage(sessionId, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const session = yield loadOwnedSession(sessionId, userId);
        if (session.status !== "in_progress") {
            throw new SessionError(`Session is ${session.status}, cannot continue`, 400);
        }
        if (!session.video.startedAt) {
            throw new SessionError("Video stage was never started", 400);
        }
        const campaign = yield puzzleCampaign_model_1.default.findById(session.campaignId);
        if (!campaign)
            throw new SessionError("Campaign not found", 404);
        const now = new Date();
        session.video.completedAt = now;
        const durationMs = now.getTime() - session.video.startedAt.getTime();
        if (campaign.videoDurationSeconds) {
            const floors = yield (0, config_service_1.getAntiCheatFloors)();
            const verdict = (0, antiCheat_1.evaluateVideoWatchTime)(durationMs, campaign.videoDurationSeconds, floors.videoMinWatchFraction, floors.videoHardWatchFraction);
            if (verdict !== "ok") {
                flagSession(session, `video watched for ${durationMs}ms of a ${campaign.videoDurationSeconds}s video (implausibly short)`, verdict === "hard");
            }
        }
        yield session.save();
        return session;
    });
}
function submitQuizAttempt(sessionId, userId, answers) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const session = yield loadOwnedSession(sessionId, userId);
        if (session.status !== "in_progress") {
            throw new SessionError(`Session is ${session.status}, cannot continue`, 400);
        }
        if (!session.video.completedAt) {
            throw new SessionError("Watch the video before attempting the quiz", 400);
        }
        const campaign = yield puzzleCampaign_model_1.default.findById(session.campaignId);
        if (!campaign)
            throw new SessionError("Campaign not found", 404);
        const questions = campaign.questions || [];
        let score = 0;
        if (Array.isArray(answers)) {
            for (let i = 0; i < Math.min(answers.length, questions.length); i++) {
                if (answers[i] === questions[i].correctIndex)
                    score++;
            }
        }
        const allCorrect = questions.length > 0 && score === questions.length;
        const now = new Date();
        const priorTransition = session.quiz.attempts.length > 0
            ? session.quiz.attempts[session.quiz.attempts.length - 1].submittedAt
            : session.video.completedAt;
        const durationMs = now.getTime() - priorTransition.getTime();
        const floors = yield (0, config_service_1.getAntiCheatFloors)();
        const verdict = (0, antiCheat_1.evaluateTiming)(durationMs, (_a = floors.softFloorMs.quiz) !== null && _a !== void 0 ? _a : 0, (_b = floors.hardFloorMs.quiz) !== null && _b !== void 0 ? _b : 0);
        if (verdict !== "ok") {
            flagSession(session, `quiz attempt submitted ${durationMs}ms after previous stage (implausibly fast)`, verdict === "hard");
        }
        const attempt = { answers, score, allCorrect, submittedAt: now };
        if (!session.quiz.firstAttempt) {
            session.quiz.firstAttempt = attempt;
        }
        session.quiz.attempts.push(attempt);
        yield session.save();
        return { session, score, allCorrect };
    });
}
function completeSession(sessionId, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const session = yield loadOwnedSession(sessionId, userId);
        // Idempotent: calling /complete again on an already-completed session just
        // returns the original result, never re-awards anything.
        if (session.status === "completed") {
            return {
                session,
                isFirstCompletion: !!session.isFirstCompletionForUser,
                pointsAwarded: session.pointsAwarded,
                totalCompletionTimeMs: session.totalCompletionTimeMs || 0,
                voided: session.anticheat.voided,
                flagged: session.anticheat.flagged,
            };
        }
        if (session.status === "voided" || session.status === "abandoned") {
            throw new SessionError(`Session is ${session.status}, cannot be completed`, 400);
        }
        const allGamesDone = session.games.every((g) => !!g.completedAt);
        if (!allGamesDone) {
            throw new SessionError("All four games must be completed first", 400);
        }
        if (!session.video.completedAt) {
            throw new SessionError("The video must be watched first", 400);
        }
        const hasCorrectQuizAttempt = session.quiz.attempts.some((a) => a.allCorrect);
        if (!hasCorrectQuizAttempt) {
            throw new SessionError("All quiz questions must be answered correctly before completing", 400);
        }
        const now = new Date();
        const totalCompletionTimeMs = now.getTime() - session.startedAt.getTime();
        session.completedAt = now;
        session.totalCompletionTimeMs = totalCompletionTimeMs;
        if (session.anticheat.voided) {
            session.status = "voided";
            yield session.save();
            return {
                session,
                isFirstCompletion: false,
                pointsAwarded: 0,
                totalCompletionTimeMs,
                voided: true,
                flagged: session.anticheat.flagged,
            };
        }
        session.status = "completed";
        // Race-safe first-completion claim: attempt the write with the flag set to
        // true and let the partial unique index on {userId,campaignId} arbitrate.
        // A concurrent duplicate throws E11000, which we catch and treat as "not first".
        session.isFirstCompletionForUser = true;
        let isFirstCompletion = true;
        try {
            yield session.save();
        }
        catch (err) {
            if ((err === null || err === void 0 ? void 0 : err.code) === 11000) {
                session.isFirstCompletionForUser = false;
                isFirstCompletion = false;
                yield session.save();
            }
            else {
                throw err;
            }
        }
        let pointsAwarded = 0;
        if (isFirstCompletion) {
            pointsAwarded = yield (0, config_service_1.getSessionCompletionPoints)();
            const weekKey = (0, weekBoundary_1.getWeekKey)(now);
            const ticket = yield (0, raffle_service_1.mintTicketOnFirstCompletion)(userId, session.campaignId, String(session._id), weekKey);
            session.pointsAwarded = pointsAwarded;
            session.raffleTicketAwarded = !!ticket;
            yield session.save();
            yield (0, pointsLedger_service_1.awardPoints)({
                userId,
                points: pointsAwarded,
                source: "session_completion",
                sourceRefId: String(session._id),
                campaignId: session.campaignId,
                completionTimeMs: totalCompletionTimeMs,
                at: now,
            });
        }
        return {
            session,
            isFirstCompletion,
            pointsAwarded,
            totalCompletionTimeMs,
            voided: false,
            flagged: session.anticheat.flagged,
        };
    });
}
