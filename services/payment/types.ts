// Payment types and interfaces (Paystack only)

export interface PaymentInitializeParams {
  email: string;
  amount: number; // Amount in Naira
  reference: string;
  currency: string;
  callbackUrl: string;
  metadata: {
    campaignId: string;
    brandId: string;
    packageType: string;
    transactionId: string;
  };
}

export interface PaymentInitializeResponse {
  success: boolean;
  authorizationUrl: string;
  accessCode?: string;
  reference: string;
  rawResponse?: any;
}

export interface PaymentVerifyResponse {
  success: boolean;
  status: "success" | "failed" | "pending";
  reference: string;
  amount: number;
  rawResponse?: any;
}

export interface WebhookValidationResult {
  isValid: boolean;
  event?: string;
  data?: any;
}
