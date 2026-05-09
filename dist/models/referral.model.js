"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const referralSchema = new mongoose_1.default.Schema({
    referrerId: { type: String, required: true, index: true },
    referredUserId: { type: String, required: true, index: true, unique: true },
    referredAt: { type: Date, default: Date.now },
    successful: { type: Boolean, default: false },
    successfulAt: { type: Date },
}, { timestamps: true });
referralSchema.index({ referrerId: 1 });
const ReferralModel = mongoose_1.default.model("Referral", referralSchema);
exports.default = ReferralModel;
