"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const referralEventSchema = new mongoose_1.default.Schema({
    referrerId: { type: String, required: true, index: true },
    referredUserId: { type: String, required: true, index: true },
    eventType: {
        type: String,
        // "first_puzzle" retained for historical rows written under the old
        // (pre points-threshold) referral model — new rows use
        // "points_threshold_reached" (see referral.service.ts checkReferralQualification).
        enum: ["signup", "first_puzzle", "points_threshold_reached"],
        required: true,
    },
    eventAt: { type: Date, default: Date.now },
}, { timestamps: true });
const ReferralEventModel = mongoose_1.default.model("ReferralEvent", referralEventSchema);
exports.default = ReferralEventModel;
