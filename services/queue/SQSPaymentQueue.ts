import {
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { getSQSClient } from "../../aws/awsClients";
import { IPaymentQueue, PaymentJobPayload } from "./IPaymentQueue";

export class SQSPaymentQueue implements IPaymentQueue {
  private queueUrl = process.env.AWS_SQS_PAYMENT_QUEUE_URL!;

  isEnabled(): boolean {
    return true;
  }

  async enqueue(
    payload: PaymentJobPayload
  ): Promise<{ success: boolean; messageId?: string }> {
    try {
      const result = await getSQSClient().send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(payload),
          MessageGroupId: payload.campaignId, // for FIFO; ignored by Standard queues
        })
      );
      return { success: true, messageId: result.MessageId };
    } catch (err) {
      console.error("SQS enqueue error:", err);
      return { success: false };
    }
  }

  async dequeue(
    maxMessages: number,
    handler: (payload: PaymentJobPayload) => Promise<void>
  ): Promise<void> {
    const result = await getSQSClient().send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: Math.min(maxMessages, 10),
        WaitTimeSeconds: 5,
      })
    );

    if (!result.Messages) return;

    for (const msg of result.Messages) {
      if (!msg.Body || !msg.ReceiptHandle) continue;
      try {
        const payload = JSON.parse(msg.Body) as PaymentJobPayload;
        await handler(payload);
        await getSQSClient().send(
          new DeleteMessageCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle: msg.ReceiptHandle,
          })
        );
      } catch (err) {
        console.error("SQS message processing error:", err);
      }
    }
  }
}
