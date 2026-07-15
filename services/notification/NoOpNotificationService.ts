import { INotificationService, NotificationPayload } from "./INotificationService";

// Silent no-op fallback — preserves existing behaviour when SNS is not configured.
export class NoOpNotificationService implements INotificationService {
  isEnabled(): boolean {
    return false;
  }

  async publish(_payload: NotificationPayload): Promise<void> {
    // no-op
  }
}
