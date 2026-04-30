import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";
import BrandModel from "../models/brand.model";
import { bucket } from "../firebaseConfig";
import PuzzleAttemptModel from "../models/puzzleAttempt.model";
import UserModel from "../models/user.model";
import PackageModel from "../models/package.model";

// Package pricing
const PACKAGE_PRICES = {
  basic: 7000, // ₦7,000
  premium: 10000, // ₦10,000
};

// Convert hours to number of weeks (rounded up to cover partial weeks)
const getWeeksFromHours = (timeLimitHours: number): number => {
  const hoursPerWeek = 24 * 7; // 168
  if (!timeLimitHours || timeLimitHours <= 0) return 1;
  return Math.max(1, Math.ceil(timeLimitHours / hoursPerWeek));
};

// Multiplier formula provided: Multiplier = 0.9 * n + 10^{-n}
// Return the multiplier rounded DOWN to one decimal place to normalize to 10% discount
const calculateDurationFactor = (timeLimitHours: number): number => {
  const weeks = getWeeksFromHours(timeLimitHours);
  if (weeks === 1) return 1.0;
  const multiplierRaw = 0.9 * weeks + Math.pow(10, -weeks);
  const multiplierRoundedDown = Math.floor(multiplierRaw * 10) / 10; // e.g. 1.81 -> 1.8
  return multiplierRoundedDown;
};

// Create a puzzle campaign (brands only). Expects multipart upload with one file: "image" (used for both scrambled and original)
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
        gameType,
        words,
        packageId,
        brandUrl,
        campaignUrl,
        videoUrl,
        timeLimit,
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

      // Verify package exists
      const packageData = await PackageModel.findById(packageId);
      if (!packageData) {
        return next(
          new ErrorHandler("Invalid package. Package not found.", 404)
        );
      }

      if (!packageData.isActive) {
        return next(new ErrorHandler("Selected package is not available", 400));
      }

      // validate required fields
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

      // Validate gameType field
      const validGameTypes = [
        "sliding_puzzle",
        "card_matching",
        "whack_a_mole",
        "word_hunt",
      ];
      const campaignGameType = gameType || "sliding_puzzle";
      if (!validGameTypes.includes(campaignGameType)) {
        return next(
          new ErrorHandler(
            "gameType must be one of: sliding_puzzle, card_matching, whack_a_mole, word_hunt",
            400
          )
        );
      }

      // Parse words array if it's a string (from form-data)
      let parsedWords: string[] = [];
      if (words) {
        if (typeof words === "string") {
          try {
            parsedWords = JSON.parse(words);
          } catch {
            // If parsing fails, try splitting by comma
            parsedWords = words
              .split(",")
              .map((w) => w.trim())
              .filter((w) => w.length > 0);
          }
        } else if (Array.isArray(words)) {
          parsedWords = words;
        }
      }

      // For word_hunt games, validate words array
      if (campaignGameType === "word_hunt") {
        if (!parsedWords || parsedWords.length === 0) {
          return next(
            new ErrorHandler(
              "words array is required for word_hunt games and must contain at least one word",
              400
            )
          );
        }
      }

      // Get brand profile (no restriction on number of campaigns)
      const brand = await BrandModel.findOne({ userId: brandUser._id });
      if (!brand) {
        return next(new ErrorHandler("Brand profile not found", 404));
      }

      // multer stores single-file upload in req.file
      const uploadedFile: any = (req as any).file;

      if (!uploadedFile) {
        return next(
          new ErrorHandler(
            'Missing image file. Please upload using field name "image"',
            400
          )
        );
      }

      // use a single timestamp so both stored names are related
      const now = Date.now();
      const puzzleName = `puzzles/${now}-puzzle-${uploadedFile.originalname}`;
      const originalName = `puzzles/${now}-original-${uploadedFile.originalname}`;

      const uploadBuffer = async (file: any, name: string) => {
        const fileRef = bucket.file(name);
        await fileRef.save(file.buffer, {
          resumable: false,
          contentType: file.mimetype,
        });
        await fileRef.makePublic();
        return `https://storage.googleapis.com/${bucket.name}/${name}`;
      };

      const puzzleUrl = await uploadBuffer(uploadedFile, puzzleName);
      const originalUrl = await uploadBuffer(uploadedFile, originalName);

      // parse questions (expected as JSON string or array)
      let parsedQuestions: any[] = [];
      const rawQuestions =
        questions ?? req.body?.questions ?? req.body?.question;

      const tryParse = (val: string) => {
        try {
          return JSON.parse(val);
        } catch {
          // try a simple fix: replace single quotes with double quotes
          try {
            const fixed = val.replace(/'/g, '"');
            return JSON.parse(fixed);
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
        // handle cases where form-data produced an object with numeric keys
        const vals = Object.values(rawQuestions);
        if (vals.length && vals.every((v) => typeof v === "object"))
          parsedQuestions = vals as any[];
        else parsedQuestions = [];
      } else {
        parsedQuestions = [];
      }

      // validate parsedQuestions
      if (!Array.isArray(parsedQuestions) || parsedQuestions.length === 0) {
        return next(
          new ErrorHandler("Missing or invalid questions array", 400)
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

      // helper to robustly parse numeric fields from multipart/form-data
      const getNumericFromBody = (fieldName: string) => {
        let v: any = req.body?.[fieldName];
        if (Array.isArray(v)) v = v[0];
        if (v && typeof v === "object") {
          const vals = Object.values(v);
          if (vals.length) v = vals[0];
        }
        if (typeof v === "string") {
          const cleaned = v.replace(/[^0-9.-]/g, "").trim();
          if (cleaned === "") return null;
          const n = Number(cleaned);
          return Number.isFinite(n) ? n : null;
        }
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };

      // Validate timeLimit
      const parsedTimeLimit = Number(timeLimit);
      if (!timeLimit || isNaN(parsedTimeLimit) || parsedTimeLimit <= 0) {
        return next(
          new ErrorHandler(
            "timeLimit is required and must be a positive number (in hours)",
            400
          )
        );
      }

      // Get package type and calculate totalBudget
      const packageType =
        packageData.name?.toLowerCase() === "premium" ? "premium" : "basic";
      const basePrice = PACKAGE_PRICES[packageType];

      // Weeks selected by brand (rounded up)
      const weeks = getWeeksFromHours(parsedTimeLimit);

      // Full allocated budget that the brand should receive (no discount)
      const allocatedBudget = basePrice * weeks; // e.g., 2 weeks => 7000 * 2 = 14000

      // Compute charged multiplier (rounded DOWN to 1 decimal as requested)
      const chargedMultiplier = calculateDurationFactor(parsedTimeLimit); // e.g., 1.8 for 2 weeks
      const chargedAmount = Math.round(basePrice * chargedMultiplier); // amount brand will pay

      // Compute daily allocation spread across the selected duration (days) using allocated budget
      const days = Math.max(1, Math.ceil(parsedTimeLimit / 24));
      const dailyAllocation = Number((allocatedBudget / days).toFixed(2));

      // Set placeholder dates - actual dates will be set when payment is made
      const currentDate = new Date();
      const placeholderEndDate = new Date(
        currentDate.getTime() + parsedTimeLimit * 60 * 60 * 1000
      );

      // Prepare campaign data
      // All new campaigns start as draft until payment is verified
      const campaignData: any = {
        brandId: brandUser._id,
        packageId: packageId,
        packageType: packageType,
        gameType: campaignGameType,
        title: title.trim(),
        description: description.trim(),
        brandUrl: brandUrl?.trim() || null,
        campaignUrl: campaignUrl?.trim() || null,
        videoUrl: videoUrl?.trim() || null,
        puzzleImageUrl: puzzleUrl,
        originalImageUrl: originalUrl,
        questions: parsedQuestions,
        timeLimit: parsedTimeLimit,
        status: "draft", // Always start as draft
        paymentStatus: "unpaid", // All new campaigns start as unpaid
        // Payment not yet completed: store expected charged amount; actual
        // `totalBudget` (allocated) will be set after payment (to the paid amount).
        totalBudget: 0,
        expectedChargeAmount: chargedAmount,
        dailyAllocation: 0,
        budgetRemaining: 0,
        budgetUsed: 0,
        startDate: currentDate, // Placeholder - will be updated on payment
        endDate: placeholderEndDate, // Placeholder - will be updated on payment
      };

      // For word_hunt games, add words array
      if (campaignGameType === "word_hunt" && parsedWords.length > 0) {
        campaignData.words = parsedWords;
      }

      const campaign = await PuzzleCampaignModel.create(campaignData);

      // Update brand campaigns list (no restrictions on number of campaigns)
      await BrandModel.findOneAndUpdate(
        { userId: brandUser._id },
        { $push: { campaigns: campaign._id } }
      );

      // Convert to plain object to ensure all fields are included
      const campaignResponse = campaign.toObject();

      // Add package name to response
      const responseWithPackageName = {
        ...campaignResponse,
        packageName: packageData.name,
      };

      console.log(
        "Campaign created. Has campaignUrl?",
        "campaignUrl" in responseWithPackageName
      );
      console.log(
        "campaignUrl value in response:",
        responseWithPackageName.campaignUrl
      );
      console.log(
        "brandUrl value in response:",
        responseWithPackageName.brandUrl
      );

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

      // Fetch all attempts for brand campaigns in one query
      const allAttempts = await PuzzleAttemptModel.find({
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
      const totalGamesPlayed = allAttempts.length;

      // unique players across all brand campaigns
      const uniquePlayerIds = Array.from(
        new Set(allAttempts.map((a) => String(a.userId)))
      );
      const uniquePlayers = uniquePlayerIds.filter(
        (id) => id && id !== "undefined"
      ).length;

      // average gameplay time (in ms) across all attempts
      const avgPlayTime = allAttempts.length
        ? Math.round(
            allAttempts.reduce((s, a) => s + (a.timeTaken || 0), 0) /
              allAttempts.length
          )
        : 0;

      // per-campaign analytics
      for (const c of campaigns) {
        const attempts = allAttempts.filter(
          (a) => String(a.campaignId) === String(c._id)
        );
        const plays = attempts.length;
        const completions = attempts.filter((a) => a.solved).length;
        const avgCompletionTime = attempts.filter((a) => a.solved).length
          ? Math.round(
              attempts
                .filter((a) => a.solved)
                .reduce((s, a) => s + (a.timeTaken || 0), 0) /
                attempts.filter((a) => a.solved).length
            )
          : 0;

        // question correctness rates
        const qCorrectCounts: number[] = (c.questions || []).map(() => 0);
        for (const a of attempts) {
          if (Array.isArray(a.answers)) {
            for (
              let i = 0;
              i < a.answers.length && i < (c.questions || []).length;
              i++
            ) {
              if (a.answers[i] === c.questions[i].correctIndex)
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
