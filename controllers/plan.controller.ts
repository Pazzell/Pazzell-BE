import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PaymentModel from "../models/payment.model";
import { paystackService } from "../services/payment";
import {
  confirmPayment,
  startCheckout,
  verifyAndConfirm,
} from "../services/payment/payment.service";
import { fromMinorUnits, parseGatewayDate } from "../services/payment/paystack.service";
import { getPlan, listProSubscriptions } from "../services/plan/plan.service";
import {
  getCampaignPricing,
  getCustomQuizFreeLimit,
  getCustomQuizMinCards,
  getInterruptionThreshold,
  getDefaultTimerSeconds,
  getProPricing,
  getTimerRange,
  getTriviaCardBounds,
} from "../services/config/config.service";
import { getCampaignGateState } from "../services/campaign/campaign.service";
import userModel from "../models/user.model";
import CampaignModel from "../models/campaign.model";
import { cleanString } from "../utils/validators";

// Errors thrown by the services already carry a status and a code; CatchAsyncError
// forwards them to the error middleware untouched.

const publicPayment = (payment: any) => ({
  id: String(payment._id),
  purpose: payment.purpose,
  campaignId: payment.campaignId || null,
  amount: payment.amount,
  currency: payment.currency,
  durationDays: payment.durationDays,
  reference: payment.reference,
  status: payment.status,
  paidAt: payment.paidAt || null,
  createdAt: payment.createdAt,
});

// GET /settings/game — public. Everything the client needs to build its setup screens.
export const getGameSettings = CatchAsyncError(async (req: Request, res: Response) => {
  const [defaultTimer, cards, pro, campaign, threshold, freeLimit, minCardsToPublish] =
    await Promise.all([
      getDefaultTimerSeconds(),
      getTriviaCardBounds(),
      getProPricing(),
      getCampaignPricing(),
      getInterruptionThreshold(),
      getCustomQuizFreeLimit(),
      getCustomQuizMinCards(),
    ]);
  res.status(200).json({
    success: true,
    settings: {
      timer: { ...getTimerRange(), defaultSeconds: defaultTimer },
      trivia: { minCards: cards.minCards, maxCards: cards.maxCards },
      customQuiz: { freeLimit, minCardsToPublish },
      pro,
      campaign: { ...campaign, interruptionThreshold: threshold },
    },
  });
});

// GET /plan/me
export const getMyPlan = CatchAsyncError(async (req: Request, res: Response) => {
  const user = req.user!;
  const [pricing, gate, history] = await Promise.all([
    getProPricing(),
    getCampaignGateState(user),
    listProSubscriptions(String(user._id)),
  ]);
  res.status(200).json({
    success: true,
    plan: getPlan(user),
    pricing,
    campaignGate: gate,
    history: history.map((h) => ({
      paidAt: h.paidAt,
      startsAt: h.startsAt,
      endsAt: h.endsAt,
      paymentId: h.paymentId,
    })),
  });
});

// POST /plan/pro/checkout  { idempotencyKey? }
export const startProCheckout = CatchAsyncError(async (req: Request, res: Response) => {
  const user = req.user!;
  const checkout = await startCheckout({
    user: { _id: user._id, email: user.email },
    purpose: "pro",
    idempotencyKey: cleanString(req.body?.idempotencyKey, 100),
  });
  res.status(checkout.reused ? 200 : 201).json({
    success: true,
    checkout: {
      authorizationUrl: checkout.authorizationUrl,
      reference: checkout.reference,
      payment: publicPayment(checkout.payment),
    },
  });
});

// GET /payments/verify/:reference — server-side verification for the paying user
export const verifyPayment = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = String(req.user!._id);
    const payment = await PaymentModel.findOne({ reference: req.params.reference, userId });
    if (!payment) return next(new ErrorHandler("Payment not found", 404, "PAYMENT_NOT_FOUND"));

    const current = await verifyAndConfirm(payment);
    const user = await userModel.findById(userId).select("proUntil").lean();
    const campaign = current.campaignId
      ? await CampaignModel.findById(current.campaignId).select("status startsAt endsAt").lean()
      : null;

    res.status(200).json({
      success: true,
      payment: publicPayment(current),
      plan: getPlan(user),
      campaign: campaign
        ? {
            id: String(campaign._id),
            status: campaign.status,
            startsAt: campaign.startsAt || null,
            endsAt: campaign.endsAt || null,
          }
        : null,
    });
  }
);

// GET /payments/mine
export const listMyPayments = CatchAsyncError(async (req: Request, res: Response) => {
  const payments = await PaymentModel.find({ userId: String(req.user!._id) })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.status(200).json({ success: true, payments: payments.map(publicPayment) });
});

// POST /payments/webhook/paystack (no auth — called by Paystack, authenticated by signature)
export const paystackWebhook = CatchAsyncError(async (req: Request, res: Response) => {
  const validation = paystackService.validateWebhook(req.headers, req.body, (req as any).rawBody);
  if (!validation.isValid) {
    return res.status(400).send("Invalid signature");
  }

  const event = req.body;
  if (event.event === "charge.success" && typeof event.data?.reference === "string") {
    await confirmPayment(event.data.reference, {
      amount: fromMinorUnits(Number(event.data.amount)),
      currency: String(event.data.currency || ""),
      paidAt: parseGatewayDate(event.data.paid_at || event.data.paidAt),
      raw: event.data,
    });
  }

  res.status(200).send("Webhook received");
});
