import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import { api, createUser, resetState } from "./helpers";
import WalletTransactionModel from "../models/walletTransaction.model";
import WithdrawalModel from "../models/withdrawal.model";
import { creditWallet, getBalance } from "../services/wallet/wallet.service";

// The bank-transfer provider is replaced so no real transfer is ever attempted.
const transfer = {
  isEnabled: jest.fn(() => true),
  resolveAccount: jest.fn(async (accountNumber: string, bankCode: string) => ({
    accountNumber,
    accountName: "TEST ACCOUNT",
    bankCode,
  })),
  createRecipient: jest.fn(async () => ({ recipientCode: "RCP_test" })),
  initiateTransfer: jest.fn(async (p: any) => ({
    transferCode: "TRF_test",
    reference: p.reference,
    status: "pending",
  })),
  verifyTransfer: jest.fn(),
  validateWebhook: jest.fn(() => ({ isValid: true })),
};
jest.mock("../services/transfer/transferFactory", () => ({
  getTransferService: () => transfer,
}));

describe("Wallet (withdraw-only)", () => {
  beforeAll(connectTestDB);
  afterEach(async () => {
    jest.clearAllMocks();
    await resetState();
  });
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  async function userWithBank(balance: number) {
    const user = await createUser();
    if (balance > 0) await creditWallet(user.id, balance, "reward", { idempotencyKey: `seed-${user.id}` });
    const bank = await api()
      .post("/api/v1/wallet/bank-accounts")
      .set(user.auth)
      .send({ accountNumber: "0123456789", bankCode: "058", bankName: "Test Bank" });
    expect(bank.status).toBe(201);
    return { user, bankAccountId: bank.body.bankAccount._id as string };
  }

  it("credits rewards through creditWallet, idempotently", async () => {
    const user = await createUser();
    const first = await creditWallet(user.id, 250, "reward", { idempotencyKey: "quiz-reward-1", referenceId: "quiz-1" });
    await creditWallet(user.id, 250, "reward", { idempotencyKey: "quiz-reward-1" });
    expect(first).toMatchObject({ type: "credit", reason: "reward", amount: 250, balanceAfter: 250 });
    expect(await getBalance(user.id)).toBe(250);

    const balance = await api().get("/api/v1/wallet/balance").set(user.auth);
    expect(balance.body).toMatchObject({ success: true, balance: 250 });
    const ledger = await api().get("/api/v1/wallet/transactions").set(user.auth);
    expect(ledger.body.transactions).toHaveLength(1);
    await expect(creditWallet(user.id, 0)).rejects.toThrow("amount must be positive");
  });

  it("withdraws a reward to the player's bank account", async () => {
    const { user, bankAccountId } = await userWithBank(1000);

    const res = await api()
      .post("/api/v1/wallet/withdrawals")
      .set(user.auth)
      .send({ bankAccountId, amount: 400, idempotencyKey: "wd-1" });
    expect(res.status).toBe(201);
    expect(res.body.withdrawal).toMatchObject({ amount: 400, status: "processing" });
    expect(transfer.initiateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 400, recipientCode: "RCP_test" })
    );
    expect(await getBalance(user.id)).toBe(600);

    // The same idempotencyKey never withdraws twice.
    const repeat = await api()
      .post("/api/v1/wallet/withdrawals")
      .set(user.auth)
      .send({ bankAccountId, amount: 400, idempotencyKey: "wd-1" });
    expect(repeat.status).toBe(200);
    expect(await getBalance(user.id)).toBe(600);
    expect(transfer.initiateTransfer).toHaveBeenCalledTimes(1);

    const list = await api().get("/api/v1/wallet/withdrawals").set(user.auth);
    expect(list.body.withdrawals).toHaveLength(1);
  });

  it("refuses to withdraw more than the balance", async () => {
    const { user, bankAccountId } = await userWithBank(100);
    const res = await api()
      .post("/api/v1/wallet/withdrawals")
      .set(user.auth)
      .send({ bankAccountId, amount: 500, idempotencyKey: "wd-2" });
    expect(res.status).toBe(400);
    expect(await getBalance(user.id)).toBe(100);
    expect(transfer.initiateTransfer).not.toHaveBeenCalled();
  });

  it("returns the money when the bank transfer fails", async () => {
    const { user, bankAccountId } = await userWithBank(1000);
    await api()
      .post("/api/v1/wallet/withdrawals")
      .set(user.auth)
      .send({ bankAccountId, amount: 300, idempotencyKey: "wd-3" });
    const withdrawal = await WithdrawalModel.findOne({ userId: user.id }).lean();

    const hook = await api()
      .post("/api/v1/payments/webhook/paystack-transfer")
      .send({ event: "transfer.failed", data: { reference: withdrawal!.paystackTransferReference } });
    expect(hook.status).toBe(200);
    expect(await getBalance(user.id)).toBe(1000);
    const reasons = (await WalletTransactionModel.find({ userId: user.id }).lean()).map((t) => t.reason).sort();
    expect(reasons).toEqual(["reward", "withdrawal", "withdrawal_reversal"]);
  });

  it("keeps wallets private and exposes no top-up or pay route", async () => {
    const { user, bankAccountId } = await userWithBank(1000);
    const other = await createUser();

    expect((await api().get("/api/v1/wallet/balance")).status).toBe(401);
    const stolen = await api()
      .post("/api/v1/wallet/withdrawals")
      .set(other.auth)
      .send({ bankAccountId, amount: 100, idempotencyKey: "wd-4" });
    expect(stolen.status).toBe(404);
    expect(await getBalance(user.id)).toBe(1000);

    for (const path of ["/wallet/deposit", "/wallet/top-up", "/wallet/topup", "/wallet/pay", "/wallet/credit"]) {
      const res = await api().post(`/api/v1${path}`).set(user.auth).send({ amount: 100 });
      expect(res.status).toBe(404);
    }
  });
});
