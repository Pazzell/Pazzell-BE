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
const setup_1 = require("./setup");
const wallet_model_1 = __importDefault(require("../models/wallet.model"));
const walletTransaction_model_1 = __importDefault(require("../models/walletTransaction.model"));
const wallet_service_1 = require("../services/wallet/wallet.service");
describe("Wallet ledger", () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.connectTestDB)();
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.clearTestDB)();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.closeTestDB)();
    }));
    it("credits a new wallet and creates a matching ledger row", () => __awaiter(void 0, void 0, void 0, function* () {
        const userId = "user-1";
        const entry = yield (0, wallet_service_1.credit)({
            userId,
            amount: 500,
            reason: "weekly_payout",
            idempotencyKey: "credit-1",
        });
        expect(entry.balanceAfter).toBe(500);
        const balance = yield (0, wallet_service_1.getBalance)(userId);
        expect(balance).toBe(500);
        const ledgerCount = yield walletTransaction_model_1.default.countDocuments({ userId });
        expect(ledgerCount).toBe(1);
    }));
    it("debits a wallet with sufficient balance", () => __awaiter(void 0, void 0, void 0, function* () {
        const userId = "user-2";
        yield (0, wallet_service_1.credit)({ userId, amount: 1000, reason: "weekly_payout", idempotencyKey: "c-1" });
        const entry = yield (0, wallet_service_1.debit)({
            userId,
            amount: 300,
            reason: "withdrawal",
            idempotencyKey: "d-1",
        });
        expect(entry.balanceAfter).toBe(700);
        expect(yield (0, wallet_service_1.getBalance)(userId)).toBe(700);
    }));
    it("rejects a debit that would overdraw the wallet", () => __awaiter(void 0, void 0, void 0, function* () {
        const userId = "user-3";
        yield (0, wallet_service_1.credit)({ userId, amount: 100, reason: "weekly_payout", idempotencyKey: "c-2" });
        yield expect((0, wallet_service_1.debit)({ userId, amount: 200, reason: "withdrawal", idempotencyKey: "d-2" })).rejects.toBeInstanceOf(wallet_service_1.InsufficientBalanceError);
        expect(yield (0, wallet_service_1.getBalance)(userId)).toBe(100); // unchanged
    }));
    it("is idempotent: a repeated credit with the same idempotencyKey does not double-credit", () => __awaiter(void 0, void 0, void 0, function* () {
        const userId = "user-4";
        yield (0, wallet_service_1.credit)({ userId, amount: 250, reason: "weekly_payout", idempotencyKey: "same-key" });
        yield (0, wallet_service_1.credit)({ userId, amount: 250, reason: "weekly_payout", idempotencyKey: "same-key" });
        expect(yield (0, wallet_service_1.getBalance)(userId)).toBe(250);
        const ledgerCount = yield walletTransaction_model_1.default.countDocuments({ userId });
        expect(ledgerCount).toBe(1);
    }));
    it("is idempotent: a repeated debit with the same idempotencyKey does not double-debit", () => __awaiter(void 0, void 0, void 0, function* () {
        const userId = "user-5";
        yield (0, wallet_service_1.credit)({ userId, amount: 1000, reason: "weekly_payout", idempotencyKey: "c-3" });
        yield (0, wallet_service_1.debit)({ userId, amount: 400, reason: "withdrawal", idempotencyKey: "same-debit-key" });
        yield (0, wallet_service_1.debit)({ userId, amount: 400, reason: "withdrawal", idempotencyKey: "same-debit-key" });
        expect(yield (0, wallet_service_1.getBalance)(userId)).toBe(600);
    }));
    it("under concurrent debits exceeding the balance, only the affordable one succeeds", () => __awaiter(void 0, void 0, void 0, function* () {
        const userId = "user-6";
        yield (0, wallet_service_1.credit)({ userId, amount: 100, reason: "weekly_payout", idempotencyKey: "c-4" });
        const results = yield Promise.allSettled([
            (0, wallet_service_1.debit)({ userId, amount: 60, reason: "withdrawal", idempotencyKey: "race-a" }),
            (0, wallet_service_1.debit)({ userId, amount: 60, reason: "withdrawal", idempotencyKey: "race-b" }),
        ]);
        const fulfilled = results.filter((r) => r.status === "fulfilled").length;
        const rejected = results.filter((r) => r.status === "rejected").length;
        expect(fulfilled).toBe(1);
        expect(rejected).toBe(1);
        expect(yield (0, wallet_service_1.getBalance)(userId)).toBe(40);
    }));
    it("balance always equals the sum of the ledger", () => __awaiter(void 0, void 0, void 0, function* () {
        const userId = "user-7";
        yield (0, wallet_service_1.credit)({ userId, amount: 500, reason: "weekly_payout", idempotencyKey: "a" });
        yield (0, wallet_service_1.debit)({ userId, amount: 200, reason: "withdrawal", idempotencyKey: "b" });
        yield (0, wallet_service_1.credit)({ userId, amount: 100, reason: "withdrawal_reversal", idempotencyKey: "c" });
        const entries = yield walletTransaction_model_1.default.find({ userId }).lean();
        const ledgerSum = entries.reduce((sum, e) => sum + (e.type === "credit" ? e.amount : -e.amount), 0);
        expect(yield (0, wallet_service_1.getBalance)(userId)).toBe(ledgerSum);
        expect(ledgerSum).toBe(400);
    }));
    it("reconciliation corrects a wallet whose cached balance has drifted from the ledger", () => __awaiter(void 0, void 0, void 0, function* () {
        const userId = "user-8";
        yield (0, wallet_service_1.credit)({ userId, amount: 500, reason: "weekly_payout", idempotencyKey: "a" });
        // Simulate drift: directly corrupt the cached balance without touching the ledger
        yield wallet_model_1.default.updateOne({ userId }, { $set: { balance: 999 } });
        expect(yield (0, wallet_service_1.getBalance)(userId)).toBe(999);
        const result = yield (0, wallet_service_1.reconcileAllWallets)();
        expect(result.corrected).toBeGreaterThanOrEqual(1);
        expect(yield (0, wallet_service_1.getBalance)(userId)).toBe(500);
    }));
});
