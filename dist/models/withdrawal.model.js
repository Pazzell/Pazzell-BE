"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const withdrawalSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, index: true },
    bankAccountId: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "NGN" },
    status: {
        type: String,
        enum: ["pending", "processing", "paid", "failed"],
        default: "pending",
        index: true,
    },
    idempotencyKey: { type: String, required: true, unique: true },
    paystackTransferCode: { type: String },
    paystackTransferReference: { type: String },
    failureReason: { type: String },
}, { timestamps: true });
withdrawalSchema.index({ userId: 1, createdAt: -1 });
const WithdrawalModel = mongoose_1.default.model("Withdrawal", withdrawalSchema);
exports.default = WithdrawalModel;
