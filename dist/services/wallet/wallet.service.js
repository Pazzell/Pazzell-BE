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
exports.InsufficientBalanceError = void 0;
exports.credit = credit;
exports.debit = debit;
exports.reverseDebit = reverseDebit;
exports.getBalance = getBalance;
exports.listTransactions = listTransactions;
exports.reconcileAllWallets = reconcileAllWallets;
const wallet_model_1 = __importDefault(require("../../models/wallet.model"));
const walletTransaction_model_1 = __importDefault(require("../../models/walletTransaction.model"));
class InsufficientBalanceError extends Error {
    constructor() {
        super("Insufficient wallet balance");
    }
}
exports.InsufficientBalanceError = InsufficientBalanceError;
/**
 * Ledger-first design without requiring multi-document Mongo transactions
 * (which need a replica set — not guaranteed available in every deployment
 * target for this project). Each single-document write (the balance $inc,
 * the ledger insert) is atomic on its own; the unique `idempotencyKey` index
 * on WalletTransaction is what actually prevents double-crediting/debiting
 * under retries or concurrent requests. A nightly reconciliation job
 * (services/scheduler) re-derives Wallet.balance from
 * SUM(WalletTransaction) as defense-in-depth against the narrow window where
 * a process could crash between the balance update and the ledger insert.
 */
function ensureWallet(userId) {
    return __awaiter(this, void 0, void 0, function* () {
        let wallet = yield wallet_model_1.default.findOne({ userId });
        if (wallet)
            return wallet;
        try {
            wallet = yield wallet_model_1.default.create({ userId, balance: 0 });
        }
        catch (e) {
            if (e.code === 11000) {
                wallet = yield wallet_model_1.default.findOne({ userId });
            }
            else {
                throw e;
            }
        }
        return wallet;
    });
}
function credit(params) {
    return __awaiter(this, void 0, void 0, function* () {
        if (params.amount <= 0)
            throw new Error("amount must be positive");
        yield ensureWallet(params.userId);
        const existing = yield walletTransaction_model_1.default.findOne({
            idempotencyKey: params.idempotencyKey,
        });
        if (existing)
            return existing;
        const updatedWallet = yield wallet_model_1.default.findOneAndUpdate({ userId: params.userId }, { $inc: { balance: params.amount } }, { new: true });
        try {
            return yield walletTransaction_model_1.default.create({
                userId: params.userId,
                type: "credit",
                amount: params.amount,
                balanceAfter: updatedWallet.balance,
                reason: params.reason,
                referenceId: params.referenceId,
                idempotencyKey: params.idempotencyKey,
            });
        }
        catch (e) {
            if (e.code === 11000) {
                // Concurrent duplicate call already inserted the ledger row between our
                // existence check and this insert — undo the balance bump we just made
                // and return the entry that actually won.
                yield wallet_model_1.default.findOneAndUpdate({ userId: params.userId }, { $inc: { balance: -params.amount } });
                const winner = yield walletTransaction_model_1.default.findOne({
                    idempotencyKey: params.idempotencyKey,
                });
                return winner;
            }
            throw e;
        }
    });
}
function debit(params) {
    return __awaiter(this, void 0, void 0, function* () {
        if (params.amount <= 0)
            throw new Error("amount must be positive");
        yield ensureWallet(params.userId);
        const existing = yield walletTransaction_model_1.default.findOne({
            idempotencyKey: params.idempotencyKey,
        });
        if (existing)
            return existing;
        // Atomically enforce non-negative balance under concurrent debits.
        const updatedWallet = yield wallet_model_1.default.findOneAndUpdate({ userId: params.userId, balance: { $gte: params.amount } }, { $inc: { balance: -params.amount } }, { new: true });
        if (!updatedWallet)
            throw new InsufficientBalanceError();
        try {
            return yield walletTransaction_model_1.default.create({
                userId: params.userId,
                type: "debit",
                amount: params.amount,
                balanceAfter: updatedWallet.balance,
                reason: params.reason,
                referenceId: params.referenceId,
                idempotencyKey: params.idempotencyKey,
            });
        }
        catch (e) {
            if (e.code === 11000) {
                yield wallet_model_1.default.findOneAndUpdate({ userId: params.userId }, { $inc: { balance: params.amount } });
                const winner = yield walletTransaction_model_1.default.findOne({
                    idempotencyKey: params.idempotencyKey,
                });
                return winner;
            }
            throw e;
        }
    });
}
/** Compensating credit for a failed withdrawal — append-only, never mutates the original debit. */
function reverseDebit(originalIdempotencyKey, params) {
    return __awaiter(this, void 0, void 0, function* () {
        return credit(Object.assign(Object.assign({}, params), { reason: "withdrawal_reversal" }));
    });
}
function getBalance(userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const wallet = yield ensureWallet(userId);
        return wallet.balance;
    });
}
function listTransactions(userId_1) {
    return __awaiter(this, arguments, void 0, function* (userId, limit = 50) {
        return walletTransaction_model_1.default.find({ userId })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
    });
}
/** Recomputes every user's Wallet.balance from the ledger sum — the nightly reconciliation job. */
function reconcileAllWallets() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const wallets = yield wallet_model_1.default.find({});
        let corrected = 0;
        for (const wallet of wallets) {
            const agg = yield walletTransaction_model_1.default.aggregate([
                { $match: { userId: wallet.userId } },
                {
                    $group: {
                        _id: null,
                        total: {
                            $sum: {
                                $cond: [{ $eq: ["$type", "credit"] }, "$amount", { $multiply: ["$amount", -1] }],
                            },
                        },
                    },
                },
            ]);
            const ledgerSum = ((_a = agg[0]) === null || _a === void 0 ? void 0 : _a.total) || 0;
            if (ledgerSum !== wallet.balance) {
                wallet.balance = ledgerSum;
                yield wallet.save();
                corrected++;
            }
        }
        return { checked: wallets.length, corrected };
    });
}
