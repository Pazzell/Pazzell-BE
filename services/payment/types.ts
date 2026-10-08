// Payment types and interfaces (Paystack only)

export interface PaymentInitializeParams {
  email: string;
  amount: number; // major units of `currency` (converted to minor units for the gateway)
  reference: string;
  currency: string;
  callbackUrl: string;
  metadata: Record<string, any>;
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
  // "failed" is terminal (failed / abandoned / reversed); "pending" may still succeed
  status: "success" | "failed" | "pending";
  reference: string;
  amount: number; // major units
  currency: string;
  paidAt?: Date;
  rawResponse?: any;
}

export interface WebhookValidationResult {
  isValid: boolean;
  event?: string;
  data?: any;
}
