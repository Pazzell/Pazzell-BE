import { IPaymentQueue } from "./IPaymentQueue";
import { InMemoryPaymentQueue } from "./InMemoryPaymentQueue";
import { SQSPaymentQueue } from "./SQSPaymentQueue";

let _instance: IPaymentQueue | null = null;

export const getPaymentQueue = (): IPaymentQueue => {
  if (_instance) return _instance;
  const provider = (process.env.PAYMENT_QUEUE_PROVIDER ?? "none").toLowerCase();
  _instance =
    provider === "aws" ? new SQSPaymentQueue() : new InMemoryPaymentQueue();
  return _instance;
};
