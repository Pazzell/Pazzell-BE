import { IEmailService } from "./IEmailService";
import { LegacyEmailService } from "./LegacyEmailService";
import { SESEmailService } from "./SESEmailService";

let _instance: IEmailService | null = null;

export const getEmailService = (): IEmailService => {
  if (_instance) return _instance;
  const provider = (process.env.EMAIL_PROVIDER ?? "gmail").toLowerCase();
  _instance =
    provider === "aws" ? new SESEmailService() : new LegacyEmailService();
  return _instance;
};
