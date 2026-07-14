"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.paystackTransferWebhook = exports.getWithdrawal = exports.listWithdrawals = exports.createWithdrawal = exports.deleteBankAccount = exports.listBankAccounts = exports.addBankAccount = exports.getWalletTransactions = exports.getWalletBalance = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const bankAccount_model_1 = __importDefault(require("../models/bankAccount.model"));
const withdrawal_model_1 = __importDefault(require("../models/withdrawal.model"));
const wallet_service_1 = require("../services/wallet/wallet.service");
const transferFactory_1 = require("../services/transfer/transferFactory");
// GET /wallet/balance
exports.getWalletBalance = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const balance = yield (0, wallet_service_1.getBalance)(userId);
        res.status(200).json({ success: true, balance, currency: "NGN" });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// GET /wallet/transactions
exports.getWalletTransactions = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const limit = parseInt(req.query.limit || "50", 10);
        const transactions = yield (0, wallet_service_1.listTransactions)(userId, limit);
        res.status(200).json({ success: true, transactions });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// POST /wallet/bank-accounts  { accountNumber, bankCode, bankName }
exports.addBankAccount = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { accountNumber, bankCode, bankName } = req.body;
        if (!accountNumber || !bankCode || !bankName) {
            return next(new ErrorHandler_1.default("accountNumber, bankCode, and bankName are required", 400));
        }
        const transferService = (0, transferFactory_1.getTransferService)();
        if (!transferService.isEnabled()) {
            return next(new ErrorHandler_1.default("Bank verification is temporarily unavailable", 503));
        }
        let resolved;
        try {
            resolved = yield transferService.resolveAccount(accountNumber, bankCode);
        }
        catch (e) {
            return next(new ErrorHandler_1.default(e.message, 400));
        }
        const existingCount = yield bankAccount_model_1.default.countDocuments({ userId });
        const bankAccount = yield bankAccount_model_1.default.create({
            userId,
            bankCode,
            bankName,
            accountNumber: resolved.accountNumber,
            accountName: resolved.accountName,
            verified: true,
            isDefault: existingCount === 0,
        });
        res.status(201).json({ success: true, bankAccount });
    }
    catch (error) {
        if (error.code === 11000) {
            return next(new ErrorHandler_1.default("This bank account is already saved", 409));
        }
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// GET /wallet/bank-accounts
exports.listBankAccounts = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const bankAccounts = yield bankAccount_model_1.default.find({ userId }).sort({ createdAt: -1 }).lean();
        res.status(200).json({ success: true, bankAccounts });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// DELETE /wallet/bank-accounts/:id
exports.deleteBankAccount = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { id } = req.params;
        const result = yield bankAccount_model_1.default.deleteOne({ _id: id, userId });
        if (result.deletedCount === 0) {
            return next(new ErrorHandler_1.default("Bank account not found", 404));
        }
        res.status(200).json({ success: true });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
function reverseWithdrawalDebit(withdrawal) {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, wallet_service_1.credit)({
            userId: withdrawal.userId,
            amount: withdrawal.amount,
            reason: "withdrawal_reversal",
            referenceId: String(withdrawal._id),
            idempotencyKey: `withdrawal-reversal:${withdrawal._id}`,
        });
    });
}
// POST /wallet/withdrawals  { bankAccountId, amount, idempotencyKey }
exports.createWithdrawal = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { bankAccountId, amount, idempotencyKey } = req.body;
        if (!bankAccountId || !amount || Number(amount) <= 0 || !idempotencyKey) {
            return next(new ErrorHandler_1.default("bankAccountId, a positive amount, and idempotencyKey are required", 400));
        }
        const existing = yield withdrawal_model_1.default.findOne({ idempotencyKey });
        if (existing) {
            return res.status(200).json({ success: true, withdrawal: existing });
        }
        const bankAccount = yield bankAccount_model_1.default.findOne({ _id: bankAccountId, userId });
        if (!bankAccount) {
            return next(new ErrorHandler_1.default("Bank account not found", 404));
        }
        const withdrawal = yield withdrawal_model_1.default.create({
            userId,
            bankAccountId,
            amount: Number(amount),
            status: "pending",
            idempotencyKey,
        });
        try {
            yield (0, wallet_service_1.debit)({
                userId,
                amount: Number(amount),
                reason: "withdrawal",
                referenceId: String(withdrawal._id),
                idempotencyKey: `withdrawal:${withdrawal._id}`,
            });
        }
        catch (e) {
            withdrawal.status = "failed";
            withdrawal.failureReason =
                e instanceof wallet_service_1.InsufficientBalanceError ? "Insufficient balance" : e.message;
            yield withdrawal.save();
            return next(new ErrorHandler_1.default(withdrawal.failureReason, 400));
        }
        const transferService = (0, transferFactory_1.getTransferService)();
        if (!transferService.isEnabled()) {
            withdrawal.status = "failed";
            withdrawal.failureReason = "Transfer provider not configured";
            yield withdrawal.save();
            yield reverseWithdrawalDebit(withdrawal);
            return next(new ErrorHandler_1.default("Withdrawals are temporarily unavailable", 503));
        }
        try {
            let recipientCode = bankAccount.recipientCode;
            if (!recipientCode) {
                const recipient = yield transferService.createRecipient({
                    accountNumber: bankAccount.accountNumber,
                    bankCode: bankAccount.bankCode,
                    accountName: bankAccount.accountName,
                });
                recipientCode = recipient.recipientCode;
                bankAccount.recipientCode = recipientCode;
                yield bankAccount.save();
            }
            const transferReference = `withdrawal_${withdrawal._id}_${Date.now()}`;
            const transferResult = yield transferService.initiateTransfer({
                amount: Number(amount),
                recipientCode,
                reference: transferReference,
            });
            withdrawal.status = "processing";
            withdrawal.paystackTransferCode = transferResult.transferCode;
            withdrawal.paystackTransferReference = transferReference;
            yield withdrawal.save();
        }
        catch (e) {
            withdrawal.status = "failed";
            withdrawal.failureReason = e.message;
            yield withdrawal.save();
            yield reverseWithdrawalDebit(withdrawal);
            return next(new ErrorHandler_1.default(`Withdrawal failed: ${e.message}`, 502));
        }
        res.status(201).json({ success: true, withdrawal });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// GET /wallet/withdrawals
exports.listWithdrawals = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const withdrawals = yield withdrawal_model_1.default.find({ userId })
            .sort({ createdAt: -1 })
            .lean();
        res.status(200).json({ success: true, withdrawals });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// GET /wallet/withdrawals/:id
exports.getWithdrawal = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { id } = req.params;
        const withdrawal = yield withdrawal_model_1.default.findOne({ _id: id, userId }).lean();
        if (!withdrawal)
            return next(new ErrorHandler_1.default("Withdrawal not found", 404));
        res.status(200).json({ success: true, withdrawal });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// POST /payments/webhook/paystack-transfer (no auth — called by Paystack)
exports.paystackTransferWebhook = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const transferService = (0, transferFactory_1.getTransferService)();
        const validation = transferService.validateWebhook(req.headers, req.body);
        if (!validation.isValid) {
            return res.status(400).send("Invalid signature");
        }
        const event = req.body;
        const reference = (_a = event === null || event === void 0 ? void 0 : event.data) === null || _a === void 0 ? void 0 : _a.reference;
        if (!reference)
            return res.status(200).send("Webhook received");
        const withdrawal = yield withdrawal_model_1.default.findOne({
            paystackTransferReference: reference,
        });
        if (!withdrawal)
            return res.status(200).send("Webhook received");
        if (event.event === "transfer.success") {
            withdrawal.status = "paid";
            yield withdrawal.save();
        }
        else if (event.event === "transfer.failed" || event.event === "transfer.reversed") {
            if (withdrawal.status !== "failed") {
                withdrawal.status = "failed";
                withdrawal.failureReason = ((_b = event.data) === null || _b === void 0 ? void 0 : _b.message) || event.event;
                yield withdrawal.save();
                yield reverseWithdrawalDebit(withdrawal);
            }
        }
        res.status(200).send("Webhook received");
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Webhook processing failed: ${error.message}`, 500));
    }
}));
