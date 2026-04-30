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

export class PaystackService {
  async initialize(params: PaymentInitializeParams): Promise<PaymentInitializeResponse> {
    try {
      const response = await axios.post(
        `${PAYSTACK_BASE_URL}/transaction/initialize`,
        {
          email: params.email,
          amount: params.amount * 100, // Convert to kobo
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
        `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          },
        }
      );

      const data = response.data as any;
      const paymentData = data.data;

      return {
        success: paymentData.status === "success",
        status: paymentData.status === "success" ? "success" : "failed",
        reference,
        amount: paymentData.amount / 100, // Convert from kobo to naira
        rawResponse: paymentData,
      };
    } catch (error: any) {
      throw new Error(`Paystack verification failed: ${error.message}`);
    }
  }

  validateWebhook(headers: any, body: any): WebhookValidationResult {
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(body))
      .digest("hex");

    if (hash !== headers["x-paystack-signature"]) {
      return { isValid: false };
    }

    return {
      isValid: true,
      event: body.event,
      data: body.data,
    };
  }
}

export const paystackService = new PaystackService();
