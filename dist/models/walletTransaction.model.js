"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const walletTransactionSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: ["credit", "debit"], required: true },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true },
    reason: {
        type: String,
        enum: ["weekly_payout", "withdrawal", "withdrawal_reversal", "admin_adjustment"],
        required: true,
    },
    referenceId: { type: String },
    idempotencyKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ["completed", "reversed"], default: "completed" },
}, { timestamps: true });
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
const WalletTransactionModel = mongoose_1.default.model("WalletTransaction", walletTransactionSchema);
exports.default = WalletTransactionModel;
