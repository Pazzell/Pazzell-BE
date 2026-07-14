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
exports.getAllBrands = exports.getCampaignAnalytics = exports.createCampaign = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const puzzleCampaign_model_1 = __importDefault(require("../models/puzzleCampaign.model"));
const brand_model_1 = __importDefault(require("../models/brand.model"));
const storageFactory_1 = require("../services/storage/storageFactory");
const gameSession_model_1 = __importDefault(require("../models/gameSession.model"));
const user_model_1 = __importDefault(require("../models/user.model"));
const package_model_1 = __importDefault(require("../models/package.model"));
const payment_controller_1 = require("./payment.controller");
const config_service_1 = require("../services/config/config.service");
const videoValidation_service_1 = require("../services/video/videoValidation.service");
const ALL_GAME_TYPES = [
    "sliding_puzzle",
    "card_matching",
    "spot_the_difference",
    "word_hunt",
];
// Create a multi-game puzzle campaign (brands only). All new campaigns span
// all four game types in a single submission. Expects multipart upload with
// two files: "image" (feeds sliding tiles + spot-the-difference) and "video"
// (~2 minutes, feeds the end-of-session quiz stage — quiz questions are
// authored manually by the brand, not AI-generated).
exports.createCampaign = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const brandUser = req.user;
        if (brandUser.role !== "brand")
            return next(new ErrorHandler_1.default("Only brands can create campaigns", 403));
        const { questions, title, description, words, packageId, brandUrl, campaignUrl, prizeDescription, prizeUnitsAvailable, durationWeeks, } = req.body;
        // Validate packageId
        if (!packageId || typeof packageId !== "string") {
            return next(new ErrorHandler_1.default("packageId is required and must be a valid string", 400));
        }
        const packageData = yield package_model_1.default.findById(packageId);
        if (!packageData) {
            return next(new ErrorHandler_1.default("Invalid package. Package not found.", 404));
        }
        if (!packageData.isActive) {
            return next(new ErrorHandler_1.default("Selected package is not available", 400));
        }
        const packageType = ((_a = packageData.name) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === "premium" ? "premium" : "basic";
        // validate required text fields
        if (!title || typeof title !== "string" || title.trim() === "") {
            return next(new ErrorHandler_1.default("title is required and must be a non-empty string", 400));
        }
        if (!description ||
            typeof description !== "string" ||
            description.trim() === "") {
            return next(new ErrorHandler_1.default("description is required and must be a non-empty string", 400));
        }
        if (!prizeDescription ||
            typeof prizeDescription !== "string" ||
            prizeDescription.trim() === "") {
            return next(new ErrorHandler_1.default("prizeDescription is required and must be a non-empty string", 400));
        }
        let parsedPrizeUnits = 1;
        if (prizeUnitsAvailable !== undefined && prizeUnitsAvailable !== null && prizeUnitsAvailable !== "") {
            parsedPrizeUnits = Number(prizeUnitsAvailable);
            if (!Number.isFinite(parsedPrizeUnits) || parsedPrizeUnits < 1) {
                return next(new ErrorHandler_1.default("prizeUnitsAvailable must be a positive number", 400));
            }
        }
        // Duration: weeks only (weekly billing revert — replaces endMonth/timeLimit/weeksToRun)
        const parsedDurationWeeks = Number(durationWeeks);
        if (!Number.isFinite(parsedDurationWeeks) || parsedDurationWeeks <= 0) {
            return next(new ErrorHandler_1.default("durationWeeks is required and must be a positive number", 400));
        }
        // Bag of words for word_hunt — now always required since every campaign
        // includes all four game types.
        let parsedWords = [];
        if (words) {
            if (typeof words === "string") {
                try {
                    parsedWords = JSON.parse(words);
                }
                catch (_e) {
                    parsedWords = words
                        .split(",")
                        .map((w) => w.trim())
                        .filter((w) => w.length > 0);
                }
            }
            else if (Array.isArray(words)) {
                parsedWords = words;
            }
        }
        if (!parsedWords || parsedWords.length === 0) {
            return next(new ErrorHandler_1.default("words array is required (bag of words for the word hunt game) and must contain at least one word", 400));
        }
        // Get brand profile (no restriction on number of campaigns)
        const brand = yield brand_model_1.default.findOne({ userId: brandUser._id });
        if (!brand) {
            return next(new ErrorHandler_1.default("Brand profile not found", 404));
        }
        // multer .fields() stores uploads keyed by field name
        const files = req.files;
        const imageFile = (_b = files === null || files === void 0 ? void 0 : files.image) === null || _b === void 0 ? void 0 : _b[0];
        const videoFile = (_c = files === null || files === void 0 ? void 0 : files.video) === null || _c === void 0 ? void 0 : _c[0];
        if (!imageFile) {
            return next(new ErrorHandler_1.default('Missing brand image file. Please upload using field name "image"', 400));
        }
        if (!videoFile) {
            return next(new ErrorHandler_1.default('Missing video file. Please upload using field name "video"', 400));
        }
        // Validate video duration/size before uploading anything
        let videoMeta;
        try {
            videoMeta = yield (0, videoValidation_service_1.validateVideoUpload)({
                buffer: videoFile.buffer,
                mimetype: videoFile.mimetype,
                originalname: videoFile.originalname,
            });
        }
        catch (e) {
            if (e instanceof videoValidation_service_1.VideoValidationError) {
                return next(new ErrorHandler_1.default(e.message, 400));
            }
            throw e;
        }
        // Quiz questions: brand-authored (no AI generation), exactly N questions
        // (config-driven, default 3).
        let parsedQuestions = [];
        const rawQuestions = questions !== null && questions !== void 0 ? questions : (_d = req.body) === null || _d === void 0 ? void 0 : _d.question;
        const tryParse = (val) => {
            try {
                return JSON.parse(val);
            }
            catch (_a) {
                try {
                    return JSON.parse(val.replace(/'/g, '"'));
                }
                catch (_b) {
                    return null;
                }
            }
        };
        if (typeof rawQuestions === "string" && rawQuestions.trim() !== "") {
            const parsed = tryParse(rawQuestions);
            if (parsed === null) {
                return next(new ErrorHandler_1.default(`Invalid JSON for questions field. Received: ${rawQuestions}`, 400));
            }
            parsedQuestions = parsed;
        }
        else if (Array.isArray(rawQuestions)) {
            parsedQuestions = rawQuestions;
        }
        else if (rawQuestions && typeof rawQuestions === "object") {
            const vals = Object.values(rawQuestions);
            parsedQuestions =
                vals.length && vals.every((v) => typeof v === "object")
                    ? vals
                    : [];
        }
        const requiredQuestionCount = yield (0, config_service_1.getQuizQuestionCount)();
        if (!Array.isArray(parsedQuestions) ||
            parsedQuestions.length !== requiredQuestionCount) {
            return next(new ErrorHandler_1.default(`questions must be an array of exactly ${requiredQuestionCount} brand-authored quiz questions`, 400));
        }
        for (const q of parsedQuestions) {
            if (!q ||
                typeof q.question !== "string" ||
                !Array.isArray(q.choices) ||
                typeof q.correctIndex !== "number") {
                return next(new ErrorHandler_1.default("Each question must have 'question', 'choices' array and numeric 'correctIndex'", 400));
            }
        }
        // Weekly pricing: amount = weeks × tier weekly price
        let pricing;
        try {
            pricing = yield (0, payment_controller_1.computeWeeklyPricing)(packageType, parsedDurationWeeks);
        }
        catch (e) {
            return next(new ErrorHandler_1.default(e.message, 400));
        }
        // Upload brand image and video
        const storage = (0, storageFactory_1.getStorageService)();
        const ts = Date.now();
        const imageUploadName = `${ts}-${imageFile.originalname}`;
        const imageResult = yield storage.uploadFile({
            buffer: imageFile.buffer,
            mimetype: imageFile.mimetype,
            originalname: imageUploadName,
            folder: "puzzles",
            fileName: imageUploadName,
        });
        const videoUploadName = `${ts}-${videoFile.originalname}`;
        const videoResult = yield storage.uploadFile({
            buffer: videoFile.buffer,
            mimetype: videoFile.mimetype,
            originalname: videoUploadName,
            folder: "campaign-videos",
            fileName: videoUploadName,
        });
        // Placeholder dates — actual dates are set when payment is verified (draft -> active)
        const currentDate = new Date();
        const placeholderEndDate = new Date(currentDate.getTime() + pricing.timeLimitHours * 60 * 60 * 1000);
        const campaignData = {
            brandId: brandUser._id,
            packageId,
            packageType,
            gameTypes: ALL_GAME_TYPES,
            title: title.trim(),
            description: description.trim(),
            brandUrl: (brandUrl === null || brandUrl === void 0 ? void 0 : brandUrl.trim()) || null,
            campaignUrl: (campaignUrl === null || campaignUrl === void 0 ? void 0 : campaignUrl.trim()) || null,
            videoUrl: videoResult.url,
            videoDurationSeconds: videoMeta.durationSeconds,
            videoSizeBytes: videoMeta.sizeBytes,
            videoMimeType: videoMeta.mimeType,
            puzzleImageUrl: imageResult.url,
            questions: parsedQuestions,
            words: parsedWords,
            prizeDescription: prizeDescription.trim(),
            prizeUnitsAvailable: parsedPrizeUnits,
            durationWeeks: parsedDurationWeeks,
            weeklyPrice: pricing.weeklyPrice,
            timeLimit: pricing.timeLimitHours,
            status: "draft",
            paymentStatus: "unpaid",
            totalBudget: 0,
            expectedChargeAmount: pricing.totalAmount,
            dailyAllocation: 0,
            budgetRemaining: 0,
            budgetUsed: 0,
            startDate: currentDate,
            endDate: placeholderEndDate,
        };
        const campaign = yield puzzleCampaign_model_1.default.create(campaignData);
        yield brand_model_1.default.findOneAndUpdate({ userId: brandUser._id }, { $push: { campaigns: campaign._id } });
        const campaignResponse = campaign.toObject();
        const responseWithPackageName = Object.assign(Object.assign({}, campaignResponse), { packageName: packageData.name });
        res
            .status(201)
            .json({ success: true, campaign: responseWithPackageName });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to create campaign: ${error.message}`, 500));
    }
}));
exports.getCampaignAnalytics = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const brandUser = req.user;
        if (brandUser.role !== "brand")
            return next(new ErrorHandler_1.default("Only brands can access analytics", 403));
        const brand = yield brand_model_1.default.findOne({ userId: brandUser._id });
        if (!brand)
            return next(new ErrorHandler_1.default("Brand not found", 404));
        // Fetch campaigns for brand
        const campaigns = yield puzzleCampaign_model_1.default.find({
            brandId: brandUser._id,
        }).lean();
        const campaignsAnalytics = [];
        // prepare campaign ids for bulk queries
        const campaignIds = campaigns.map((c) => String(c._id));
        // Fetch all game sessions for brand campaigns in one query
        const allSessions = yield gameSession_model_1.default.find({
            campaignId: { $in: campaignIds },
        }).lean();
        // Aggregated metrics
        const totalCampaigns = campaigns.length;
        const activeCampaigns = campaigns.filter((c) => c.status === "active").length;
        const totalBudgetUsed = campaigns.reduce((s, c) => s + (Number(c.budgetUsed) || 0), 0);
        // total games played across brand
        const totalGamesPlayed = allSessions.length;
        // unique players across all brand campaigns
        const uniquePlayerIds = Array.from(new Set(allSessions.map((s) => String(s.userId))));
        const uniquePlayers = uniquePlayerIds.filter((id) => id && id !== "undefined").length;
        // average completion time (in ms) across all completed sessions
        const completedSessions = allSessions.filter((s) => s.status === "completed");
        const avgPlayTime = completedSessions.length
            ? Math.round(completedSessions.reduce((s, sess) => s + (sess.totalCompletionTimeMs || 0), 0) / completedSessions.length)
            : 0;
        // per-campaign analytics
        for (const c of campaigns) {
            const sessions = allSessions.filter((s) => String(s.campaignId) === String(c._id));
            const plays = sessions.length;
            const completed = sessions.filter((s) => s.status === "completed");
            const completions = completed.length;
            const avgCompletionTime = completed.length
                ? Math.round(completed.reduce((s, sess) => s + (sess.totalCompletionTimeMs || 0), 0) / completed.length)
                : 0;
            // question correctness rates (from each session's first quiz attempt)
            const qCorrectCounts = (c.questions || []).map(() => 0);
            for (const s of sessions) {
                const answers = (_b = (_a = s.quiz) === null || _a === void 0 ? void 0 : _a.firstAttempt) === null || _b === void 0 ? void 0 : _b.answers;
                if (Array.isArray(answers)) {
                    for (let i = 0; i < answers.length && i < (c.questions || []).length; i++) {
                        if (answers[i] === c.questions[i].correctIndex)
                            qCorrectCounts[i]++;
                    }
                }
            }
            const qRates = qCorrectCounts.map((cnt) => (plays ? cnt / plays : 0));
            campaignsAnalytics.push({
                campaignId: c._id,
                title: c.title,
                plays,
                completions,
                avgCompletionTime,
                questionCorrectnessRates: qRates,
            });
        }
        res.status(200).json({
            success: true,
            analytics: {
                totalCampaigns,
                activeCampaigns,
                totalBudgetUsed,
                totalGamesPlayed,
                uniquePlayers,
                avgPlayTime,
                campaigns: campaignsAnalytics,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch campaign analytics: ${error.message}`, 500));
    }
}));
// Get all brands
exports.getAllBrands = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Find all users with role 'brand'
        const brandUsers = yield user_model_1.default.find({ role: "brand" })
            .select("_id name email companyName avatar isVerified createdAt")
            .lean();
        // Get brand details for each brand user
        const brands = yield Promise.all(brandUsers.map((brandUser) => __awaiter(void 0, void 0, void 0, function* () {
            const brandProfile = yield brand_model_1.default.findOne({
                userId: brandUser._id,
            }).lean();
            const campaignCount = yield puzzleCampaign_model_1.default.countDocuments({
                brandId: brandUser._id,
            });
            return {
                _id: brandUser._id,
                name: brandUser.name,
                email: brandUser.email,
                companyName: brandUser.companyName,
                avatar: brandUser.avatar,
                isVerified: brandUser.isVerified,
                createdAt: brandUser.createdAt,
                brandDetails: brandProfile
                    ? {
                        companyEmail: brandProfile.companyEmail,
                        verified: brandProfile.verified,
                        totalCampaigns: campaignCount,
                    }
                    : null,
            };
        })));
        res.status(200).json({ success: true, brands });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch brands: ${error.message}`, 500));
    }
}));
