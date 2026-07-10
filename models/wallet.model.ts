import mongoose, { Document, Model, Schema } from "mongoose";

export interface IWallet extends Document {
  userId: string;
  balance: number; // cached/derived — always kept equal to the sum of WalletTransaction ledger rows for this user
  currency: string;
}

const walletSchema: Schema<IWallet> = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    balance: { type: Number, required: true, default: 0 },
    currency: { type: String, default: "NGN" },
  },
  { timestamps: true }
);

const WalletModel: Model<IWallet> = mongoose.model("Wallet", walletSchema);
export default WalletModel;
