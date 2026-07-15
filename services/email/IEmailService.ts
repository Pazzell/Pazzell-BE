export interface EmailOptions {
  email: string;
  subject: string;
  template: string;
  data: Record<string, any>;
}

export interface IEmailService {
  sendMail(options: EmailOptions): Promise<void>;
}
