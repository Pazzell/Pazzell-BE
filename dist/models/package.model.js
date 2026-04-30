"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const packageSchema = new mongoose_1.default.Schema({
    name: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    priority: { type: Number, required: true }, // higher = shown first
    description: { type: String },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });
const PackageModel = mongoose_1.default.model("Package", packageSchema);
exports.default = PackageModel;
