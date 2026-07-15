import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";
import BrandModel from "../models/brand.model";
import { getStorageService } from "../services/storage/storageFactory";
import GameSessionModel from "../models/gameSession.model";
import UserModel from "../models/user.model";
import PackageModel from "../models/package.model";
import { computeWeeklyPricing } from "./payment.controller";
import { getQuizQuestionCount } from "../services/config/config.service";
import {
  validateVideoUpload,
  VideoValidationError,
} from "../services/video/videoValidation.service";

const ALL_GAME_TYPES = [
  "sliding_puzzle",
  "card_matching",
  "spot_the_difference",
  "word_hunt",
] as const;

// Create a multi-game puzzle campaign (brands only). All new campaigns span
// all four game types in a single submission. Expects multipart upload with
// two files: "image" (feeds sliding tiles + spot-the-difference) and "video"
// (~2 minutes, feeds the end-of-session quiz stage — quiz questions are
// authored manually by the brand, not AI-generated).
export const createCampaign = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const brandUser = req.user!;
      if (brandUser.role !== "brand")
        return next(new ErrorHandler("Only brands can create campaigns", 403));

      const {
        questions,
        title,
        description,
        words,
        packageId,
        brandUrl,
        campaignUrl,
        prizeDescription,
        prizeUnitsAvailable,
        durationWeeks,
      } = req.body;

      // Validate packageId
      if (!packageId || typeof packageId !== "string") {
        return next(
          new ErrorHandler(
            "packageId is required and must be a valid string",
            400
          )
        );
      }

      const packageData = await PackageModel.findById(packageId);
      if (!packageData) {
        return next(
          new ErrorHandler("Invalid package. Package not found.", 404)
        );
      }
      if (!packageData.isActive) {
        return next(new ErrorHandler("Selected package is not available", 400));
      }
      const packageType =
        packageData.name?.toLowerCase() === "premium" ? "premium" : "basic";

      // validate required text fields
      if (!title || typeof title !== "string" || title.trim() === "") {
        return next(
          new ErrorHandler(
            "title is required and must be a non-empty string",
            400
          )
        );
      }
      if (
        !description ||
        typeof description !== "string" ||
        description.trim() === ""
      ) {
        return next(
          new ErrorHandler(
            "description is required and must be a non-empty string",
            400
          )
        );
      }
      if (
        !prizeDescription ||
        typeof prizeDescription !== "string" ||
        prizeDescription.trim() === ""
      ) {
        return next(
          new ErrorHandler(
            "prizeDescription is required and must be a non-empty string",
            400
          )
        );
      }

      let parsedPrizeUnits = 1;
      if (prizeUnitsAvailable !== undefined && prizeUnitsAvailable !== null && prizeUnitsAvailable !== "") {
        parsedPrizeUnits = Number(prizeUnitsAvailable);
        if (!Number.isFinite(parsedPrizeUnits) || parsedPrizeUnits < 1) {
          return next(
            new ErrorHandler(
              "prizeUnitsAvailable must be a positive number",
              400
            )
          );
        }
      }

      // Duration: weeks only (weekly billing revert — replaces endMonth/timeLimit/weeksToRun)
      const parsedDurationWeeks = Number(durationWeeks);
      if (!Number.isFinite(parsedDurationWeeks) || parsedDurationWeeks <= 0) {
        return next(
          new ErrorHandler(
            "durationWeeks is required and must be a positive number",
            400
          )
        );
      }

      // Bag of words for word_hunt — now always required since every campaign
      // includes all four game types.
      let parsedWords: string[] = [];
      if (words) {
        if (typeof words === "string") {
          try {
            parsedWords = JSON.parse(words);
          } catch {
            parsedWords = words
              .split(",")
              .map((w) => w.trim())
              .filter((w) => w.length > 0);
          }
        } else if (Array.isArray(words)) {
          parsedWords = words;
        }
      }
      if (!parsedWords || parsedWords.length === 0) {
        return next(
          new ErrorHandler(
            "words array is required (bag of words for the word hunt game) and must contain at least one word",
            400
          )
        );
      }

      // Get brand profile (no restriction on number of campaigns)
      const brand = await BrandModel.findOne({ userId: brandUser._id });
      if (!brand) {
        return next(new ErrorHandler("Brand profile not found", 404));
      }

      // multer .fields() stores uploads keyed by field name
      const files = (req as any).files as
        | Record<string, Express.Multer.File[]>
        | undefined;
      const imageFile = files?.image?.[0];
      const videoFile = files?.video?.[0];

      if (!imageFile) {
        return next(
          new ErrorHandler(
            'Missing brand image file. Please upload using field name "image"',
            400
          )
        );
      }
      if (!videoFile) {
        return next(
          new ErrorHandler(
            'Missing video file. Please upload using field name "video"',
            400
          )
        );
      }

      // Validate video duration/size before uploading anything
      let videoMeta;
      try {
        videoMeta = await validateVideoUpload({
          buffer: videoFile.buffer,
          mimetype: videoFile.mimetype,
          originalname: videoFile.originalname,
        });
      } catch (e: any) {
        if (e instanceof VideoValidationError) {
          return next(new ErrorHandler(e.message, 400));
        }
        throw e;
      }

      // Quiz questions: brand-authored (no AI generation), exactly N questions
      // (config-driven, default 3).
      let parsedQuestions: any[] = [];
      const rawQuestions = questions ?? req.body?.question;
      const tryParse = (val: string) => {
        try {
          return JSON.parse(val);
        } catch {
          try {
            return JSON.parse(val.replace(/'/g, '"'));
          } catch {
            return null;
          }
        }
      };
      if (typeof rawQuestions === "string" && rawQuestions.trim() !== "") {
        const parsed = tryParse(rawQuestions);
        if (parsed === null) {
          return next(
            new ErrorHandler(
              `Invalid JSON for questions field. Received: ${rawQuestions}`,
              400
            )
          );
        }
        parsedQuestions = parsed;
      } else if (Array.isArray(rawQuestions)) {
        parsedQuestions = rawQuestions;
      } else if (rawQuestions && typeof rawQuestions === "object") {
        const vals = Object.values(rawQuestions);
        parsedQuestions =
          vals.length && vals.every((v) => typeof v === "object")
            ? (vals as any[])
            : [];
      }

      const requiredQuestionCount = await getQuizQuestionCount();
      if (
        !Array.isArray(parsedQuestions) ||
        parsedQuestions.length !== requiredQuestionCount
      ) {
        return next(
          new ErrorHandler(
            `questions must be an array of exactly ${requiredQuestionCount} brand-authored quiz questions`,
            400
          )
        );
      }
      for (const q of parsedQuestions) {
        if (
          !q ||
          typeof q.question !== "string" ||
          !Array.isArray(q.choices) ||
          typeof q.correctIndex !== "number"
        ) {
          return next(
            new ErrorHandler(
              "Each question must have 'question', 'choices' array and numeric 'correctIndex'",
              400
            )
          );
        }
      }

      // Weekly pricing: amount = weeks × tier weekly price
      let pricing;
      try {
        pricing = await computeWeeklyPricing(packageType, parsedDurationWeeks);
      } catch (e: any) {
        return next(new ErrorHandler(e.message, 400));
      }

      // Upload brand image and video
      const storage = getStorageService();
      const ts = Date.now();

      const imageUploadName = `${ts}-${imageFile.originalname}`;
      const imageResult = await storage.uploadFile({
        buffer: imageFile.buffer,
        mimetype: imageFile.mimetype,
        originalname: imageUploadName,
        folder: "puzzles",
        fileName: imageUploadName,
      });

      const videoUploadName = `${ts}-${videoFile.originalname}`;
      const videoResult = await storage.uploadFile({
        buffer: videoFile.buffer,
        mimetype: videoFile.mimetype,
        originalname: videoUploadName,
        folder: "campaign-videos",
        fileName: videoUploadName,
      });

      // Placeholder dates — actual dates are set when payment is verified (draft -> active)
      const currentDate = new Date();
      const placeholderEndDate = new Date(
        currentDate.getTime() + pricing.timeLimitHours * 60 * 60 * 1000
      );

      const campaignData: any = {
        brandId: brandUser._id,
        packageId,
        packageType,
        gameTypes: ALL_GAME_TYPES,
        title: title.trim(),
        description: description.trim(),
        brandUrl: brandUrl?.trim() || null,
        campaignUrl: campaignUrl?.trim() || null,
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

      const campaign = await PuzzleCampaignModel.create(campaignData);

      await BrandModel.findOneAndUpdate(
        { userId: brandUser._id },
        { $push: { campaigns: campaign._id } }
      );

      const campaignResponse = campaign.toObject();
      const responseWithPackageName = {
        ...campaignResponse,
        packageName: packageData.name,
      };

      res
        .status(201)
        .json({ success: true, campaign: responseWithPackageName });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to create campaign: ${error.message}`, 500)
      );
    }
  }
);

export const getCampaignAnalytics = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const brandUser = req.user!;
      if (brandUser.role !== "brand")
        return next(new ErrorHandler("Only brands can access analytics", 403));
      const brand = await BrandModel.findOne({ userId: brandUser._id });
      if (!brand) return next(new ErrorHandler("Brand not found", 404));

      // Fetch campaigns for brand
      const campaigns = await PuzzleCampaignModel.find({
        brandId: brandUser._id,
      }).lean();

      const campaignsAnalytics: any[] = [];

      // prepare campaign ids for bulk queries
      const campaignIds = campaigns.map((c) => String(c._id));

      // Fetch all game sessions for brand campaigns in one query
      const allSessions = await GameSessionModel.find({
        campaignId: { $in: campaignIds },
      }).lean();

      // Aggregated metrics
      const totalCampaigns = campaigns.length;
      const activeCampaigns = campaigns.filter(
        (c) => c.status === "active"
      ).length;
      const totalBudgetUsed = campaigns.reduce(
        (s, c) => s + (Number(c.budgetUsed) || 0),
        0
      );

      // total games played across brand
      const totalGamesPlayed = allSessions.length;

      // unique players across all brand campaigns
      const uniquePlayerIds = Array.from(
        new Set(allSessions.map((s) => String(s.userId)))
      );
      const uniquePlayers = uniquePlayerIds.filter(
        (id) => id && id !== "undefined"
      ).length;

      // average completion time (in ms) across all completed sessions
      const completedSessions = allSessions.filter(
        (s) => s.status === "completed"
      );
      const avgPlayTime = completedSessions.length
        ? Math.round(
            completedSessions.reduce(
              (s, sess) => s + (sess.totalCompletionTimeMs || 0),
              0
            ) / completedSessions.length
          )
        : 0;

      // per-campaign analytics
      for (const c of campaigns) {
        const sessions = allSessions.filter(
          (s) => String(s.campaignId) === String(c._id)
        );
        const plays = sessions.length;
        const completed = sessions.filter((s) => s.status === "completed");
        const completions = completed.length;
        const avgCompletionTime = completed.length
          ? Math.round(
              completed.reduce(
                (s, sess) => s + (sess.totalCompletionTimeMs || 0),
                0
              ) / completed.length
            )
          : 0;

        // question correctness rates (from each session's first quiz attempt)
        const qCorrectCounts: number[] = (c.questions || []).map(() => 0);
        for (const s of sessions) {
          const answers = s.quiz?.firstAttempt?.answers;
          if (Array.isArray(answers)) {
            for (
              let i = 0;
              i < answers.length && i < (c.questions || []).length;
              i++
            ) {
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
    } catch (error: any) {
      return next(
        new ErrorHandler(
          `Failed to fetch campaign analytics: ${error.message}`,
          500
        )
      );
    }
  }
);

// Get all brands
export const getAllBrands = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Find all users with role 'brand'
      const brandUsers = await UserModel.find({ role: "brand" })
        .select("_id name email companyName avatar isVerified createdAt")
        .lean();

      // Get brand details for each brand user
      const brands = await Promise.all(
        brandUsers.map(async (brandUser) => {
          const brandProfile = await BrandModel.findOne({
            userId: brandUser._id,
          }).lean();
          const campaignCount = await PuzzleCampaignModel.countDocuments({
            brandId: brandUser._id,
          });

          return {
            _id: brandUser._id,
            name: brandUser.name,
            email: brandUser.email,
            companyName: brandUser.companyName,
            avatar: brandUser.avatar,
            isVerified: brandUser.isVerified,
            createdAt: (brandUser as any).createdAt,
            brandDetails: brandProfile
              ? {
                  companyEmail: brandProfile.companyEmail,
                  verified: brandProfile.verified,
                  totalCampaigns: campaignCount,
                }
              : null,
          };
        })
      );

      res.status(200).json({ success: true, brands });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to fetch brands: ${error.message}`, 500)
      );
    }
  }
);
