"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const forumPostSchema = new mongoose_1.default.Schema({
    threadId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    body: { type: String, required: true, maxlength: 5000 },
    imageUrls: { type: [String], default: [] },
    moderationStatus: {
        type: String,
        enum: ["visible", "hidden", "removed"],
        default: "visible",
    },
    likeCount: { type: Number, default: 0 },
}, { timestamps: true });
forumPostSchema.index({ threadId: 1, createdAt: 1 });
const ForumPostModel = mongoose_1.default.model("ForumPost", forumPostSchema);
exports.default = ForumPostModel;
