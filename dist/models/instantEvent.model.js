"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const instantEventSchema = new mongoose_1.default.Schema({
    title: { type: String, required: true },
    campaignId: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    participants: [
        {
            userId: { type: String, required: true },
            joinedAt: { type: Date, required: true },
            timeTaken: { type: Number },
            movesTaken: { type: Number },
            submitted: { type: Boolean, default: false },
            rank: { type: Number },
        },
    ],
    status: {
        type: String,
        enum: ["pending", "running", "finished"],
        default: "pending",
    },
}, { timestamps: true });
instantEventSchema.index({ startAt: 1, endAt: 1 });
const InstantEventModel = mongoose_1.default.model("InstantEvent", instantEventSchema);
exports.default = InstantEventModel;
