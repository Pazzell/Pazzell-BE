import mongoose, { Document, Model, Schema } from "mongoose";

export type WithdrawalStatus = "pending" | "processing" | "paid" | "failed";

export interface IWithdrawal extends Document {
  userId: string;
  bankAccountId: string;
  amount: number;
  currency: string;
  status: WithdrawalStatus;
  idempotencyKey: string;
  paystackTransferCode?: string;
  paystackTransferReference?: string;
  failureReason?: string;
}

const withdrawalSchema: Schema<IWithdrawal> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    bankAccountId: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "NGN" },
    status: {
      type: String,
      enum: ["pending", "processing", "paid", "failed"],
      default: "pending",
      index: true,
    },
    idempotencyKey: { type: String, required: true, unique: true },
    paystackTransferCode: { type: String },
    paystackTransferReference: { type: String },
    failureReason: { type: String },
  },
  { timestamps: true }
);

withdrawalSchema.index({ userId: 1, createdAt: -1 });

const WithdrawalModel: Model<IWithdrawal> = mongoose.model(
  "Withdrawal",
  withdrawalSchema
);
export default WithdrawalModel;
