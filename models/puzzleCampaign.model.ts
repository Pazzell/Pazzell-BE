import mongoose, { Document, Model, Schema } from "mongoose";

export interface IQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
}

export interface IPuzzleCampaign extends Document {
  brandId: string;
  packageId: string; // reference to package
  gameType:
    | "sliding_puzzle"
    | "card_matching"
    | "spot_the_difference"
    | "word_hunt";
  title: string;
  description: string;
  brandUrl?: string; // brand's website or social media URL
  campaignUrl?: string; // specific URL for this campaign
  videoUrl?: string; // optional promotional video URL
  puzzleImageUrl: string;
  passage?: string; // short brand passage used to generate quiz questions (max 500 chars) — legacy AI-quiz flow, unused by v2 campaigns
  questions: IQuestion[];
  words?: string[]; // for word_hunt games only
  timeLimit: number; // campaign duration in hours
  status: "active" | "ended" | "draft";
  startDate: Date;
  endDate: Date;
  analytics: any;
  // Payment/Budget tracking
  packageType?: "basic" | "premium";
  totalBudget?: number; // Total amount allocated for campaign
  expectedChargeAmount?: number; // discounted amount brand will pay (if any)
  dailyAllocation?: number; // Fixed daily rate (₦1,000 or ₦1,428.57)
  budgetUsed?: number; // Amount already allocated to daily pools
  budgetRemaining?: number; // Amount left to allocate
  paymentStatus?: "unpaid" | "paid" | "partial";
  transactionId?: string; // Reference to Transaction

  // --- v2 multi-game campaign fields (additive; legacy schemaVersion:1 docs never set these) ---
  schemaVersion: number; // 1 = legacy single-gameType campaign, 2 = new multi-game campaign
  gameTypes?: (
    | "sliding_puzzle"
    | "card_matching"
    | "spot_the_difference"
    | "word_hunt"
  )[]; // v2 only — always all four
  videoDurationSeconds?: number;
  videoSizeBytes?: number;
  videoMimeType?: string;
  prizeDescription?: string;
  prizeUnitsAvailable?: number; // physical prize unit count (future flexibility) — draw winner count stays fixed at 1
  durationWeeks?: number; // v2 duration, replaces endMonth/timeLimit(hours)/weeksToRun
  weeklyPrice?: number; // NGN price-per-week snapshot at creation time, for audit
}

const puzzleCampaignSchema: Schema<IPuzzleCampaign> = new mongoose.Schema(
  {
    brandId: { type: String, required: true },
    packageId: { type: String, required: true, index: true },
    gameType: {
      type: String,
      enum: [
        "sliding_puzzle",
        "card_matching",
        "spot_the_difference",
        "word_hunt",
      ],
      required: true,
      default: "sliding_puzzle",
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    brandUrl: { type: String, required: false },
    campaignUrl: { type: String, required: false },
    videoUrl: { type: String, required: false },
    puzzleImageUrl: { type: String, required: true },
    passage: { type: String, required: false, maxlength: 1000 },
    questions: [
      {
        question: { type: String, required: true },
        choices: [{ type: String }],
        correctIndex: { type: Number, required: true },
      },
    ],
    words: [{ type: String }], // for word_hunt games
    timeLimit: { type: Number, required: true }, // campaign duration in hours
    status: {
      type: String,
      enum: ["active", "ended", "draft"],
      default: "active",
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    analytics: { type: Schema.Types.Mixed, default: {} },
    // Payment/Budget tracking
    packageType: { type: String, enum: ["basic", "premium"] },
    // Total amount allocated for campaign (full credit to brand)
    totalBudget: { type: Number, default: 0 },
    // expectedChargeAmount: discounted amount brand will pay (stored for payment initialization)
    expectedChargeAmount: { type: Number, default: 0 },
    dailyAllocation: { type: Number, default: 0 },
    budgetUsed: { type: Number, default: 0 },
    budgetRemaining: { type: Number, default: 0 },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid", "partial"],
      default: "unpaid",
    },
    transactionId: { type: String },

    // v2 multi-game fields
    schemaVersion: { type: Number, default: 1, required: true },
    gameTypes: [
      {
        type: String,
        enum: [
          "sliding_puzzle",
          "card_matching",
          "spot_the_difference",
          "word_hunt",
        ],
      },
    ],
    videoDurationSeconds: { type: Number },
    videoSizeBytes: { type: Number },
    videoMimeType: { type: String },
    prizeDescription: { type: String },
    prizeUnitsAvailable: { type: Number, default: 1 },
    durationWeeks: { type: Number },
    weeklyPrice: { type: Number },
  },
  { timestamps: true }
);

// index for quick analytics by brand
puzzleCampaignSchema.index({ brandId: 1 });
// index for querying by game type
puzzleCampaignSchema.index({ gameType: 1 });
// index for querying by status
puzzleCampaignSchema.index({ status: 1 });
// index for querying by end date (for auto-ending campaigns)
puzzleCampaignSchema.index({ endDate: 1, status: 1 });
// index for filtering legacy vs v2 campaigns
puzzleCampaignSchema.index({ schemaVersion: 1 });

const PuzzleCampaignModel: Model<IPuzzleCampaign> = mongoose.model(
  "PuzzleCampaign",
  puzzleCampaignSchema
);
export default PuzzleCampaignModel;
