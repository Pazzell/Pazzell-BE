import mongoose, { Document, Schema } from "mongoose";

export interface ITransaction extends Document {
  campaignId: string;
  brandId: string;
  packageType: "basic" | "premium";
  amount: number;
  currency: string;
  reference: string;
  status: "pending" | "success" | "failed";
  paystackResponse?: any;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema: Schema<ITransaction> = new mongoose.Schema(
  {
    campaignId: { type: String, required: true, index: true },
    brandId: { type: String, required: true, index: true },
    packageType: { type: String, enum: ["basic", "premium"], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "NGN" },
    reference: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ["pending", "success", "failed"], default: "pending" },
    paystackResponse: { type: Schema.Types.Mixed },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

const TransactionModel = mongoose.model<ITransaction>("Transaction", transactionSchema);
export default TransactionModel;
