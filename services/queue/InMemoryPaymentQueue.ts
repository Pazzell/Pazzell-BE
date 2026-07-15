import { IPaymentQueue, PaymentJobPayload } from "./IPaymentQueue";

// No-op fallback: preserves existing synchronous payment flow unchanged.
export class InMemoryPaymentQueue implements IPaymentQueue {
  isEnabled(): boolean {
    return false;
  }

  async enqueue(_payload: PaymentJobPayload): Promise<{ success: boolean }> {
    return { success: true };
  }

  async dequeue(
    _maxMessages: number,
    _handler: (payload: PaymentJobPayload) => Promise<void>
  ): Promise<void> {
    // no-op
  }
}
