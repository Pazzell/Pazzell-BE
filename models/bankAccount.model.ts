import mongoose, { Document, Model, Schema } from "mongoose";

export interface IBankAccount extends Document {
  userId: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string; // resolved from Paystack's bank-resolve API, not user-entered
  recipientCode?: string; // Paystack transfer-recipient code, created lazily on first withdrawal
  verified: boolean;
  isDefault: boolean;
}

const bankAccountSchema: Schema<IBankAccount> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    bankCode: { type: String, required: true },
    bankName: { type: String, required: true },
    accountNumber: { type: String, required: true },
    accountName: { type: String, required: true },
    recipientCode: { type: String },
    verified: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

bankAccountSchema.index({ userId: 1, bankCode: 1, accountNumber: 1 }, { unique: true });

const BankAccountModel: Model<IBankAccount> = mongoose.model(
  "BankAccount",
  bankAccountSchema
);
export default BankAccountModel;
