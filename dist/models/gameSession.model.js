"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const quizAttemptSchema = new mongoose_1.Schema({
    answers: [{ type: Number }],
    score: { type: Number, required: true },
    allCorrect: { type: Boolean, required: true },
    submittedAt: { type: Date, default: Date.now },
}, { _id: false });
const gameStageSchema = new mongoose_1.Schema({
    gameType: {
        type: String,
        enum: [
            "sliding_puzzle",
            "card_matching",
            "spot_the_difference",
            "word_hunt",
        ],
        required: true,
    },
    startedAt: { type: Date },
    completedAt: { type: Date },
    clientMovesTaken: { type: Number },
    clientTimeTakenMs: { type: Number },
}, { _id: false });
const gameSessionSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, index: true },
    campaignId: { type: String, required: true, index: true },
    status: {
        type: String,
        enum: ["in_progress", "completed", "abandoned", "flagged", "voided"],
        default: "in_progress",
        required: true,
    },
    startedAt: { type: Date, default: Date.now, required: true },
    games: { type: [gameStageSchema], default: [] },
    video: {
        startedAt: { type: Date },
        completedAt: { type: Date },
    },
    quiz: {
        firstAttempt: { type: quizAttemptSchema, default: null },
        attempts: { type: [quizAttemptSchema], default: [] },
    },
    completedAt: { type: Date },
    totalCompletionTimeMs: { type: Number },
    totalMoves: { type: Number },
    isFirstCompletionForUser: { type: Boolean },
    pointsAwarded: { type: Number, default: 0 },
    raffleTicketAwarded: { type: Boolean, default: false },
    anticheat: {
        flagged: { type: Boolean, default: false },
        flaggedReasons: { type: [String], default: [] },
        voided: { type: Boolean, default: false },
        voidReason: { type: String },
    },
}, { timestamps: true });
// Race-safe first-completion guard: at most one document per user+campaign can
// have isFirstCompletionForUser:true. A concurrent duplicate write throws
// E11000, which gameSession.service.ts catches and treats as "not first".
gameSessionSchema.index({ userId: 1, campaignId: 1 }, {
    unique: true,
    partialFilterExpression: { isFirstCompletionForUser: true },
});
gameSessionSchema.index({ userId: 1, campaignId: 1, status: 1 });
const GameSessionModel = mongoose_1.default.model("GameSession", gameSessionSchema);
exports.default = GameSessionModel;
