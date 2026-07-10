import axios from "axios";
import crypto from "crypto";
import {
  ITransferService,
  ResolvedAccount,
  CreateRecipientParams,
  CreateRecipientResult,
  InitiateTransferParams,
  InitiateTransferResult,
  VerifyTransferResult,
  WebhookValidationResult,
} from "./ITransferService";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_BASE_URL = "https://api.paystack.co";

/**
 * Paystack Transfers integration for player withdrawals — the charge side
 * (services/payment/paystack.service.ts) already existed; this is the payout
 * side, following the same plain-axios style.
 */
export class PaystackTransferService implements ITransferService {
  isEnabled(): boolean {
    return !!PAYSTACK_SECRET_KEY;
  }

  async resolveAccount(
    accountNumber: string,
    bankCode: string
  ): Promise<ResolvedAccount> {
    try {
      const response = await axios.get(
        `${PAYSTACK_BASE_URL}/bank/resolve`,
        {
          params: { account_number: accountNumber, bank_code: bankCode },
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
        }
      );
      const data = (response.data as any).data;
      return {
        accountNumber: data.account_number,
        accountName: data.account_name,
        bankCode,
      };
    } catch (error: any) {
      const message = error.response?.data?.message || error.message;
      throw new Error(`Account resolution failed: ${message}`);
    }
  }

  async createRecipient(
    params: CreateRecipientParams
  ): Promise<CreateRecipientResult> {
    try {
      const response = await axios.post(
        `${PAYSTACK_BASE_URL}/transferrecipient`,
        {
          type: "nuban",
          name: params.accountName,
          account_number: params.accountNumber,
          bank_code: params.bankCode,
          currency: "NGN",
        },
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      const data = (response.data as any).data;
      return { recipientCode: data.recipient_code };
    } catch (error: any) {
      const message = error.response?.data?.message || error.message;
      throw new Error(`Recipient creation failed: ${message}`);
    }
  }

  async initiateTransfer(
    params: InitiateTransferParams
  ): Promise<InitiateTransferResult> {
    try {
      const response = await axios.post(
        `${PAYSTACK_BASE_URL}/transfer`,
        {
          source: "balance",
          amount: Math.round(params.amount * 100), // NGN -> kobo
          recipient: params.recipientCode,
          reference: params.reference,
          reason: params.reason || "Pazzell weekly reward withdrawal",
        },
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      const data = (response.data as any).data;
      return {
        transferCode: data.transfer_code,
        reference: params.reference,
        status: data.status,
      };
    } catch (error: any) {
      const message = error.response?.data?.message || error.message;
      throw new Error(`Transfer initiation failed: ${message}`);
    }
  }

  async verifyTransfer(reference: string): Promise<VerifyTransferResult> {
    try {
      const response = await axios.get(
        `${PAYSTACK_BASE_URL}/transfer/verify/${reference}`,
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
      );
      const data = (response.data as any).data;
      return {
        status: data.status,
        reference,
        rawResponse: data,
      };
    } catch (error: any) {
      throw new Error(`Transfer verification failed: ${error.message}`);
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
    return { isValid: true, event: body.event, data: body.data };
  }
}
