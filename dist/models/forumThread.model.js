"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const forumThreadSchema = new mongoose_1.default.Schema({
    title: { type: String, required: true },
    createdBy: { type: String, required: true, index: true },
    category: { type: String },
    pinned: { type: Boolean, default: false },
    locked: { type: Boolean, default: false },
}, { timestamps: true });
forumThreadSchema.index({ pinned: -1, createdAt: -1 });
const ForumThreadModel = mongoose_1.default.model("ForumThread", forumThreadSchema);
exports.default = ForumThreadModel;
