"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const payoutSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    position: { type: Number, required: true, min: 1, max: 10 },
    points: { type: Number, required: true },
    puzzlesSolved: { type: Number, required: true },
    totalDailyPool: { type: Number, required: true },
    gamerShare: { type: Number, required: true },
    distributionPercentage: { type: Number, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "NGN" },
    status: { type: String, enum: ["pending", "processed", "paid", "failed"], default: "pending" },
    paymentReference: { type: String },
    processedAt: { type: Date },
}, { timestamps: true });
// Compound index for unique user per week
payoutSchema.index({ userId: 1, weekKey: 1 }, { unique: true });
const PayoutModel = mongoose_1.default.model("Payout", payoutSchema);
exports.default = PayoutModel;
