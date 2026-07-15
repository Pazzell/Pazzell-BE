export interface ResolvedAccount {
  accountNumber: string;
  accountName: string;
  bankCode: string;
}

export interface CreateRecipientParams {
  accountNumber: string;
  bankCode: string;
  accountName: string;
}

export interface CreateRecipientResult {
  recipientCode: string;
}

export interface InitiateTransferParams {
  amount: number; // NGN
  recipientCode: string;
  reference: string;
  reason?: string;
}

export interface InitiateTransferResult {
  transferCode: string;
  reference: string;
  status: string;
}

export interface VerifyTransferResult {
  status: "success" | "failed" | "pending" | "otp" | "reversed";
  reference: string;
  rawResponse: any;
}

export interface WebhookValidationResult {
  isValid: boolean;
  event?: string;
  data?: any;
}

export interface ITransferService {
  resolveAccount(accountNumber: string, bankCode: string): Promise<ResolvedAccount>;
  createRecipient(params: CreateRecipientParams): Promise<CreateRecipientResult>;
  initiateTransfer(params: InitiateTransferParams): Promise<InitiateTransferResult>;
  verifyTransfer(reference: string): Promise<VerifyTransferResult>;
  validateWebhook(headers: any, body: any): WebhookValidationResult;
  isEnabled(): boolean;
}
