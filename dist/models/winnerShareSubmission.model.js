"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const winnerShareSubmissionSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, index: true },
    campaignId: { type: String, required: true },
    postUrl: { type: String, required: true },
    claimedLikeCount: { type: Number },
    status: { type: String, enum: ["submitted", "verified", "rejected"], default: "submitted" },
    adminReviewerId: { type: String },
    adminNotes: { type: String },
    reviewedAt: { type: Date },
    bonusPointsGranted: { type: Number },
}, { timestamps: true });
const WinnerShareSubmissionModel = mongoose_1.default.model("WinnerShareSubmission", winnerShareSubmissionSchema);
exports.default = WinnerShareSubmissionModel;
