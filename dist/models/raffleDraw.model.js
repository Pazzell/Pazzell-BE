"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const raffleDrawSchema = new mongoose_1.default.Schema({
    campaignId: { type: String, required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    allTicketUserIds: { type: [String], default: [] },
    eligibleTicketUserIds: { type: [String], default: [] },
    winnerUserId: { type: String },
    seed: { type: String },
    winnerIndex: { type: Number },
    status: {
        type: String,
        enum: ["pending", "drawn", "fulfilled", "cancelled"],
        default: "pending",
    },
    fulfillmentStatus: { type: String },
    fulfillmentNotes: { type: String },
    drawnAt: { type: Date },
}, { timestamps: true });
raffleDrawSchema.index({ campaignId: 1, weekKey: 1 }, { unique: true });
const RaffleDrawModel = mongoose_1.default.model("RaffleDraw", raffleDrawSchema);
exports.default = RaffleDrawModel;
