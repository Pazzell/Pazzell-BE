import axios from "axios";
import crypto from "crypto";
import {
  PaymentInitializeParams,
  PaymentInitializeResponse,
  PaymentVerifyResponse,
  WebhookValidationResult,
} from "./types";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_BASE_URL = "https://api.paystack.co";

const TERMINAL_FAILURES = ["failed", "abandoned", "reversed"];

/** Paystack amounts are in the currency's minor unit (kobo, cents). */
export const toMinorUnits = (amount: number): number => Math.round(amount * 100);
export const fromMinorUnits = (amount: number): number => amount / 100;

export const parseGatewayDate = (value: any): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export class PaystackService {
  isConfigured(): boolean {
    return !!PAYSTACK_SECRET_KEY;
  }

  async initialize(params: PaymentInitializeParams): Promise<PaymentInitializeResponse> {
    try {
      const response = await axios.post(
        `${PAYSTACK_BASE_URL}/transaction/initialize`,
        {
          email: params.email,
          amount: toMinorUnits(params.amount),
          reference: params.reference,
          currency: params.currency,
          callback_url: params.callbackUrl,
          metadata: params.metadata,
        },
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const data = response.data as any;

      return {
        success: true,
        authorizationUrl: data.data.authorization_url,
        accessCode: data.data.access_code,
        reference: params.reference,
        rawResponse: data,
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      console.error("Paystack Error:", error.response?.data || error.message);
      throw new Error(`Paystack initialization failed: ${errorMessage}`);
    }
  }

  async verify(reference: string): Promise<PaymentVerifyResponse> {
    try {
      const response = await axios.get(
        `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          },
        }
      );

      const data = response.data as any;
      const paymentData = data.data;
      const success = paymentData.status === "success";

      return {
        success,
        status: success
          ? "success"
          : TERMINAL_FAILURES.includes(paymentData.status)
            ? "failed"
            : "pending",
        reference,
        amount: fromMinorUnits(paymentData.amount),
        currency: String(paymentData.currency || "").toUpperCase(),
        paidAt: parseGatewayDate(paymentData.paid_at || paymentData.paidAt),
        rawResponse: paymentData,
      };
    } catch (error: any) {
      throw new Error(`Paystack verification failed: ${error.message}`);
    }
  }

  /**
   * Verifies the x-paystack-signature header (HMAC-SHA512 of the request body with the
   * secret key). `rawBody` is the exact bytes Paystack sent (captured in app.ts); the
   * re-serialised JSON is only a fallback for callers that do not have it.
   */
  validateWebhook(headers: any, body: any, rawBody?: Buffer): WebhookValidationResult {
    const signature = headers["x-paystack-signature"];
    if (!PAYSTACK_SECRET_KEY || typeof signature !== "string") {
      return { isValid: false };
    }

    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY)
      .update(rawBody ?? JSON.stringify(body))
      .digest("hex");

    const expected = Buffer.from(hash, "utf8");
    const received = Buffer.from(signature, "utf8");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return { isValid: false };
    }

    return {
      isValid: true,
      event: body?.event,
      data: body?.data,
    };
  }
}

export const paystackService = new PaystackService();
