import sendMail from "../../utils/sendEmail";
import { IEmailService, EmailOptions } from "./IEmailService";

export class LegacyEmailService implements IEmailService {
  async sendMail(options: EmailOptions): Promise<void> {
    await sendMail(options);
  }
}
