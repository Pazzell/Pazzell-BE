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
const puzzleCampaignSchema = new mongoose_1.default.Schema({
    brandId: { type: String, required: true },
    packageId: { type: String, required: true, index: true },
    gameType: {
        type: String,
        enum: ["sliding_puzzle", "card_matching", "whack_a_mole", "word_hunt"],
        required: true,
        default: "sliding_puzzle",
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    brandUrl: { type: String, required: false },
    campaignUrl: { type: String, required: false },
    videoUrl: { type: String, required: false },
    puzzleImageUrl: { type: String, required: true },
    originalImageUrl: { type: String, required: true },
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
    analytics: { type: mongoose_1.Schema.Types.Mixed, default: {} },
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
}, { timestamps: true });
// index for quick analytics by brand
puzzleCampaignSchema.index({ brandId: 1 });
// index for querying by game type
puzzleCampaignSchema.index({ gameType: 1 });
// index for querying by status
puzzleCampaignSchema.index({ status: 1 });
// index for querying by end date (for auto-ending campaigns)
puzzleCampaignSchema.index({ endDate: 1, status: 1 });
const PuzzleCampaignModel = mongoose_1.default.model("PuzzleCampaign", puzzleCampaignSchema);
exports.default = PuzzleCampaignModel;
