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
    pointsAwarded: { type: Number, default: 0 },
}, { timestamps: true });
// `referrerId` already has `index: true` in the field definition above.
// Avoid duplicate index declaration to prevent Mongoose duplicate index warnings.
const ReferralModel = mongoose_1.default.model("Referral", referralSchema);
exports.default = ReferralModel;
