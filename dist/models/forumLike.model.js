"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const forumLikeSchema = new mongoose_1.default.Schema({
    postId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
}, { timestamps: true });
forumLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
const ForumLikeModel = mongoose_1.default.model("ForumLike", forumLikeSchema);
exports.default = ForumLikeModel;
