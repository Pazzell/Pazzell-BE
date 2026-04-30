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
exports.submitPuzzle = exports.getPuzzle = exports.listPuzzles = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const puzzleCampaign_model_1 = __importDefault(require("../models/puzzleCampaign.model"));
const puzzleAttempt_model_1 = __importDefault(require("../models/puzzleAttempt.model"));
const user_model_1 = __importDefault(require("../models/user.model"));
// List available puzzles (can filter by gameType)
exports.listPuzzles = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { gameType } = req.query;
        // Build filter
        const filter = {};
        if (gameType === "puzzle" || gameType === "wordHunt") {
            filter.gameType = gameType;
        }
        const campaigns = yield puzzleCampaign_model_1.default.find(filter).select("_id brandId gameType title description puzzleImageUrl timeLimit questions words createdAt");
        res.status(200).json({ success: true, campaigns });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// Get puzzle by id (return images, questions, id, timeLimit)
exports.getPuzzle = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const campaign = yield puzzleCampaign_model_1.default.findById(id).lean();
        if (!campaign)
            return next(new ErrorHandler_1.default("Puzzle not found", 404));
        res.status(200).json({
            success: true,
            puzzle: {
                puzzleId: campaign._id,
                puzzleImageUrl: campaign.puzzleImageUrl,
                originalImageUrl: campaign.originalImageUrl,
                questions: campaign.questions.map((q) => ({
                    question: q.question,
                    choices: q.choices,
                })),
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
exports.submitPuzzle = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params; // campaign id
        const user = req.user;
        const userId = user && user._id ? String(user._id) : undefined;
        const body = req.body;
        const campaign = yield puzzleCampaign_model_1.default.findById(id);
        if (!campaign)
            return next(new ErrorHandler_1.default("Puzzle campaign not found", 404));
        // compute quiz score
        let quizScore = 0;
        if (Array.isArray(body.answers)) {
            for (let i = 0; i < Math.min(body.answers.length, campaign.questions.length); i++) {
                if (body.answers[i] === campaign.questions[i].correctIndex)
                    quizScore++;
            }
        }
        // determine if first-time solved
        let firstTime = false;
        if (body.solved) {
            const prev = yield puzzleAttempt_model_1.default.findOne({
                userId: userId,
                puzzleId: id,
                solved: true,
            });
            if (!prev)
                firstTime = true;
        }
        const pointsEarned = firstTime ? 1 : 0;
        const attempt = yield puzzleAttempt_model_1.default.create({
            userId: userId,
            puzzleId: id,
            campaignId: id,
            timeTaken: body.timeTaken,
            movesTaken: body.movesTaken,
            solved: body.solved,
            firstTimeSolved: firstTime,
            quizScore,
            answers: Array.isArray(body.answers) ? body.answers : [],
            pointsEarned,
        });
        // update user analytics
        const userDoc = userId ? yield user_model_1.default.findById(userId) : null;
        if (userDoc) {
            userDoc.analytics.lifetime.attempts =
                (userDoc.analytics.lifetime.attempts || 0) + 1;
            userDoc.analytics.lifetime.totalMoves =
                (userDoc.analytics.lifetime.totalMoves || 0) + body.movesTaken;
            userDoc.analytics.lifetime.totalTime =
                (userDoc.analytics.lifetime.totalTime || 0) + body.timeTaken;
            if (body.solved) {
                userDoc.analytics.lifetime.puzzlesSolved =
                    (userDoc.analytics.lifetime.puzzlesSolved || 0) +
                        (firstTime ? 1 : 0);
                userDoc.analytics.lifetime.totalPoints =
                    (userDoc.analytics.lifetime.totalPoints || 0) + pointsEarned;
            }
            // successRate = puzzlesSolved / attempts
            if (userDoc.analytics.lifetime.attempts > 0) {
                userDoc.analytics.lifetime.successRate =
                    (userDoc.analytics.lifetime.puzzlesSolved || 0) /
                        userDoc.analytics.lifetime.attempts;
            }
            if (firstTime) {
                userDoc.puzzlesSolved = userDoc.puzzlesSolved || [];
                userDoc.puzzlesSolved.push(id);
            }
            yield userDoc.save();
        }
        res.status(201).json({
            success: true,
            attempt,
            gameType: campaign.gameType,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
