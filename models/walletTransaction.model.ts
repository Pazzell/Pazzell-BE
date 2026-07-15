import mongoose, { Document, Model, Schema } from "mongoose";

export type WalletTransactionType = "credit" | "debit";
export type WalletTransactionReason =
  | "weekly_payout"
  | "withdrawal"
  | "withdrawal_reversal"
  | "admin_adjustment";

export interface IWalletTransaction extends Document {
  userId: string;
  type: WalletTransactionType;
  amount: number; // always positive; `type` conveys direction
  balanceAfter: number;
  reason: WalletTransactionReason;
  referenceId?: string; // e.g. Payout _id, Withdrawal _id
  idempotencyKey: string;
  status: "completed" | "reversed";
}

const walletTransactionSchema: Schema<IWalletTransaction> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: ["credit", "debit"], required: true },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true },
    reason: {
      type: String,
      enum: ["weekly_payout", "withdrawal", "withdrawal_reversal", "admin_adjustment"],
      required: true,
    },
    referenceId: { type: String },
    idempotencyKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ["completed", "reversed"], default: "completed" },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ userId: 1, createdAt: -1 });

const WalletTransactionModel: Model<IWalletTransaction> = mongoose.model(
  "WalletTransaction",
  walletTransactionSchema
);
export default WalletTransactionModel;
