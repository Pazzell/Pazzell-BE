"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const pointsLedgerSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, index: true },
    points: { type: Number, required: true },
    source: {
        type: String,
        enum: [
            "session_completion",
            "referral_bonus",
            "winner_share_bonus",
            "admin_adjustment",
        ],
        required: true,
    },
    sourceRefId: { type: String },
    campaignId: { type: String, index: true },
    completionTimeMs: { type: Number },
    weekKey: { type: String, required: true, index: true },
}, { timestamps: true });
pointsLedgerSchema.index({ userId: 1, weekKey: 1 });
pointsLedgerSchema.index({ weekKey: 1, source: 1 });
const PointsLedgerModel = mongoose_1.default.model("PointsLedger", pointsLedgerSchema);
exports.default = PointsLedgerModel;
