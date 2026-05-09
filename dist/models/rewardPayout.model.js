"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const rewardPayoutSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, index: true },
    monthKey: { type: String, required: true, index: true },
    type: {
        type: String,
        enum: ["points", "referral", "raffle"],
        required: true,
    },
    position: { type: Number },
    amount: { type: Number, required: true },
    currency: { type: String, default: "NGN" },
    status: {
        type: String,
        enum: ["pending", "processed", "paid", "failed"],
        default: "pending",
    },
    processedAt: { type: Date },
}, { timestamps: true });
rewardPayoutSchema.index({ userId: 1, monthKey: 1, type: 1 });
const RewardPayoutModel = mongoose_1.default.model("RewardPayout", rewardPayoutSchema);
exports.default = RewardPayoutModel;
