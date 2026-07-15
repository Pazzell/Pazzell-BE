export interface NotificationPayload {
  subject: string;
  message: string;
  topicKey: "payment" | "campaign" | "general";
  metadata?: Record<string, string>;
}

export interface INotificationService {
  publish(payload: NotificationPayload): Promise<void>;
  isEnabled(): boolean;
}
