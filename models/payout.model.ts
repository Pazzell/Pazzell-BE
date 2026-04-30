import mongoose, { Document, Schema } from "mongoose";

export interface IPayout extends Document {
  userId: string;
  weekKey: string; // Format: "2025-01-06_to_2025-01-12"
  position: number; // 1-10
  points: number;
  puzzlesSolved: number;
  totalDailyPool: number; // Total pool for the week
  gamerShare: number; // 70% of total pool
  distributionPercentage: number; // 20%, 15%, 10%, or 7.875%
  amount: number; // Final amount earned
  currency: string;
  status: "pending" | "processed" | "paid" | "failed";
  paymentReference?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const payoutSchema: Schema<IPayout> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    position: { type: Number, required: true, min: 1, max: 10 },
    points: { type: Number, required: true },
    puzzlesSolved: { type: Number, required: true },
    totalDailyPool: { type: Number, required: true },
    gamerShare: { type: Number, required: true },
    distributionPercentage: { type: Number, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "NGN" },
    status: { type: String, enum: ["pending", "processed", "paid", "failed"], default: "pending" },
    paymentReference: { type: String },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

// Compound index for unique user per week
payoutSchema.index({ userId: 1, weekKey: 1 }, { unique: true });

const PayoutModel = mongoose.model<IPayout>("Payout", payoutSchema);
export default PayoutModel;
