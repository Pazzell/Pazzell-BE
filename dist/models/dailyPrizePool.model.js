"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dailyPrizePoolSchema = new mongoose_1.default.Schema({
    date: { type: String, required: true, unique: true, index: true },
    activeCampaigns: [
        {
            campaignId: { type: String, required: true },
            packageType: { type: String, enum: ["basic", "premium"], required: true },
            dailyAllocation: { type: Number, required: true },
        },
    ],
    totalDailyPool: { type: Number, required: true },
    gamerShare: { type: Number, required: true },
    platformFee: { type: Number, required: true },
    status: { type: String, enum: ["active", "completed"], default: "active" },
}, { timestamps: true });
const DailyPrizePoolModel = mongoose_1.default.model("DailyPrizePool", dailyPrizePoolSchema);
exports.default = DailyPrizePoolModel;
