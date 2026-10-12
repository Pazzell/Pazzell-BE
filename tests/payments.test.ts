import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import {
  api,
  createUser,
  resetState,
  signedWebhook,
  chargeSuccess,
  DAY_MS,
  TestUser,
} from "./helpers";
import userModel from "../models/user.model";
import PaymentModel from "../models/payment.model";
import ProSubscriptionModel from "../models/proSubscription.model";
import WalletTransactionModel from "../models/walletTransaction.model";
import { paystackService } from "../services/payment";
import { getPlan } from "../services/plan/plan.service";
import { creditWallet, getBalance } from "../services/wallet/wallet.service";

const checkout = (user: TestUser, body: any = {}) =>
  api().post("/api/v1/plan/pro/checkout").set(user.auth).send(body);
const proUntilOf = async (user: TestUser) =>
  (await userModel.findById(user.id).lean())!.proUntil as Date | null;

describe("Pro plan and payments", () => {
  let initialize: jest.SpyInstance;
  let verify: jest.SpyInstance;

  beforeAll(connectTestDB);
  beforeEach(() => {
    // The gateway is never called for real in tests.
    initialize = jest.spyOn(paystackService, "initialize").mockImplementation(async (p) => ({
      success: true,
      authorizationUrl: `https://checkout.test/${p.reference}`,
      reference: p.reference,
    }));
    verify = jest.spyOn(paystackService, "verify");
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await resetState();
  });
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  describe("getPlan", () => {
    it("is Pro only while proUntil is strictly in the future", () => {
      const now = new Date("2026-06-15T12:00:00Z");
      expect(getPlan({ proUntil: new Date(now.getTime() + 1) }, now).isPro).toBe(true);
      expect(getPlan({ proUntil: now }, now).isPro).toBe(false);
      expect(getPlan({ proUntil: new Date(now.getTime() - 1) }, now)).toEqual({
        tier: "freemium",
        isPro: false,
        proUntil: null,
      });
      expect(getPlan({ proUntil: null }, now).tier).toBe("freemium");
      expect(getPlan(null, now).isPro).toBe(false);
    });

    it("is computed on the server on every request and ignores client-sent plan fields", async () => {
      const user = await createUser();
      const res = await api()
        .put("/api/v1/profile/gamer")
        .set(user.auth)
        .send({ firstName: "Mallory", proUntil: "2099-01-01T00:00:00Z", role: "admin", nonCampaignPlaysSinceCampaign: -5 });
      expect(res.status).toBe(200);
      const stored = await userModel.findById(user.id).lean();
      expect(stored!.proUntil).toBeNull();
      expect(stored!.role).toBe("gamer");
      expect(stored!.nonCampaignPlaysSinceCampaign).toBe(0);

      // An expired plan stops counting immediately, with no job involved.
      await userModel.updateOne({ _id: user.id }, { proUntil: new Date(Date.now() + 60_000) });
      expect((await api().get("/api/v1/plan/me").set(user.auth)).body.plan.tier).toBe("pro");
      await userModel.updateOne({ _id: user.id }, { proUntil: new Date(Date.now() - 1000) });
      expect((await api().get("/api/v1/plan/me").set(user.auth)).body.plan).toEqual({
        tier: "freemium",
        isPro: false,
        proUntil: null,
      });
    });
  });

  describe("checkout", () => {
    it("creates a pending payment for the configured price through the gateway", async () => {
      const user = await createUser();
      const res = await checkout(user);
      expect(res.status).toBe(201);
      expect(res.body.checkout.authorizationUrl).toContain("https://checkout.test/");

      const payment = await PaymentModel.findOne({ userId: user.id }).lean();
      expect(payment).toMatchObject({
        purpose: "pro",
        amount: 1500,
        currency: "NGN",
        durationDays: 30,
        status: "pending",
        gateway: "paystack",
      });
      expect(initialize).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1500, currency: "NGN", email: user.email })
      );
      expect(await proUntilOf(user)).toBeNull(); // nothing is granted before the payment is confirmed
    });

    it("uses the admin-configured price and currency", async () => {
      const admin = await createUser({ role: "admin" });
      const user = await createUser();
      await api().put("/api/v1/admin/config/pro.priceAmount").set(admin.auth).send({ value: 2000 });
      await api().put("/api/v1/admin/config/payments.currency").set(admin.auth).send({ value: "GHS" });
      await checkout(user);
      const payment = await PaymentModel.findOne({ userId: user.id }).lean();
      expect(payment).toMatchObject({ amount: 2000, currency: "GHS" });
    });

    it("returns the same checkout for a repeated idempotencyKey", async () => {
      const user = await createUser();
      const first = await checkout(user, { idempotencyKey: "click-1" });
      const second = await checkout(user, { idempotencyKey: "click-1" });
      expect(second.status).toBe(200);
      expect(second.body.checkout.reference).toBe(first.body.checkout.reference);
      expect(await PaymentModel.countDocuments({ userId: user.id })).toBe(1);
      expect(initialize).toHaveBeenCalledTimes(1);
    });

    it("requires login", async () => {
      expect((await api().post("/api/v1/plan/pro/checkout").send({})).status).toBe(401);
    });
  });

  describe("webhook", () => {
    it("rejects a webhook with a missing or wrong signature", async () => {
      const user = await createUser();
      const { reference } = (await checkout(user)).body.checkout;
      const body = chargeSuccess(reference, 1500, new Date());

      const unsigned = await api().post("/api/v1/payments/webhook/paystack").send(body);
      expect(unsigned.status).toBe(400);
      const forged = await api()
        .post("/api/v1/payments/webhook/paystack")
        .set("x-paystack-signature", "0".repeat(128))
        .send(body);
      expect(forged.status).toBe(400);

      expect(await proUntilOf(user)).toBeNull();
      expect((await PaymentModel.findOne({ reference }).lean())!.status).toBe("pending");
    });

    it("grants 30 days of Pro starting from the payment time", async () => {
      const user = await createUser();
      const { reference } = (await checkout(user)).body.checkout;
      const paidAt = new Date(Date.now() - 60_000);

      const res = await signedWebhook(chargeSuccess(reference, 1500, paidAt));
      expect(res.status).toBe(200);

      const proUntil = await proUntilOf(user);
      expect(proUntil!.getTime()).toBe(paidAt.getTime() + 30 * DAY_MS);
      const sub = await ProSubscriptionModel.findOne({ userId: user.id }).lean();
      expect(sub).toMatchObject({ paidAt, startsAt: paidAt, endsAt: proUntil, durationDays: 30 });
      const payment = await PaymentModel.findOne({ reference }).lean();
      expect(payment).toMatchObject({ status: "success", paidAt });
      expect(payment!.fulfilledAt).toBeInstanceOf(Date);
      expect((await api().get("/api/v1/plan/me").set(user.auth)).body.plan.tier).toBe("pro");
    });

    it("never extends Pro twice when the same webhook is delivered twice", async () => {
      const user = await createUser();
      const { reference } = (await checkout(user)).body.checkout;
      const paidAt = new Date();
      const body = chargeSuccess(reference, 1500, paidAt);

      await signedWebhook(body);
      const afterFirst = await proUntilOf(user);
      await signedWebhook(body);
      await signedWebhook(body);

      expect((await proUntilOf(user))!.getTime()).toBe(afterFirst!.getTime());
      expect(await ProSubscriptionModel.countDocuments({ userId: user.id })).toBe(1);
    });

    it("stays idempotent under concurrent duplicate deliveries", async () => {
      const user = await createUser();
      const { reference } = (await checkout(user)).body.checkout;
      const paidAt = new Date();
      const body = chargeSuccess(reference, 1500, paidAt);

      await Promise.all(Array.from({ length: 6 }, () => signedWebhook(body)));

      expect((await proUntilOf(user))!.getTime()).toBe(paidAt.getTime() + 30 * DAY_MS);
      expect(await ProSubscriptionModel.countDocuments({ userId: user.id })).toBe(1);
    });

    it("extends from the current proUntil when renewing while still Pro", async () => {
      const user = await createUser();
      const firstPaid = new Date(Date.now() - 10 * DAY_MS);
      const first = (await checkout(user)).body.checkout.reference;
      await signedWebhook(chargeSuccess(first, 1500, firstPaid));

      const secondPaid = new Date();
      const second = (await checkout(user)).body.checkout.reference;
      await signedWebhook(chargeSuccess(second, 1500, secondPaid));

      // 30 days added on top of the remaining 20, not restarted from today.
      expect((await proUntilOf(user))!.getTime()).toBe(firstPaid.getTime() + 60 * DAY_MS);
      const subs = await ProSubscriptionModel.find({ userId: user.id }).sort({ paidAt: 1 }).lean();
      expect(subs[1].startsAt.getTime()).toBe(firstPaid.getTime() + 30 * DAY_MS);
    });

    it("starts from the payment date when renewing after expiry", async () => {
      const user = await createUser();
      const firstPaid = new Date(Date.now() - 45 * DAY_MS);
      const first = (await checkout(user)).body.checkout.reference;
      await signedWebhook(chargeSuccess(first, 1500, firstPaid));
      // Paid 45 days ago for 30 days: expired.
      expect((await api().get("/api/v1/plan/me").set(user.auth)).body.plan.isPro).toBe(false);

      const secondPaid = new Date();
      const second = (await checkout(user)).body.checkout.reference;
      await signedWebhook(chargeSuccess(second, 1500, secondPaid));
      expect((await proUntilOf(user))!.getTime()).toBe(secondPaid.getTime() + 30 * DAY_MS);
    });

    it("expires exactly 30 days after the payment", async () => {
      const stillPro = await createUser();
      const expired = await createUser();
      const a = (await checkout(stillPro)).body.checkout.reference;
      const b = (await checkout(expired)).body.checkout.reference;
      await signedWebhook(chargeSuccess(a, 1500, new Date(Date.now() - 30 * DAY_MS + 60_000)));
      await signedWebhook(chargeSuccess(b, 1500, new Date(Date.now() - 30 * DAY_MS - 60_000)));

      expect((await api().get("/api/v1/plan/me").set(stillPro.auth)).body.plan.isPro).toBe(true);
      expect((await api().get("/api/v1/plan/me").set(expired.auth)).body.plan.isPro).toBe(false);
    });

    it("does not apply a payment whose amount or currency differs from what was asked", async () => {
      const user = await createUser();
      const { reference } = (await checkout(user)).body.checkout;
      await signedWebhook(chargeSuccess(reference, 0.01, new Date()));
      expect(await proUntilOf(user)).toBeNull();
      expect((await PaymentModel.findOne({ reference }).lean())!.failureReason).toBe("amount_mismatch");

      const other = (await checkout(user)).body.checkout.reference;
      await signedWebhook(chargeSuccess(other, 1500, new Date(), "USD"));
      expect(await proUntilOf(user)).toBeNull();
    });

    it("ignores a signed webhook for an unknown reference", async () => {
      const res = await signedWebhook(chargeSuccess("pz_pro_unknown", 1500, new Date()));
      expect(res.status).toBe(200);
      expect(await ProSubscriptionModel.countDocuments({})).toBe(0);
    });
  });

  describe("server-side verification", () => {
    it("confirms through the gateway and is idempotent together with the webhook", async () => {
      const user = await createUser();
      const { reference } = (await checkout(user)).body.checkout;
      const paidAt = new Date();
      verify.mockResolvedValue({
        success: true,
        status: "success",
        reference,
        amount: 1500,
        currency: "NGN",
        paidAt,
      });

      const first = await api().get(`/api/v1/payments/verify/${reference}`).set(user.auth);
      expect(first.status).toBe(200);
      expect(first.body.payment.status).toBe("success");
      expect(first.body.plan.isPro).toBe(true);

      await signedWebhook(chargeSuccess(reference, 1500, paidAt));
      await api().get(`/api/v1/payments/verify/${reference}`).set(user.auth);

      expect((await proUntilOf(user))!.getTime()).toBe(paidAt.getTime() + 30 * DAY_MS);
      expect(await ProSubscriptionModel.countDocuments({ userId: user.id })).toBe(1);
    });

    it("grants nothing while the gateway has not confirmed the payment", async () => {
      const user = await createUser();
      const { reference } = (await checkout(user)).body.checkout;
      verify.mockResolvedValue({ success: false, status: "pending", reference, amount: 1500, currency: "NGN" });
      const res = await api().get(`/api/v1/payments/verify/${reference}`).set(user.auth);
      expect(res.body.payment.status).toBe("pending");
      expect(res.body.plan.isPro).toBe(false);
    });

    it("does not let one user verify another user's payment", async () => {
      const owner = await createUser();
      const other = await createUser();
      const { reference } = (await checkout(owner)).body.checkout;
      const res = await api().get(`/api/v1/payments/verify/${reference}`).set(other.auth);
      expect(res.status).toBe(404);
      expect(verify).not.toHaveBeenCalled();
    });
  });

  describe("the wallet is never used to pay", () => {
    it("leaves the wallet balance and ledger untouched by a Pro purchase", async () => {
      const user = await createUser();
      await creditWallet(user.id, 5000, "reward", { idempotencyKey: "reward-1" });

      const { reference } = (await checkout(user)).body.checkout;
      await signedWebhook(chargeSuccess(reference, 1500, new Date()));

      expect((await api().get("/api/v1/plan/me").set(user.auth)).body.plan.isPro).toBe(true);
      expect(await getBalance(user.id)).toBe(5000);
      const ledger = await WalletTransactionModel.find({ userId: user.id }).lean();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ type: "credit", reason: "reward" });
    });

    it("has no way to pay from the wallet: a wallet balance does not grant Pro", async () => {
      const user = await createUser();
      await creditWallet(user.id, 100000, "reward");
      // There is no pay-with-wallet route; checkout always returns a gateway URL.
      const res = await checkout(user, { payWithWallet: true, source: "wallet" });
      expect(res.body.checkout.authorizationUrl).toContain("https://checkout.test/");
      expect(await proUntilOf(user)).toBeNull();
      expect(await getBalance(user.id)).toBe(100000);
    });
  });
});
