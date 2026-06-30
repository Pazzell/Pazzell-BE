import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";
import PuzzleAttemptModel from "../models/puzzleAttempt.model";
import UserModel from "../models/user.model";
import PackageModel from "../models/package.model";
import BrandModel from "../models/brand.model";
import ReferralModel from "../models/referral.model";
import ReferralEventModel from "../models/referralEvent.model";
import { getStorageService } from "../services/storage/storageFactory";
import axios from "axios";

// Points awarded to the referrer once their referred user's referral is
// marked successful (first solved puzzle)
const REFERRAL_POINTS = 3;

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
        filter.gameType = gameType;
      }

      const campaigns = await PuzzleCampaignModel.find(filter)
        .select(
          "_id brandId packageId gameType title description brandUrl campaignUrl videoUrl puzzleImageUrl passage timeLimit questions words status paymentStatus packageType totalBudget dailyAllocation budgetRemaining budgetUsed transactionId startDate endDate createdAt"
        )
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
          return {
            _id: campaign._id,
            brandId: campaign.brandId,
            packageId: campaign.packageId,
            packageName: packageData?.name || null,
            brandName: brand?.companyName || brand?.name || "Unknown Brand",
            gameType: campaign.gameType,
            title: campaign.title,
            description: campaign.description,
            brandUrl: campaign.brandUrl,
            campaignUrl: campaign.campaignUrl,
            videoUrl: (campaign as any).videoUrl || null,
            puzzleImageUrl: campaign.puzzleImageUrl,
            passage: (campaign as any).passage || null,
            timeLimit: campaign.timeLimit,
            questions: campaign.questions,
            words: campaign.words,
            status: campaign.status,
            paymentStatus: (campaign as any).paymentStatus || "unpaid",
            packageType: (campaign as any).packageType || null,
            totalBudget: (campaign as any).totalBudget || 0,
            dailyAllocation: (campaign as any).dailyAllocation || 0,
            budgetRemaining: (campaign as any).budgetRemaining || 0,
            budgetUsed: (campaign as any).budgetUsed || 0,
            transactionId: (campaign as any).transactionId || null,
            startDate: campaign.startDate,
            endDate: campaign.endDate,
            createdAt: (campaign as any).createdAt,
          };
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
        filter.gameType = gameType;
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
        .select(
          "_id brandId packageId gameType title description brandUrl campaignUrl videoUrl puzzleImageUrl passage timeLimit questions words status paymentStatus packageType totalBudget dailyAllocation budgetRemaining budgetUsed transactionId startDate endDate createdAt"
        )
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
          return {
            _id: campaign._id,
            brandId: campaign.brandId,
            packageId: campaign.packageId,
            packageName: packageData?.name || null,
            brandName: brand?.companyName || brand?.name || "Unknown Brand",
            gameType: campaign.gameType,
            title: campaign.title,
            description: campaign.description,
            brandUrl: campaign.brandUrl,
            campaignUrl: campaign.campaignUrl,
            videoUrl: (campaign as any).videoUrl || null,
            puzzleImageUrl: campaign.puzzleImageUrl,
            passage: (campaign as any).passage || null,
            timeLimit: campaign.timeLimit,
            questions: campaign.questions,
            words: campaign.words,
            status: campaign.status,
            paymentStatus: (campaign as any).paymentStatus || "unpaid",
            packageType: (campaign as any).packageType || null,
            totalBudget: (campaign as any).totalBudget || 0,
            dailyAllocation: (campaign as any).dailyAllocation || 0,
            budgetRemaining: (campaign as any).budgetRemaining || 0,
            budgetUsed: (campaign as any).budgetUsed || 0,
            transactionId: (campaign as any).transactionId || null,
            startDate: campaign.startDate,
            endDate: campaign.endDate,
            createdAt: (campaign as any).createdAt,
          };
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
        .select(
          "_id brandId packageId gameType title description brandUrl campaignUrl videoUrl puzzleImageUrl passage timeLimit questions words status paymentStatus packageType totalBudget dailyAllocation budgetRemaining budgetUsed transactionId startDate endDate createdAt"
        )
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
          return {
            _id: campaign._id,
            brandId: campaign.brandId,
            packageId: campaign.packageId,
            packageName: packageData?.name || null,
            brandName,
            gameType: campaign.gameType,
            title: campaign.title,
            description: campaign.description,
            brandUrl: campaign.brandUrl,
            campaignUrl: campaign.campaignUrl,
            videoUrl: (campaign as any).videoUrl || null,
            puzzleImageUrl: campaign.puzzleImageUrl,
            passage: (campaign as any).passage || null,
            timeLimit: campaign.timeLimit,
            questions: campaign.questions,
            words: campaign.words,
            status: campaign.status,
            paymentStatus: (campaign as any).paymentStatus || "unpaid",
            packageType: (campaign as any).packageType || null,
            totalBudget: (campaign as any).totalBudget || 0,
            dailyAllocation: (campaign as any).dailyAllocation || 0,
            budgetRemaining: (campaign as any).budgetRemaining || 0,
            budgetUsed: (campaign as any).budgetUsed || 0,
            transactionId: (campaign as any).transactionId || null,
            startDate: campaign.startDate,
            endDate: campaign.endDate,
            createdAt: (campaign as any).createdAt,
          };
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
          _id: campaign._id,
          brandId: campaign.brandId,
          packageId: campaign.packageId,
          packageName: packageData?.name || null,
          brandName,
          gameType: campaign.gameType,
          title: campaign.title,
          description: campaign.description,
          brandUrl: campaign.brandUrl,
          campaignUrl: campaign.campaignUrl,
          videoUrl: (campaign as any).videoUrl || null,
          puzzleImageUrl: campaign.puzzleImageUrl,
          passage: (campaign as any).passage || null,
          questions: campaign.questions.map((q: any) => ({
            question: q.question,
            choices: q.choices,
            correctIndex: q.correctIndex,
          })),
          words: campaign.words,
          timeLimit: campaign.timeLimit,
          status: campaign.status,
          paymentStatus: (campaign as any).paymentStatus || "unpaid",
          packageType: (campaign as any).packageType || null,
          totalBudget: (campaign as any).totalBudget || 0,
          dailyAllocation: (campaign as any).dailyAllocation || 0,
          budgetRemaining: (campaign as any).budgetRemaining || 0,
          budgetUsed: (campaign as any).budgetUsed || 0,
          transactionId: (campaign as any).transactionId || null,
          startDate: campaign.startDate,
          endDate: campaign.endDate,
          createdAt: (campaign as any).createdAt,
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

// Check if current user has completed a campaign
export const checkCampaignCompletion = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { campaignId } = req.params;
      const user = req.user as any;
      const userId = user && user._id ? String(user._id) : undefined;

      if (!userId) {
        return next(new ErrorHandler("User not authenticated", 401));
      }

      // Check if user has already solved this campaign
      const previousAttempt = await PuzzleAttemptModel.findOne({
        userId: userId,
        campaignId: campaignId,
        solved: true,
      }).lean();

      const hasCompletedByCurrentUser = !!previousAttempt;

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

// Submit campaign result along with quiz answers
interface ISubmitBody {
  timeTaken: number; // ms
  movesTaken: number;
  solved: boolean;
  answers: number[]; // indexes selected for questions
}

export const submitCampaign = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { campaignId } = req.params;
      const user = req.user as any;
      const userId = user && user._id ? String(user._id) : undefined;
      const body = req.body as ISubmitBody;

      const campaign = await PuzzleCampaignModel.findById(campaignId);
      if (!campaign) {
        return next(
          new ErrorHandler(
            "Campaign not found. Please check the campaign ID and try again.",
            404
          )
        );
      }

      // compute quiz score
      let quizScore = 0;
      if (Array.isArray(body.answers)) {
        for (
          let i = 0;
          i < Math.min(body.answers.length, campaign.questions.length);
          i++
        ) {
          console.log(
            `Question ${i}: User answered ${body.answers[i]}, Correct answer is ${campaign.questions[i].correctIndex}`
          );
          if (body.answers[i] === campaign.questions[i].correctIndex) {
            quizScore++;
          }
        }
      }

      // Check if all questions were answered correctly
      const totalQuestions = campaign.questions.length;
      const allQuestionsCorrect = quizScore === totalQuestions;

      console.log(
        `Quiz Score: ${quizScore}/${totalQuestions}, All Correct: ${allQuestionsCorrect}`
      );
      console.log(`Solved: ${body.solved}`);

      // determine if first-time ever solved (used for unique puzzle counts)
      let firstTime = false;
      if (body.solved && allQuestionsCorrect) {
        const prevEver = await PuzzleAttemptModel.findOne({
          userId: userId,
          campaignId: campaignId,
          solved: true,
        });
        console.log(`Previous successful attempt ever found: ${!!prevEver}`);
        if (!prevEver) firstTime = true;
      }

      // Allow users to earn points only 1 time per DAY for the same campaign.
      // Count today's successful attempts for this user+campaign.
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const todaysSuccessCount = await PuzzleAttemptModel.countDocuments({
        userId: userId,
        campaignId: campaignId,
        solved: true,
        timestamp: { $gte: startOfDay, $lte: endOfDay },
      });

      const canEarnPointsNow =
        body.solved && allQuestionsCorrect && todaysSuccessCount < 1;

      // Simplified fixed-point scoring (time/moves recorded but not used)
      let pointsEarned = 0;

      if (canEarnPointsNow) {
        const FIXED_POINTS: { [key: string]: number } = {
          spot_the_difference: 1,
          card_matching: 1,
          sliding_puzzle: 2,
          word_hunt: 1,
        };

        pointsEarned = FIXED_POINTS[campaign.gameType] || 0;
        console.log(`Points (fixed) for ${campaign.gameType}:`, pointsEarned);
      }

      console.log(
        `First Time: ${firstTime}, Today's successes: ${todaysSuccessCount}, Points Earned: ${pointsEarned}`
      );

      const attempt = await PuzzleAttemptModel.create({
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
      const userDoc = userId ? await UserModel.findById(userId) : null;
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
        await userDoc.save();

        // If this is the user's first successful solve ever, mark any
        // pending referral as successful and record the points + event.
        // Referral points are NOT added to the referrer's lifetime totals:
        // the referral reward is based on the highest referral points within
        // a given month, so points must stay scoped to the month the
        // referral became successful (via `successfulAt`) rather than
        // accumulate permanently. Monthly rankings are computed on demand
        // from the Referral collection (see getReferralSummary /
        // finalizeMonthlyRewards), which resets naturally each month.
        try {
          if (firstTime && userId) {
            const referral = await ReferralModel.findOne({
              referredUserId: String(userId),
              successful: false,
            });
            if (referral) {
              referral.successful = true;
              referral.successfulAt = new Date();
              referral.pointsAwarded = REFERRAL_POINTS;
              await referral.save();

              await ReferralEventModel.create({
                referrerId: referral.referrerId,
                referredUserId: referral.referredUserId,
                eventType: "first_puzzle",
              });
            }
          }
        } catch (err) {
          // non-fatal: log and continue
          console.error("Referral marking failed:", err);
        }
      }

      // Remove user from "currently playing" after submitting
      if (userId) {
        const redis = require("../utils/redis").redis;
        await redis.srem("users:currently_playing", userId);
        await redis.del(`user:${userId}:playing`);
      }

      res.status(201).json({
        success: true,
        attempt,
        gameType: campaign.gameType,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(
          `Failed to submit campaign result: ${error.message}`,
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

      const stringFields = ["title", "description", "startDate", "endDate", "status", "paymentStatus", "brandUrl", "campaignUrl", "videoUrl", "passage"];
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
