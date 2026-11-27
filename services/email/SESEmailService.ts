import { SendEmailCommand } from "@aws-sdk/client-ses";
import ejs from "ejs";
import path from "path";
import { getSESClient } from "../../aws/awsClients";
import { IEmailService, EmailOptions } from "./IEmailService";

export class SESEmailService implements IEmailService {
  private fromEmail = process.env.AWS_SES_FROM_EMAIL!;

  async sendMail(options: EmailOptions): Promise<void> {
    const { email, subject, template, data } = options;

    const templatePath = path.join(__dirname, "../../mails", template);
    const html: string = await ejs.renderFile(templatePath, data);

    await getSESClient().send(
      new SendEmailCommand({
        Source: this.fromEmail,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Html: { Data: html, Charset: "UTF-8" } },
        },
      })
    );
  }
}
