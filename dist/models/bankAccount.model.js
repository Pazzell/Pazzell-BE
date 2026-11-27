"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const bankAccountSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, index: true },
    bankCode: { type: String, required: true },
    bankName: { type: String, required: true },
    accountNumber: { type: String, required: true },
    accountName: { type: String, required: true },
    recipientCode: { type: String },
    verified: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
}, { timestamps: true });
bankAccountSchema.index({ userId: 1, bankCode: 1, accountNumber: 1 }, { unique: true });
const BankAccountModel = mongoose_1.default.model("BankAccount", bankAccountSchema);
exports.default = BankAccountModel;
