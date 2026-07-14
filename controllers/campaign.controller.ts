import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";
import UserModel from "../models/user.model";
import PackageModel from "../models/package.model";
import BrandModel from "../models/brand.model";
import { getStorageService } from "../services/storage/storageFactory";
import { hasFirstCompletion } from "../services/session/gameSession.service";
import axios from "axios";

// Helper function to check and update expired campaigns
const updateExpiredCampaigns = async () => {
  const now = new Date();
  await PuzzleCampaignModel.updateMany(
    {
      status: "active",
      paymentStatus: "paid",
      endDate: { $lt: now },
    },
    {
      $set: { status: "ended" },
    }
  );
};

const CAMPAIGN_LIST_FIELDS =
  "_id brandId packageId gameTypes title description brandUrl campaignUrl videoUrl videoDurationSeconds videoSizeBytes videoMimeType puzzleImageUrl timeLimit questions words status paymentStatus packageType totalBudget dailyAllocation budgetRemaining budgetUsed transactionId prizeDescription prizeUnitsAvailable durationWeeks weeklyPrice startDate endDate createdAt";

function mapCampaignListItem(
  campaign: any,
  extra: { packageName: string | null; brandName: string }
) {
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
export const getActiveCampaigns = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Update expired campaigns before fetching
      await updateExpiredCampaigns();

      const { gameType } = req.query;

      // Build filter for active campaigns only
      const filter: any = { status: "active" };
      const validGameTypes = [
        "sliding_puzzle",
        "card_matching",
        "spot_the_difference",
        "word_hunt",
      ];
      if (gameType && validGameTypes.includes(gameType as string)) {
        filter.gameTypes = gameType;
      }

      const campaigns = await PuzzleCampaignModel.find(filter)
        .select(CAMPAIGN_LIST_FIELDS)
        .lean();

      // Fetch brand names and package names for all campaigns
      const campaignsWithBrand = await Promise.all(
        campaigns.map(async (campaign) => {
          const brand = await UserModel.findById(campaign.brandId)
            .select("name companyName")
            .lean();
          const packageData = await PackageModel.findById(campaign.packageId)
            .select("name")
            .lean();
          return mapCampaignListItem(campaign, {
            packageName: packageData?.name || null,
            brandName: brand?.companyName || brand?.name || "Unknown Brand",
          });
        })
      );

      res.status(200).json({ success: true, campaigns: campaignsWithBrand });
    } catch (error: any) {
      return next(
        new ErrorHandler(
          `Failed to fetch active campaigns: ${error.message}`,
          500
        )
      );
    }
  }
);

// Get all campaigns (with brand name included)
export const getAllCampaigns = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Update expired campaigns before fetching
      await updateExpiredCampaigns();

      const { gameType, status, paymentStatus } = req.query;

      // Build filter
      const filter: any = {};
      const validGameTypes = [
        "sliding_puzzle",
        "card_matching",
        "spot_the_difference",
        "word_hunt",
      ];
      if (gameType && validGameTypes.includes(gameType as string)) {
        filter.gameTypes = gameType;
      }

      // Filter by status if provided
      const validStatuses = ["active", "ended", "draft"];
      if (status && validStatuses.includes(status as string)) {
        filter.status = status;
      }

      // Filter by paymentStatus if provided
      const validPaymentStatuses = ["unpaid", "paid", "partial"];
      if (
        paymentStatus &&
        validPaymentStatuses.includes(paymentStatus as string)
      ) {
        filter.paymentStatus = paymentStatus;
      }

      const campaigns = await PuzzleCampaignModel.find(filter)
        .select(CAMPAIGN_LIST_FIELDS)
        .lean();

      // Fetch brand names and package names for all campaigns
      const campaignsWithBrand = await Promise.all(
        campaigns.map(async (campaign) => {
          const brand = await UserModel.findById(campaign.brandId)
            .select("name companyName")
            .lean();
          const packageData = await PackageModel.findById(campaign.packageId)
            .select("name")
            .lean();
          return mapCampaignListItem(campaign, {
            packageName: packageData?.name || null,
            brandName: brand?.companyName || brand?.name || "Unknown Brand",
          });
        })
      );

      res.status(200).json({ success: true, campaigns: campaignsWithBrand });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to fetch campaigns: ${error.message}`, 500)
      );
    }
  }
);

// Get campaigns by brandId
export const getCampaignsByBrand = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Update expired campaigns before fetching
      await updateExpiredCampaigns();

      const { brandId } = req.params;

      const campaigns = await PuzzleCampaignModel.find({ brandId })
        .select(CAMPAIGN_LIST_FIELDS)
        .lean();

      if (!campaigns || campaigns.length === 0) {
        return res.status(200).json({ success: true, campaigns: [] });
      }

      // Fetch brand name
      const brand = await UserModel.findById(brandId)
        .select("name companyName")
        .lean();
      const brandName = brand?.companyName || brand?.name || "Unknown Brand";

      // Fetch package names for all campaigns
      const campaignsWithBrand = await Promise.all(
        campaigns.map(async (campaign) => {
          const packageData = await PackageModel.findById(campaign.packageId)
            .select("name")
            .lean();
          return mapCampaignListItem(campaign, {
            packageName: packageData?.name || null,
            brandName,
          });
        })
      );

      res.status(200).json({ success: true, campaigns: campaignsWithBrand });
    } catch (error: any) {
      return next(
        new ErrorHandler(
          `Failed to fetch campaigns for brand: ${error.message}`,
          500
        )
      );
    }
  }
);

// Get single campaign by campaignId (with brand name)
export const getCampaignById = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Update expired campaigns before fetching
      await updateExpiredCampaigns();

      const { campaignId } = req.params;
      const campaign = await PuzzleCampaignModel.findById(campaignId).lean();

      if (!campaign) {
        return next(new ErrorHandler("Campaign not found", 404));
      }

      // Fetch brand name and package name
      const brand = await UserModel.findById(campaign.brandId)
        .select("name companyName")
        .lean();
      const brandName = brand?.companyName || brand?.name || "Unknown Brand";
      const packageData = await PackageModel.findById(campaign.packageId)
        .select("name")
        .lean();

      res.status(200).json({
        success: true,
        campaign: {
          ...mapCampaignListItem(campaign, {
            packageName: packageData?.name || null,
            brandName,
          }),
          questions: campaign.questions.map((q: any) => ({
            question: q.question,
            choices: q.choices,
            correctIndex: q.correctIndex,
          })),
        },
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(
          `Failed to fetch campaign details: ${error.message}`,
          500
        )
      );
    }
  }
);

// Check if current user has completed a campaign. Also drives the "replay is
// just for fun" client-side warning, based on the GameSession
// first-completion guard.
export const checkCampaignCompletion = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { campaignId } = req.params;
      const user = req.user as any;
      const userId = user && user._id ? String(user._id) : undefined;

      if (!userId) {
        return next(new ErrorHandler("User not authenticated", 401));
      }

      const hasCompletedByCurrentUser = await hasFirstCompletion(userId, campaignId);

      res.status(200).json({
        success: true,
        hasCompletedByCurrentUser,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(
          `Failed to check campaign completion status: ${error.message}`,
          500
        )
      );
    }
  }
);

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

const AI_PROMPT = (passage: string) =>
  `Generate exactly 5 multiple-choice quiz questions based on the following short passage about a brand:\n\n"${passage}"\n\nRules:\n- Each question must have exactly 4 answer choices\n- Only one choice is correct per question\n- All questions must be answerable directly from the passage\n- Keep questions clear and concise\n- correctIndex must be the 0-based index (0, 1, 2, or 3) of the correct choice\n\nReturn ONLY a valid JSON array with no extra text, in this exact structure:\n[\n  {\n    "question": "Question text?",\n    "choices": ["Choice A", "Choice B", "Choice C", "Choice D"],\n    "correctIndex": 0\n  }\n]`;

async function callOpenAI(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  const data = response.data as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data?.choices?.[0]?.message?.content || "";
}

async function callClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    },
    {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
    }
  );

  const data = response.data as { content?: Array<{ text?: string }> };
  return data?.content?.[0]?.text || "";
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1024 },
    },
    { headers: { "Content-Type": "application/json" } }
  );

  const data = response.data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// Generate 5 quiz questions from a brand passage using the configured AI provider
export const generateCampaignQuestions = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;
      if (!user || user.role !== "brand") {
        return next(
          new ErrorHandler("Only brands can generate quiz questions", 403)
        );
      }

      const { passage } = req.body;
      if (!passage || typeof passage !== "string" || passage.trim() === "") {
        return next(new ErrorHandler("passage is required", 400));
      }
      const trimmedPassage = passage.trim();
      if (trimmedPassage.length > 1000) {
        return next(
          new ErrorHandler("passage must be 1000 characters or less", 400)
        );
      }

      // Switch between AI providers based on AI_PROVIDER env var (defaults to openai)
      const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
      let rawText: string;

      if (provider === "claude") {
        rawText = await callClaude(AI_PROMPT(trimmedPassage));
      } else if (provider === "gemini") {
        rawText = await callGemini(AI_PROMPT(trimmedPassage));
      } else {
        rawText = await callOpenAI(AI_PROMPT(trimmedPassage));
      }

      // Extract the JSON array from the response text
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return next(
          new ErrorHandler(
            "AI returned an unexpected response. Please try again.",
            500
          )
        );
      }

      let questions: any[];
      try {
        questions = JSON.parse(jsonMatch[0]);
      } catch {
        return next(
          new ErrorHandler("AI returned malformed JSON. Please try again.", 500)
        );
      }

      if (!Array.isArray(questions) || questions.length === 0) {
        return next(
          new ErrorHandler("AI did not return any questions. Please try again.", 500)
        );
      }

      // Validate and normalise each question
      const validated = questions.slice(0, 5).map((q: any, idx: number) => {
        if (
          typeof q.question !== "string" ||
          !Array.isArray(q.choices) ||
          q.choices.length < 2 ||
          typeof q.correctIndex !== "number"
        ) {
          throw new Error(`Question ${idx + 1} has an invalid format`);
        }
        return {
          question: q.question,
          choices: q.choices.slice(0, 4).map(String),
          correctIndex: Math.max(0, Math.min(q.correctIndex, q.choices.length - 1)),
        };
      });

      res.status(200).json({ success: true, questions: validated, provider });
    } catch (error: any) {
      const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
      if (error.response?.status === 401) {
        return next(new ErrorHandler(`AI service (${provider}) authentication failed — check your API key`, 500));
      }
      if (error.response?.status === 429) {
        const providerMsg =
          error.response?.data?.error?.message ||
          error.response?.data?.error?.code ||
          error.response?.data?.message ||
          "rate limit exceeded";
        return next(
          new ErrorHandler(
            `AI service (${provider}) rate limited: ${providerMsg}`,
            429
          )
        );
      }
      return next(
        new ErrorHandler(`Failed to generate questions (${provider}): ${error.message}`, 500)
      );
    }
  }
);

// Update a campaign (brands can edit their own campaigns)
export const updateCampaign = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { campaignId } = req.params;
      const user = req.user as any;

      if (!user) return next(new ErrorHandler("User not authenticated", 401));

      const campaign = await PuzzleCampaignModel.findById(campaignId);
      if (!campaign) return next(new ErrorHandler("Campaign not found", 404));

      // Only the owning brand or admins can update
      if (user.role === "brand") {
        if (String(campaign.brandId) !== String(user._id)) {
          return next(
            new ErrorHandler("Not authorized to edit this campaign", 403)
          );
        }
      } else if (user.role !== "admin") {
        return next(
          new ErrorHandler("Not authorized to edit this campaign", 403)
        );
      }

      // Multipart fields arrive as strings — coerce before using
      const body = req.body as any;
      const updates: any = {};

      const stringFields = ["title", "description", "startDate", "endDate", "status", "paymentStatus", "brandUrl", "campaignUrl", "videoUrl"];
      for (const key of stringFields) {
        if (body[key] !== undefined) updates[key] = body[key];
      }

      if (body.timeLimit !== undefined) updates.timeLimit = Number(body.timeLimit);
      if (body.totalBudget !== undefined) updates.totalBudget = Number(body.totalBudget);
      if (body.dailyAllocation !== undefined) updates.dailyAllocation = Number(body.dailyAllocation);
      if (body.budgetRemaining !== undefined) updates.budgetRemaining = Number(body.budgetRemaining);
      if (body.budgetUsed !== undefined) updates.budgetUsed = Number(body.budgetUsed);

      if (body.questions !== undefined) {
        updates.questions = typeof body.questions === "string" ? JSON.parse(body.questions) : body.questions;
      }
      if (body.words !== undefined) {
        updates.words = typeof body.words === "string" ? JSON.parse(body.words) : body.words;
      }

      // Handle optional image replacement
      const uploadedFile = (req as any).file;
      if (uploadedFile) {
        const storage = getStorageService();
        const now = Date.now();
        const fileName = `${now}-${uploadedFile.originalname}`;
        const result = await storage.uploadFile({
          buffer: uploadedFile.buffer,
          mimetype: uploadedFile.mimetype,
          originalname: fileName,
          folder: "puzzles",
          fileName,
        });
        updates.puzzleImageUrl = result.url;
      }

      const updated = await PuzzleCampaignModel.findByIdAndUpdate(
        campaignId,
        { $set: updates },
        { new: true }
      ).lean();

      if (!updated) return next(new ErrorHandler("Campaign not found", 404));

      // Enrich response with brandName/packageName, matching the shape
      // returned by the other campaign endpoints (get/list).
      const brand = await UserModel.findById(updated.brandId)
        .select("name companyName")
        .lean();
      const packageData = await PackageModel.findById(updated.packageId)
        .select("name")
        .lean();

      res.status(200).json({
        success: true,
        campaign: {
          ...updated,
          brandName: brand?.companyName || brand?.name || "Unknown Brand",
          packageName: packageData?.name || null,
        },
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to update campaign: ${error.message}`, 500)
      );
    }
  }
);

// Delete a campaign (brands can delete their own campaigns)
export const deleteCampaign = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { campaignId } = req.params;
      const user = req.user as any;

      if (!user) return next(new ErrorHandler("User not authenticated", 401));

      const campaign = await PuzzleCampaignModel.findById(campaignId);
      if (!campaign) return next(new ErrorHandler("Campaign not found", 404));

      // Only the owning brand or admins can delete
      if (
        user.role === "brand" &&
        String(campaign.brandId) !== String(user._id)
      ) {
        return next(
          new ErrorHandler("Not authorized to delete this campaign", 403)
        );
      }

      await PuzzleCampaignModel.findByIdAndDelete(campaignId);

      // remove reference from BrandModel if present
      await BrandModel.findOneAndUpdate(
        { userId: campaign.brandId },
        { $pull: { campaigns: campaign._id } }
      );

      res.status(200).json({ success: true, message: "Campaign deleted" });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to delete campaign: ${error.message}`, 500)
      );
    }
  }
);
