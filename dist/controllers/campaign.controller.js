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
exports.deleteCampaign = exports.updateCampaign = exports.submitCampaign = exports.checkCampaignCompletion = exports.getCampaignById = exports.getCampaignsByBrand = exports.getAllCampaigns = exports.getActiveCampaigns = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const puzzleCampaign_model_1 = __importDefault(require("../models/puzzleCampaign.model"));
const puzzleAttempt_model_1 = __importDefault(require("../models/puzzleAttempt.model"));
const user_model_1 = __importDefault(require("../models/user.model"));
const package_model_1 = __importDefault(require("../models/package.model"));
const brand_model_1 = __importDefault(require("../models/brand.model"));
// Helper function to check and update expired campaigns
const updateExpiredCampaigns = () => __awaiter(void 0, void 0, void 0, function* () {
    const now = new Date();
    yield puzzleCampaign_model_1.default.updateMany({
        status: "active",
        paymentStatus: "paid",
        endDate: { $lt: now },
    }, {
        $set: { status: "ended" },
    });
});
// Get active campaigns only (with brand name included)
exports.getActiveCampaigns = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Update expired campaigns before fetching
        yield updateExpiredCampaigns();
        const { gameType } = req.query;
        // Build filter for active campaigns only
        const filter = { status: "active" };
        const validGameTypes = [
            "sliding_puzzle",
            "card_matching",
            "whack_a_mole",
            "word_hunt",
        ];
        if (gameType && validGameTypes.includes(gameType)) {
            filter.gameType = gameType;
        }
        const campaigns = yield puzzleCampaign_model_1.default.find(filter)
            .select("_id brandId packageId gameType title description brandUrl campaignUrl videoUrl puzzleImageUrl originalImageUrl timeLimit questions words status paymentStatus packageType totalBudget dailyAllocation budgetRemaining budgetUsed transactionId startDate endDate createdAt")
            .lean();
        // Fetch brand names and package names for all campaigns
        const campaignsWithBrand = yield Promise.all(campaigns.map((campaign) => __awaiter(void 0, void 0, void 0, function* () {
            const brand = yield user_model_1.default.findById(campaign.brandId)
                .select("name companyName")
                .lean();
            const packageData = yield package_model_1.default.findById(campaign.packageId)
                .select("name")
                .lean();
            return {
                _id: campaign._id,
                brandId: campaign.brandId,
                packageId: campaign.packageId,
                packageName: (packageData === null || packageData === void 0 ? void 0 : packageData.name) || null,
                brandName: (brand === null || brand === void 0 ? void 0 : brand.companyName) || (brand === null || brand === void 0 ? void 0 : brand.name) || "Unknown Brand",
                gameType: campaign.gameType,
                title: campaign.title,
                description: campaign.description,
                brandUrl: campaign.brandUrl,
                campaignUrl: campaign.campaignUrl,
                videoUrl: campaign.videoUrl || null,
                puzzleImageUrl: campaign.puzzleImageUrl,
                originalImageUrl: campaign.originalImageUrl,
                timeLimit: campaign.timeLimit,
                questions: campaign.questions,
                words: campaign.words,
                status: campaign.status,
                paymentStatus: campaign.paymentStatus || "unpaid",
                packageType: campaign.packageType || null,
                totalBudget: campaign.totalBudget || 0,
                dailyAllocation: campaign.dailyAllocation || 0,
                budgetRemaining: campaign.budgetRemaining || 0,
                budgetUsed: campaign.budgetUsed || 0,
                transactionId: campaign.transactionId || null,
                startDate: campaign.startDate,
                endDate: campaign.endDate,
                createdAt: campaign.createdAt,
            };
        })));
        res.status(200).json({ success: true, campaigns: campaignsWithBrand });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch active campaigns: ${error.message}`, 500));
    }
}));
// Get all campaigns (with brand name included)
exports.getAllCampaigns = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Update expired campaigns before fetching
        yield updateExpiredCampaigns();
        const { gameType, status, paymentStatus } = req.query;
        // Build filter
        const filter = {};
        const validGameTypes = [
            "sliding_puzzle",
            "card_matching",
            "whack_a_mole",
            "word_hunt",
        ];
        if (gameType && validGameTypes.includes(gameType)) {
            filter.gameType = gameType;
        }
        // Filter by status if provided
        const validStatuses = ["active", "ended", "draft"];
        if (status && validStatuses.includes(status)) {
            filter.status = status;
        }
        // Filter by paymentStatus if provided
        const validPaymentStatuses = ["unpaid", "paid", "partial"];
        if (paymentStatus &&
            validPaymentStatuses.includes(paymentStatus)) {
            filter.paymentStatus = paymentStatus;
        }
        const campaigns = yield puzzleCampaign_model_1.default.find(filter)
            .select("_id brandId packageId gameType title description brandUrl campaignUrl videoUrl puzzleImageUrl originalImageUrl timeLimit questions words status paymentStatus packageType totalBudget dailyAllocation budgetRemaining budgetUsed transactionId startDate endDate createdAt")
            .lean();
        // Fetch brand names and package names for all campaigns
        const campaignsWithBrand = yield Promise.all(campaigns.map((campaign) => __awaiter(void 0, void 0, void 0, function* () {
            const brand = yield user_model_1.default.findById(campaign.brandId)
                .select("name companyName")
                .lean();
            const packageData = yield package_model_1.default.findById(campaign.packageId)
                .select("name")
                .lean();
            return {
                _id: campaign._id,
                brandId: campaign.brandId,
                packageId: campaign.packageId,
                packageName: (packageData === null || packageData === void 0 ? void 0 : packageData.name) || null,
                brandName: (brand === null || brand === void 0 ? void 0 : brand.companyName) || (brand === null || brand === void 0 ? void 0 : brand.name) || "Unknown Brand",
                gameType: campaign.gameType,
                title: campaign.title,
                description: campaign.description,
                brandUrl: campaign.brandUrl,
                campaignUrl: campaign.campaignUrl,
                videoUrl: campaign.videoUrl || null,
                puzzleImageUrl: campaign.puzzleImageUrl,
                originalImageUrl: campaign.originalImageUrl,
                timeLimit: campaign.timeLimit,
                questions: campaign.questions,
                words: campaign.words,
                status: campaign.status,
                paymentStatus: campaign.paymentStatus || "unpaid",
                packageType: campaign.packageType || null,
                totalBudget: campaign.totalBudget || 0,
                dailyAllocation: campaign.dailyAllocation || 0,
                budgetRemaining: campaign.budgetRemaining || 0,
                budgetUsed: campaign.budgetUsed || 0,
                transactionId: campaign.transactionId || null,
                startDate: campaign.startDate,
                endDate: campaign.endDate,
                createdAt: campaign.createdAt,
            };
        })));
        res.status(200).json({ success: true, campaigns: campaignsWithBrand });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch campaigns: ${error.message}`, 500));
    }
}));
// Get campaigns by brandId
exports.getCampaignsByBrand = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Update expired campaigns before fetching
        yield updateExpiredCampaigns();
        const { brandId } = req.params;
        const campaigns = yield puzzleCampaign_model_1.default.find({ brandId })
            .select("_id brandId packageId gameType title description brandUrl campaignUrl videoUrl puzzleImageUrl originalImageUrl timeLimit questions words status paymentStatus packageType totalBudget dailyAllocation budgetRemaining budgetUsed transactionId startDate endDate createdAt")
            .lean();
        if (!campaigns || campaigns.length === 0) {
            return res.status(200).json({ success: true, campaigns: [] });
        }
        // Fetch brand name
        const brand = yield user_model_1.default.findById(brandId)
            .select("name companyName")
            .lean();
        const brandName = (brand === null || brand === void 0 ? void 0 : brand.companyName) || (brand === null || brand === void 0 ? void 0 : brand.name) || "Unknown Brand";
        // Fetch package names for all campaigns
        const campaignsWithBrand = yield Promise.all(campaigns.map((campaign) => __awaiter(void 0, void 0, void 0, function* () {
            const packageData = yield package_model_1.default.findById(campaign.packageId)
                .select("name")
                .lean();
            return {
                _id: campaign._id,
                brandId: campaign.brandId,
                packageId: campaign.packageId,
                packageName: (packageData === null || packageData === void 0 ? void 0 : packageData.name) || null,
                brandName,
                gameType: campaign.gameType,
                title: campaign.title,
                description: campaign.description,
                brandUrl: campaign.brandUrl,
                campaignUrl: campaign.campaignUrl,
                videoUrl: campaign.videoUrl || null,
                puzzleImageUrl: campaign.puzzleImageUrl,
                originalImageUrl: campaign.originalImageUrl,
                timeLimit: campaign.timeLimit,
                questions: campaign.questions,
                words: campaign.words,
                status: campaign.status,
                paymentStatus: campaign.paymentStatus || "unpaid",
                packageType: campaign.packageType || null,
                totalBudget: campaign.totalBudget || 0,
                dailyAllocation: campaign.dailyAllocation || 0,
                budgetRemaining: campaign.budgetRemaining || 0,
                budgetUsed: campaign.budgetUsed || 0,
                transactionId: campaign.transactionId || null,
                startDate: campaign.startDate,
                endDate: campaign.endDate,
                createdAt: campaign.createdAt,
            };
        })));
        res.status(200).json({ success: true, campaigns: campaignsWithBrand });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch campaigns for brand: ${error.message}`, 500));
    }
}));
// Get single campaign by campaignId (with brand name)
exports.getCampaignById = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Update expired campaigns before fetching
        yield updateExpiredCampaigns();
        const { campaignId } = req.params;
        const campaign = yield puzzleCampaign_model_1.default.findById(campaignId).lean();
        if (!campaign) {
            return next(new ErrorHandler_1.default("Campaign not found", 404));
        }
        // Fetch brand name and package name
        const brand = yield user_model_1.default.findById(campaign.brandId)
            .select("name companyName")
            .lean();
        const brandName = (brand === null || brand === void 0 ? void 0 : brand.companyName) || (brand === null || brand === void 0 ? void 0 : brand.name) || "Unknown Brand";
        const packageData = yield package_model_1.default.findById(campaign.packageId)
            .select("name")
            .lean();
        res.status(200).json({
            success: true,
            campaign: {
                _id: campaign._id,
                brandId: campaign.brandId,
                packageId: campaign.packageId,
                packageName: (packageData === null || packageData === void 0 ? void 0 : packageData.name) || null,
                brandName,
                gameType: campaign.gameType,
                title: campaign.title,
                description: campaign.description,
                brandUrl: campaign.brandUrl,
                campaignUrl: campaign.campaignUrl,
                videoUrl: campaign.videoUrl || null,
                puzzleImageUrl: campaign.puzzleImageUrl,
                originalImageUrl: campaign.originalImageUrl,
                questions: campaign.questions.map((q) => ({
                    question: q.question,
                    choices: q.choices,
                    correctIndex: q.correctIndex,
                })),
                words: campaign.words,
                timeLimit: campaign.timeLimit,
                status: campaign.status,
                paymentStatus: campaign.paymentStatus || "unpaid",
                packageType: campaign.packageType || null,
                totalBudget: campaign.totalBudget || 0,
                dailyAllocation: campaign.dailyAllocation || 0,
                budgetRemaining: campaign.budgetRemaining || 0,
                budgetUsed: campaign.budgetUsed || 0,
                transactionId: campaign.transactionId || null,
                startDate: campaign.startDate,
                endDate: campaign.endDate,
                createdAt: campaign.createdAt,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch campaign details: ${error.message}`, 500));
    }
}));
// Check if current user has completed a campaign
exports.checkCampaignCompletion = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { campaignId } = req.params;
        const user = req.user;
        const userId = user && user._id ? String(user._id) : undefined;
        if (!userId) {
            return next(new ErrorHandler_1.default("User not authenticated", 401));
        }
        // Check if user has already solved this campaign
        const previousAttempt = yield puzzleAttempt_model_1.default.findOne({
            userId: userId,
            campaignId: campaignId,
            solved: true,
        }).lean();
        const hasCompletedByCurrentUser = !!previousAttempt;
        res.status(200).json({
            success: true,
            hasCompletedByCurrentUser,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to check campaign completion status: ${error.message}`, 500));
    }
}));
exports.submitCampaign = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { campaignId } = req.params;
        const user = req.user;
        const userId = user && user._id ? String(user._id) : undefined;
        const body = req.body;
        const campaign = yield puzzleCampaign_model_1.default.findById(campaignId);
        if (!campaign) {
            return next(new ErrorHandler_1.default("Campaign not found. Please check the campaign ID and try again.", 404));
        }
        // compute quiz score
        let quizScore = 0;
        if (Array.isArray(body.answers)) {
            for (let i = 0; i < Math.min(body.answers.length, campaign.questions.length); i++) {
                console.log(`Question ${i}: User answered ${body.answers[i]}, Correct answer is ${campaign.questions[i].correctIndex}`);
                if (body.answers[i] === campaign.questions[i].correctIndex) {
                    quizScore++;
                }
            }
        }
        // Check if all questions were answered correctly
        const totalQuestions = campaign.questions.length;
        const allQuestionsCorrect = quizScore === totalQuestions;
        console.log(`Quiz Score: ${quizScore}/${totalQuestions}, All Correct: ${allQuestionsCorrect}`);
        console.log(`Solved: ${body.solved}`);
        // determine if first-time ever solved (used for unique puzzle counts)
        let firstTime = false;
        if (body.solved && allQuestionsCorrect) {
            const prevEver = yield puzzleAttempt_model_1.default.findOne({
                userId: userId,
                campaignId: campaignId,
                solved: true,
            });
            console.log(`Previous successful attempt ever found: ${!!prevEver}`);
            if (!prevEver)
                firstTime = true;
        }
        // Allow users to earn points only 1 time per DAY for the same campaign.
        // Count today's successful attempts for this user+campaign.
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);
        const todaysSuccessCount = yield puzzleAttempt_model_1.default.countDocuments({
            userId: userId,
            campaignId: campaignId,
            solved: true,
            timestamp: { $gte: startOfDay, $lte: endOfDay },
        });
        const canEarnPointsNow = body.solved && allQuestionsCorrect && todaysSuccessCount < 1;
        // Calculate points using weighted scoring formula only if eligible
        let pointsEarned = 0;
        if (canEarnPointsNow) {
            // Configuration parameters
            const basePoints = 10;
            const optimalTime = 60; // seconds
            const optimalMoves = 50;
            const speedWeight = 0.4;
            const efficiencyWeight = 0.4;
            const completionWeight = 0.2;
            const maxSpeedMultiplier = 2.0;
            const maxEfficiencyMultiplier = 2.0;
            // Difficulty multipliers based on game type
            const difficultyMultipliers = {
                card_matching: 1,
                whack_a_mole: 1.5,
                sliding_puzzle: 2,
                word_hunt: 1,
            };
            // Convert timeTaken from milliseconds to seconds
            const actualTimeSeconds = body.timeTaken / 1000;
            const actualMoves = body.movesTaken;
            // Calculate speed score (faster = higher score, capped at maxSpeedMultiplier)
            const speedScore = Math.min(optimalTime / actualTimeSeconds, maxSpeedMultiplier);
            // Calculate move efficiency score (fewer moves = higher score, capped at maxEfficiencyMultiplier)
            const moveScore = Math.min(optimalMoves / actualMoves, maxEfficiencyMultiplier);
            // Completion bonus (always 1 if completed)
            const completionBonus = 1;
            // Calculate weighted multiplier
            const weightedMultiplier = speedScore * speedWeight +
                moveScore * efficiencyWeight +
                completionBonus * completionWeight;
            // Get difficulty multiplier for game type
            const difficultyMultiplier = difficultyMultipliers[campaign.gameType] || 1;
            // Calculate final points
            pointsEarned = Math.round(basePoints * weightedMultiplier * difficultyMultiplier);
            console.log(`Points Calculation:`, {
                gameType: campaign.gameType,
                actualTimeSeconds,
                actualMoves,
                speedScore,
                moveScore,
                weightedMultiplier,
                difficultyMultiplier,
                pointsEarned,
            });
        }
        console.log(`First Time: ${firstTime}, Today's successes: ${todaysSuccessCount}, Points Earned: ${pointsEarned}`);
        const attempt = yield puzzleAttempt_model_1.default.create({
            userId: userId,
            puzzleId: campaignId,
            campaignId: campaignId,
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
            if (body.solved && allQuestionsCorrect) {
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
                userDoc.puzzlesSolved.push(campaignId);
            }
            yield userDoc.save();
        }
        // Remove user from "currently playing" after submitting
        if (userId) {
            const redis = require("../utils/redis").redis;
            yield redis.srem("users:currently_playing", userId);
            yield redis.del(`user:${userId}:playing`);
        }
        res.status(201).json({
            success: true,
            attempt,
            gameType: campaign.gameType,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to submit campaign result: ${error.message}`, 500));
    }
}));
// Update a campaign (brands can edit their own campaigns)
exports.updateCampaign = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { campaignId } = req.params;
        const user = req.user;
        if (!user)
            return next(new ErrorHandler_1.default("User not authenticated", 401));
        const campaign = yield puzzleCampaign_model_1.default.findById(campaignId);
        if (!campaign)
            return next(new ErrorHandler_1.default("Campaign not found", 404));
        // Only the owning brand or admins can update
        if (user.role === "brand" &&
            String(campaign.brandId) !== String(user._id)) {
            return next(new ErrorHandler_1.default("Not authorized to edit this campaign", 403));
        }
        // Allowed update fields
        const updatable = [
            "title",
            "description",
            "timeLimit",
            "startDate",
            "endDate",
            "status",
            "paymentStatus",
            "totalBudget",
            "dailyAllocation",
            "budgetRemaining",
            "budgetUsed",
            "brandUrl",
            "campaignUrl",
            "videoUrl",
            "questions",
            "words",
        ];
        const updates = {};
        for (const key of updatable) {
            if (req.body[key] !== undefined)
                updates[key] = req.body[key];
        }
        const updated = yield puzzleCampaign_model_1.default.findByIdAndUpdate(campaignId, { $set: updates }, { new: true }).lean();
        res.status(200).json({ success: true, campaign: updated });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to update campaign: ${error.message}`, 500));
    }
}));
// Delete a campaign (brands can delete their own campaigns)
exports.deleteCampaign = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { campaignId } = req.params;
        const user = req.user;
        if (!user)
            return next(new ErrorHandler_1.default("User not authenticated", 401));
        const campaign = yield puzzleCampaign_model_1.default.findById(campaignId);
        if (!campaign)
            return next(new ErrorHandler_1.default("Campaign not found", 404));
        // Only the owning brand or admins can delete
        if (user.role === "brand" &&
            String(campaign.brandId) !== String(user._id)) {
            return next(new ErrorHandler_1.default("Not authorized to delete this campaign", 403));
        }
        yield puzzleCampaign_model_1.default.findByIdAndDelete(campaignId);
        // remove reference from BrandModel if present
        yield brand_model_1.default.findOneAndUpdate({ userId: campaign.brandId }, { $pull: { campaigns: campaign._id } });
        res.status(200).json({ success: true, message: "Campaign deleted" });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to delete campaign: ${error.message}`, 500));
    }
}));
