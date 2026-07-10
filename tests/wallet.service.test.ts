import { connectTestDB, clearTestDB, closeTestDB } from "./setup";
import WalletModel from "../models/wallet.model";
import WalletTransactionModel from "../models/walletTransaction.model";
import {
  credit,
  debit,
  getBalance,
  reconcileAllWallets,
  InsufficientBalanceError,
} from "../services/wallet/wallet.service";

describe("Wallet ledger", () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  it("credits a new wallet and creates a matching ledger row", async () => {
    const userId = "user-1";
    const entry = await credit({
      userId,
      amount: 500,
      reason: "weekly_payout",
      idempotencyKey: "credit-1",
    });

    expect(entry.balanceAfter).toBe(500);
    const balance = await getBalance(userId);
    expect(balance).toBe(500);

    const ledgerCount = await WalletTransactionModel.countDocuments({ userId });
    expect(ledgerCount).toBe(1);
  });

  it("debits a wallet with sufficient balance", async () => {
    const userId = "user-2";
    await credit({ userId, amount: 1000, reason: "weekly_payout", idempotencyKey: "c-1" });
    const entry = await debit({
      userId,
      amount: 300,
      reason: "withdrawal",
      idempotencyKey: "d-1",
    });

    expect(entry.balanceAfter).toBe(700);
    expect(await getBalance(userId)).toBe(700);
  });

  it("rejects a debit that would overdraw the wallet", async () => {
    const userId = "user-3";
    await credit({ userId, amount: 100, reason: "weekly_payout", idempotencyKey: "c-2" });

    await expect(
      debit({ userId, amount: 200, reason: "withdrawal", idempotencyKey: "d-2" })
    ).rejects.toBeInstanceOf(InsufficientBalanceError);

    expect(await getBalance(userId)).toBe(100); // unchanged
  });

  it("is idempotent: a repeated credit with the same idempotencyKey does not double-credit", async () => {
    const userId = "user-4";
    await credit({ userId, amount: 250, reason: "weekly_payout", idempotencyKey: "same-key" });
    await credit({ userId, amount: 250, reason: "weekly_payout", idempotencyKey: "same-key" });

    expect(await getBalance(userId)).toBe(250);
    const ledgerCount = await WalletTransactionModel.countDocuments({ userId });
    expect(ledgerCount).toBe(1);
  });

  it("is idempotent: a repeated debit with the same idempotencyKey does not double-debit", async () => {
    const userId = "user-5";
    await credit({ userId, amount: 1000, reason: "weekly_payout", idempotencyKey: "c-3" });
    await debit({ userId, amount: 400, reason: "withdrawal", idempotencyKey: "same-debit-key" });
    await debit({ userId, amount: 400, reason: "withdrawal", idempotencyKey: "same-debit-key" });

    expect(await getBalance(userId)).toBe(600);
  });

  it("under concurrent debits exceeding the balance, only the affordable one succeeds", async () => {
    const userId = "user-6";
    await credit({ userId, amount: 100, reason: "weekly_payout", idempotencyKey: "c-4" });

    const results = await Promise.allSettled([
      debit({ userId, amount: 60, reason: "withdrawal", idempotencyKey: "race-a" }),
      debit({ userId, amount: 60, reason: "withdrawal", idempotencyKey: "race-b" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
    expect(await getBalance(userId)).toBe(40);
  });

  it("balance always equals the sum of the ledger", async () => {
    const userId = "user-7";
    await credit({ userId, amount: 500, reason: "weekly_payout", idempotencyKey: "a" });
    await debit({ userId, amount: 200, reason: "withdrawal", idempotencyKey: "b" });
    await credit({ userId, amount: 100, reason: "withdrawal_reversal", idempotencyKey: "c" });

    const entries = await WalletTransactionModel.find({ userId }).lean();
    const ledgerSum = entries.reduce(
      (sum, e) => sum + (e.type === "credit" ? e.amount : -e.amount),
      0
    );
    expect(await getBalance(userId)).toBe(ledgerSum);
    expect(ledgerSum).toBe(400);
  });

  it("reconciliation corrects a wallet whose cached balance has drifted from the ledger", async () => {
    const userId = "user-8";
    await credit({ userId, amount: 500, reason: "weekly_payout", idempotencyKey: "a" });

    // Simulate drift: directly corrupt the cached balance without touching the ledger
    await WalletModel.updateOne({ userId }, { $set: { balance: 999 } });
    expect(await getBalance(userId)).toBe(999);

    const result = await reconcileAllWallets();
    expect(result.corrected).toBeGreaterThanOrEqual(1);
    expect(await getBalance(userId)).toBe(500);
  });
});
