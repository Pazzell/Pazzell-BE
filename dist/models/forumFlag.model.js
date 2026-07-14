"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const forumFlagSchema = new mongoose_1.default.Schema({
    postId: { type: String, required: true, index: true },
    flaggedBy: { type: String, required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ["open", "resolved", "dismissed"], default: "open" },
}, { timestamps: true });
const ForumFlagModel = mongoose_1.default.model("ForumFlag", forumFlagSchema);
exports.default = ForumFlagModel;
