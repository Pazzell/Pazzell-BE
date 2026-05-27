import { INotificationService } from "./INotificationService";
import { NoOpNotificationService } from "./NoOpNotificationService";
import { SNSNotificationService } from "./SNSNotificationService";

let _instance: INotificationService | null = null;

export const getNotificationService = (): INotificationService => {
  if (_instance) return _instance;
  const provider = (process.env.NOTIFICATION_PROVIDER ?? "none").toLowerCase();
  _instance =
    provider === "aws"
      ? new SNSNotificationService()
      : new NoOpNotificationService();
  return _instance;
};
