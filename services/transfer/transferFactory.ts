import { ITransferService } from "./ITransferService";
import { PaystackTransferService } from "./PaystackTransferService";
import { NoOpTransferService } from "./NoOpTransferService";

let _instance: ITransferService | null = null;

export const getTransferService = (): ITransferService => {
  if (_instance) return _instance;
  const provider = (process.env.TRANSFER_PROVIDER ?? "paystack").toLowerCase();
  _instance =
    provider === "paystack" && process.env.PAYSTACK_SECRET_KEY
      ? new PaystackTransferService()
      : new NoOpTransferService();
  return _instance;
};
