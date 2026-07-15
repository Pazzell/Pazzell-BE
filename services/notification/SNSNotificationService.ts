import { PublishCommand } from "@aws-sdk/client-sns";
import { getSNSClient } from "../../aws/awsClients";
import { INotificationService, NotificationPayload } from "./INotificationService";

// Maps topicKey to environment variable holding the SNS Topic ARN
const TOPIC_ARN_MAP: Record<string, string | undefined> = {
  payment: process.env.AWS_SNS_PAYMENT_TOPIC_ARN,
  campaign: process.env.AWS_SNS_CAMPAIGN_TOPIC_ARN,
  general: process.env.AWS_SNS_PAYMENT_TOPIC_ARN, // fallback to payment topic
};

export class SNSNotificationService implements INotificationService {
  isEnabled(): boolean {
    return true;
  }

  async publish(payload: NotificationPayload): Promise<void> {
    const topicArn = TOPIC_ARN_MAP[payload.topicKey];
    if (!topicArn) {
      console.warn(`SNS topic ARN not configured for key: ${payload.topicKey}`);
      return;
    }

    const messageAttributes: Record<string, any> = {};
    if (payload.metadata) {
      for (const [k, v] of Object.entries(payload.metadata)) {
        messageAttributes[k] = { DataType: "String", StringValue: v };
      }
    }

    await getSNSClient().send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: payload.subject,
        Message: payload.message,
        MessageAttributes: messageAttributes,
      })
    );
  }
}
