"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const leaderboardSchema = new mongoose_1.default.Schema({
    type: { type: String, enum: ["weekly"], required: true, default: "weekly" },
    date: { type: String, required: true },
    entries: [
        {
            userId: { type: String, required: true },
            puzzlesSolved: { type: Number },
            points: { type: Number, default: 0 },
        },
    ],
}, { timestamps: true });
leaderboardSchema.index({ type: 1, date: 1 });
const LeaderboardModel = mongoose_1.default.model("Leaderboard", leaderboardSchema);
exports.default = LeaderboardModel;
