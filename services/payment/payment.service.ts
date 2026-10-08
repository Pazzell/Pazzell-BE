import { randomUUID } from "crypto";
import ErrorHandler from "../../utils/ErrorHandler";
import PaymentModel, { IPayment, PaymentPurpose } from "../../models/payment.model";
import { paystackService } from "./paystack.service";
import { getCampaignPricing, getProPricing } from "../config/config.service";
import { applyProPayment } from "../plan/plan.service";
import { activateCampaignFromPayment } from "../campaign/campaign.service";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

interface CheckoutParams {
  user: { _id: any; email: string };
  purpose: PaymentPurpose;
  campaignId?: string;
  idempotencyKey?: string;
}

export interface CheckoutResult {
  payment: IPayment;
  authorizationUrl: string;
  reference: string;
  reused: boolean;
}

/**
 * Creates a pending Payment and a gateway checkout for it. Pro and campaigns are
 * paid for through the gateway only — the wallet is never debited here.
 * Repeating the call with the same idempotencyKey returns the same pending checkout.
 */
export async function startCheckout(params: CheckoutParams): Promise<CheckoutResult> {
  const userId = String(params.user._id);
  if (!paystackService.isConfigured()) {
    throw new ErrorHandler("Payment gateway is not configured", 503, "PAYMENTS_UNAVAILABLE");
  }

  const pricing =
    params.purpose === "pro" ? await getProPricing() : await getCampaignPricing();
  const reference = `pz_${params.purpose}_${randomUUID().replace(/-/g, "")}`;
  const idempotencyKey = params.idempotencyKey
    ? `${userId}:${params.purpose}:${params.campaignId || ""}:${params.idempotencyKey}`
    : `ref:${reference}`;

  const reuse = (existing: IPayment): CheckoutResult => {
    if (existing.status === "success") {
      throw new ErrorHandler("This checkout has already been paid", 409, "ALREADY_PAID");
    }
    if (existing.status !== "pending" || !existing.authorizationUrl) {
      throw new ErrorHandler(
        "This checkout can no longer be used. Start a new one.",
        409,
        "CHECKOUT_EXPIRED"
      );
    }
    return {
      payment: existing,
      authorizationUrl: existing.authorizationUrl,
      reference: existing.reference,
      reused: true,
    };
  };

  const existing = await PaymentModel.findOne({ idempotencyKey });
  if (existing) return reuse(existing);

  let payment: IPayment;
  try {
    payment = await PaymentModel.create({
      userId,
      purpose: params.purpose,
      campaignId: params.campaignId,
      amount: pricing.amount,
      currency: pricing.currency,
      durationDays: pricing.durationDays,
      reference,
      idempotencyKey,
      status: "pending",
    });
  } catch (e: any) {
    if (e.code === 11000) {
      const winner = await PaymentModel.findOne({ idempotencyKey });
      if (winner) return reuse(winner);
    }
    throw e;
  }

  try {
    const init = await paystackService.initialize({
      email: params.user.email,
      amount: pricing.amount,
      currency: pricing.currency,
      reference,
      callbackUrl: `${FRONTEND_URL}/payment/verify?reference=${reference}`,
      metadata: {
        paymentId: String(payment._id),
        purpose: params.purpose,
        userId,
        ...(params.campaignId ? { campaignId: params.campaignId } : {}),
      },
    });
    payment.authorizationUrl = init.authorizationUrl;
    await payment.save();
    return { payment, authorizationUrl: init.authorizationUrl, reference, reused: false };
  } catch (e: any) {
    payment.status = "failed";
    payment.failureReason = e.message;
    await payment.save();
    throw new ErrorHandler("Could not start checkout. Please try again.", 502, "CHECKOUT_FAILED");
  }
}

export interface GatewayConfirmation {
  amount: number; // major units, as reported by the gateway
  currency: string;
  paidAt?: Date;
  raw?: any;
}

async function fulfil(payment: IPayment): Promise<void> {
  if (payment.purpose === "pro") {
    await applyProPayment(payment);
  } else {
    await activateCampaignFromPayment(payment);
  }
  await PaymentModel.updateOne(
    { _id: payment._id, fulfilledAt: { $exists: false } },
    { $set: { fulfilledAt: new Date() } }
  );
}

/**
 * Records a gateway-confirmed payment and applies the purchase exactly once.
 * Called by both the webhook and the verify endpoint, in any order, any number of times:
 *  - the pending -> success flip is a single atomic update, so only one caller "wins";
 *  - fulfilment itself is idempotent (unique ProSubscription.paymentId, status-guarded
 *    campaign activation), which also covers a crash between the flip and fulfilment.
 * The amount and currency the gateway reports must match what we asked for.
 */
export async function confirmPayment(
  reference: string,
  gateway: GatewayConfirmation
): Promise<IPayment | null> {
  const payment = await PaymentModel.findOne({ reference });
  if (!payment) return null;

  if (payment.status !== "success") {
    const amountMatches = Math.abs(gateway.amount - payment.amount) < 0.005;
    const currencyMatches =
      String(gateway.currency || "").toUpperCase() === payment.currency.toUpperCase();
    if (!amountMatches || !currencyMatches) {
      await PaymentModel.updateOne(
        { _id: payment._id, status: { $ne: "success" } },
        { $set: { status: "failed", failureReason: "amount_mismatch", gatewayResponse: gateway.raw } }
      );
      return PaymentModel.findById(payment._id);
    }

    await PaymentModel.updateOne(
      { _id: payment._id, status: { $in: ["pending", "failed"] } },
      {
        $set: {
          status: "success",
          paidAt: gateway.paidAt || new Date(),
          gatewayResponse: gateway.raw,
        },
        $unset: { failureReason: "" },
      }
    );
  }

  const current = await PaymentModel.findById(payment._id);
  if (current && current.status === "success" && !current.fulfilledAt) {
    await fulfil(current);
    return PaymentModel.findById(payment._id);
  }
  return current;
}

/** Marks a pending payment failed after the gateway reports a terminal failure. */
export async function markPaymentFailed(reference: string, reason: string, raw?: any) {
  await PaymentModel.updateOne(
    { reference, status: "pending" },
    { $set: { status: "failed", failureReason: reason, gatewayResponse: raw } }
  );
}

/** Server-side verification against the gateway for a reference the caller owns. */
export async function verifyAndConfirm(payment: IPayment): Promise<IPayment> {
  if (payment.status === "success" && payment.fulfilledAt) return payment;

  const result = await paystackService.verify(payment.reference);
  if (result.status === "success") {
    const confirmed = await confirmPayment(payment.reference, {
      amount: result.amount,
      currency: result.currency,
      paidAt: result.paidAt,
      raw: result.rawResponse,
    });
    return confirmed || payment;
  }
  if (result.status === "failed") {
    await markPaymentFailed(payment.reference, "gateway_declined", result.rawResponse);
  }
  return (await PaymentModel.findById(payment._id)) || payment;
}
