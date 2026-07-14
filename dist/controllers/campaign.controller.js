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
exports.deleteCampaign = exports.updateCampaign = exports.generateCampaignQuestions = exports.checkCampaignCompletion = exports.getCampaignById = exports.getCampaignsByBrand = exports.getAllCampaigns = exports.getActiveCampaigns = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const puzzleCampaign_model_1 = __importDefault(require("../models/puzzleCampaign.model"));
const user_model_1 = __importDefault(require("../models/user.model"));
const package_model_1 = __importDefault(require("../models/package.model"));
const brand_model_1 = __importDefault(require("../models/brand.model"));
const storageFactory_1 = require("../services/storage/storageFactory");
const gameSession_service_1 = require("../services/session/gameSession.service");
const axios_1 = __importDefault(require("axios"));
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
const CAMPAIGN_LIST_FIELDS = "_id brandId packageId gameTypes title description brandUrl campaignUrl videoUrl videoDurationSeconds videoSizeBytes videoMimeType puzzleImageUrl timeLimit questions words status paymentStatus packageType totalBudget dailyAllocation budgetRemaining budgetUsed transactionId prizeDescription prizeUnitsAvailable durationWeeks weeklyPrice startDate endDate createdAt";
function mapCampaignListItem(campaign, extra) {
    return {
        _id: campaign._id,
        brandId: campaign.brandId,
        packageId: campaign.packageId,
        packageName: extra.packageName,
        brandName: extra.brandName,
        gameTypes: campaign.gameTypes,
        title: campaign.title,
        description: campaign.description,
        brandUrl: campaign.brandUrl,
        campaignUrl: campaign.campaignUrl,
        videoUrl: campaign.videoUrl || null,
        videoDurationSeconds: campaign.videoDurationSeconds || null,
        videoSizeBytes: campaign.videoSizeBytes || null,
        videoMimeType: campaign.videoMimeType || null,
        puzzleImageUrl: campaign.puzzleImageUrl,
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
        prizeDescription: campaign.prizeDescription || null,
        prizeUnitsAvailable: campaign.prizeUnitsAvailable || 1,
        durationWeeks: campaign.durationWeeks || null,
        weeklyPrice: campaign.weeklyPrice || null,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
        createdAt: campaign.createdAt,
    };
}
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
            "spot_the_difference",
            "word_hunt",
        ];
        if (gameType && validGameTypes.includes(gameType)) {
            filter.gameTypes = gameType;
        }
        const campaigns = yield puzzleCampaign_model_1.default.find(filter)
            .select(CAMPAIGN_LIST_FIELDS)
            .lean();
        // Fetch brand names and package names for all campaigns
        const campaignsWithBrand = yield Promise.all(campaigns.map((campaign) => __awaiter(void 0, void 0, void 0, function* () {
            const brand = yield user_model_1.default.findById(campaign.brandId)
                .select("name companyName")
                .lean();
            const packageData = yield package_model_1.default.findById(campaign.packageId)
                .select("name")
                .lean();
            return mapCampaignListItem(campaign, {
                packageName: (packageData === null || packageData === void 0 ? void 0 : packageData.name) || null,
                brandName: (brand === null || brand === void 0 ? void 0 : brand.companyName) || (brand === null || brand === void 0 ? void 0 : brand.name) || "Unknown Brand",
            });
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
            "spot_the_difference",
            "word_hunt",
        ];
        if (gameType && validGameTypes.includes(gameType)) {
            filter.gameTypes = gameType;
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
            .select(CAMPAIGN_LIST_FIELDS)
            .lean();
        // Fetch brand names and package names for all campaigns
        const campaignsWithBrand = yield Promise.all(campaigns.map((campaign) => __awaiter(void 0, void 0, void 0, function* () {
            const brand = yield user_model_1.default.findById(campaign.brandId)
                .select("name companyName")
                .lean();
            const packageData = yield package_model_1.default.findById(campaign.packageId)
                .select("name")
                .lean();
            return mapCampaignListItem(campaign, {
                packageName: (packageData === null || packageData === void 0 ? void 0 : packageData.name) || null,
                brandName: (brand === null || brand === void 0 ? void 0 : brand.companyName) || (brand === null || brand === void 0 ? void 0 : brand.name) || "Unknown Brand",
            });
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
            .select(CAMPAIGN_LIST_FIELDS)
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
            return mapCampaignListItem(campaign, {
                packageName: (packageData === null || packageData === void 0 ? void 0 : packageData.name) || null,
                brandName,
            });
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
            campaign: Object.assign(Object.assign({}, mapCampaignListItem(campaign, {
                packageName: (packageData === null || packageData === void 0 ? void 0 : packageData.name) || null,
                brandName,
            })), { questions: campaign.questions.map((q) => ({
                    question: q.question,
                    choices: q.choices,
                    correctIndex: q.correctIndex,
                })) }),
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch campaign details: ${error.message}`, 500));
    }
}));
// Check if current user has completed a campaign. Also drives the "replay is
// just for fun" client-side warning, based on the GameSession
// first-completion guard.
exports.checkCampaignCompletion = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { campaignId } = req.params;
        const user = req.user;
        const userId = user && user._id ? String(user._id) : undefined;
        if (!userId) {
            return next(new ErrorHandler_1.default("User not authenticated", 401));
        }
        const hasCompletedByCurrentUser = yield (0, gameSession_service_1.hasFirstCompletion)(userId, campaignId);
        res.status(200).json({
            success: true,
            hasCompletedByCurrentUser,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to check campaign completion status: ${error.message}`, 500));
    }
}));
// ---------------------------------------------------------------------------
// AI provider helper — controlled by .env
//
//  To use OpenAI (ChatGPT):
//    AI_PROVIDER=openai
//    OPENAI_API_KEY=sk-...
//
//  To use Anthropic (Claude):
//    AI_PROVIDER=claude
//    ANTHROPIC_API_KEY=sk-ant-...
//
//  To use Google Gemini:
//    AI_PROVIDER=gemini
//    GEMINI_API_KEY=AIza...
//
//  When AI_PROVIDER is not set it defaults to "openai".
// ---------------------------------------------------------------------------
const AI_PROMPT = (passage) => `Generate exactly 5 multiple-choice quiz questions based on the following short passage about a brand:\n\n"${passage}"\n\nRules:\n- Each question must have exactly 4 answer choices\n- Only one choice is correct per question\n- All questions must be answerable directly from the passage\n- Keep questions clear and concise\n- correctIndex must be the 0-based index (0, 1, 2, or 3) of the correct choice\n\nReturn ONLY a valid JSON array with no extra text, in this exact structure:\n[\n  {\n    "question": "Question text?",\n    "choices": ["Choice A", "Choice B", "Choice C", "Choice D"],\n    "correctIndex": 0\n  }\n]`;
function callOpenAI(prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey)
            throw new Error("OPENAI_API_KEY is not set");
        const response = yield axios_1.default.post("https://api.openai.com/v1/chat/completions", {
            model: "gpt-4o-mini",
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }],
        }, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
        });
        const data = response.data;
        return ((_c = (_b = (_a = data === null || data === void 0 ? void 0 : data.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) || "";
    });
}
function callClaude(prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey)
            throw new Error("ANTHROPIC_API_KEY is not set");
        const response = yield axios_1.default.post("https://api.anthropic.com/v1/messages", {
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }],
        }, {
            headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
        });
        const data = response.data;
        return ((_b = (_a = data === null || data === void 0 ? void 0 : data.content) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.text) || "";
    });
}
function callGemini(prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey)
            throw new Error("GEMINI_API_KEY is not set");
        const response = yield axios_1.default.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1024 },
        }, { headers: { "Content-Type": "application/json" } });
        const data = response.data;
        return ((_e = (_d = (_c = (_b = (_a = data === null || data === void 0 ? void 0 : data.candidates) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.text) || "";
    });
}
// Generate 5 quiz questions from a brand passage using the configured AI provider
exports.generateCampaignQuestions = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        const user = req.user;
        if (!user || user.role !== "brand") {
            return next(new ErrorHandler_1.default("Only brands can generate quiz questions", 403));
        }
        const { passage } = req.body;
        if (!passage || typeof passage !== "string" || passage.trim() === "") {
            return next(new ErrorHandler_1.default("passage is required", 400));
        }
        const trimmedPassage = passage.trim();
        if (trimmedPassage.length > 1000) {
            return next(new ErrorHandler_1.default("passage must be 1000 characters or less", 400));
        }
        // Switch between AI providers based on AI_PROVIDER env var (defaults to openai)
        const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
        let rawText;
        if (provider === "claude") {
            rawText = yield callClaude(AI_PROMPT(trimmedPassage));
        }
        else if (provider === "gemini") {
            rawText = yield callGemini(AI_PROMPT(trimmedPassage));
        }
        else {
            rawText = yield callOpenAI(AI_PROMPT(trimmedPassage));
        }
        // Extract the JSON array from the response text
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            return next(new ErrorHandler_1.default("AI returned an unexpected response. Please try again.", 500));
        }
        let questions;
        try {
            questions = JSON.parse(jsonMatch[0]);
        }
        catch (_l) {
            return next(new ErrorHandler_1.default("AI returned malformed JSON. Please try again.", 500));
        }
        if (!Array.isArray(questions) || questions.length === 0) {
            return next(new ErrorHandler_1.default("AI did not return any questions. Please try again.", 500));
        }
        // Validate and normalise each question
        const validated = questions.slice(0, 5).map((q, idx) => {
            if (typeof q.question !== "string" ||
                !Array.isArray(q.choices) ||
                q.choices.length < 2 ||
                typeof q.correctIndex !== "number") {
                throw new Error(`Question ${idx + 1} has an invalid format`);
            }
            return {
                question: q.question,
                choices: q.choices.slice(0, 4).map(String),
                correctIndex: Math.max(0, Math.min(q.correctIndex, q.choices.length - 1)),
            };
        });
        res.status(200).json({ success: true, questions: validated, provider });
    }
    catch (error) {
        const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
        if (((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) === 401) {
            return next(new ErrorHandler_1.default(`AI service (${provider}) authentication failed — check your API key`, 500));
        }
        if (((_b = error.response) === null || _b === void 0 ? void 0 : _b.status) === 429) {
            const providerMsg = ((_e = (_d = (_c = error.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.error) === null || _e === void 0 ? void 0 : _e.message) ||
                ((_h = (_g = (_f = error.response) === null || _f === void 0 ? void 0 : _f.data) === null || _g === void 0 ? void 0 : _g.error) === null || _h === void 0 ? void 0 : _h.code) ||
                ((_k = (_j = error.response) === null || _j === void 0 ? void 0 : _j.data) === null || _k === void 0 ? void 0 : _k.message) ||
                "rate limit exceeded";
            return next(new ErrorHandler_1.default(`AI service (${provider}) rate limited: ${providerMsg}`, 429));
        }
        return next(new ErrorHandler_1.default(`Failed to generate questions (${provider}): ${error.message}`, 500));
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
        if (user.role === "brand") {
            if (String(campaign.brandId) !== String(user._id)) {
                return next(new ErrorHandler_1.default("Not authorized to edit this campaign", 403));
            }
        }
        else if (user.role !== "admin") {
            return next(new ErrorHandler_1.default("Not authorized to edit this campaign", 403));
        }
        // Multipart fields arrive as strings — coerce before using
        const body = req.body;
        const updates = {};
        const stringFields = ["title", "description", "startDate", "endDate", "status", "paymentStatus", "brandUrl", "campaignUrl", "videoUrl"];
        for (const key of stringFields) {
            if (body[key] !== undefined)
                updates[key] = body[key];
        }
        if (body.timeLimit !== undefined)
            updates.timeLimit = Number(body.timeLimit);
        if (body.totalBudget !== undefined)
            updates.totalBudget = Number(body.totalBudget);
        if (body.dailyAllocation !== undefined)
            updates.dailyAllocation = Number(body.dailyAllocation);
        if (body.budgetRemaining !== undefined)
            updates.budgetRemaining = Number(body.budgetRemaining);
        if (body.budgetUsed !== undefined)
            updates.budgetUsed = Number(body.budgetUsed);
        if (body.questions !== undefined) {
            updates.questions = typeof body.questions === "string" ? JSON.parse(body.questions) : body.questions;
        }
        if (body.words !== undefined) {
            updates.words = typeof body.words === "string" ? JSON.parse(body.words) : body.words;
        }
        // Handle optional image replacement
        const uploadedFile = req.file;
        if (uploadedFile) {
            const storage = (0, storageFactory_1.getStorageService)();
            const now = Date.now();
            const fileName = `${now}-${uploadedFile.originalname}`;
            const result = yield storage.uploadFile({
                buffer: uploadedFile.buffer,
                mimetype: uploadedFile.mimetype,
                originalname: fileName,
                folder: "puzzles",
                fileName,
            });
            updates.puzzleImageUrl = result.url;
        }
        const updated = yield puzzleCampaign_model_1.default.findByIdAndUpdate(campaignId, { $set: updates }, { new: true }).lean();
        if (!updated)
            return next(new ErrorHandler_1.default("Campaign not found", 404));
        // Enrich response with brandName/packageName, matching the shape
        // returned by the other campaign endpoints (get/list).
        const brand = yield user_model_1.default.findById(updated.brandId)
            .select("name companyName")
            .lean();
        const packageData = yield package_model_1.default.findById(updated.packageId)
            .select("name")
            .lean();
        res.status(200).json({
            success: true,
            campaign: Object.assign(Object.assign({}, updated), { brandName: (brand === null || brand === void 0 ? void 0 : brand.companyName) || (brand === null || brand === void 0 ? void 0 : brand.name) || "Unknown Brand", packageName: (packageData === null || packageData === void 0 ? void 0 : packageData.name) || null }),
        });
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
