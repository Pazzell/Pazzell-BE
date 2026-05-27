export interface PaymentJobPayload {
  reference: string;
  transactionId: string;
  campaignId: string;
  brandId: string;
  amount: number;
  currency: string;
  event: "payment.verified" | "payment.failed" | "webhook.received";
  rawPaystackData?: any;
  timestamp: string;
}

export interface IPaymentQueue {
  enqueue(payload: PaymentJobPayload): Promise<{ success: boolean; messageId?: string }>;
  dequeue(
    maxMessages: number,
    handler: (payload: PaymentJobPayload) => Promise<void>
  ): Promise<void>;
  isEnabled(): boolean;
}
