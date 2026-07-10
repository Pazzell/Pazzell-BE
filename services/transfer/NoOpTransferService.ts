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

// Fallback when no transfer provider is configured (e.g. local dev/test without
// a Paystack key) — mirrors NoOpNotificationService/InMemoryPaymentQueue's role.
export class NoOpTransferService implements ITransferService {
  isEnabled(): boolean {
    return false;
  }

  async resolveAccount(): Promise<ResolvedAccount> {
    throw new Error("No transfer provider configured");
  }

  async createRecipient(): Promise<CreateRecipientResult> {
    throw new Error("No transfer provider configured");
  }

  async initiateTransfer(): Promise<InitiateTransferResult> {
    throw new Error("No transfer provider configured");
  }

  async verifyTransfer(): Promise<VerifyTransferResult> {
    throw new Error("No transfer provider configured");
  }

  validateWebhook(): WebhookValidationResult {
    return { isValid: false };
  }
}
