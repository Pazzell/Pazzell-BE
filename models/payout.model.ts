import mongoose, { Document, Schema } from "mongoose";

export interface IPayout extends Document {
  userId: string;
  weekKey: string; // Format: "2025-01-06_to_2025-01-12"
  position: number; // 1-10
  points: number;
  puzzlesSolved: number;
  // NOTE: field names below predate the weekly-revenue-based prize pool
  // (they were populated from a daily-drip campaign-budget mechanism under
  // the old hours/month duration model) — kept for backward compatibility,
  // now populated from services/prizePool.service.ts's direct weekly
  // Transaction-revenue sum instead. `weeklyRevenue` is the same value under
  // its accurate name.
  totalDailyPool: number; // = weeklyRevenue
  gamerShare: number; // = playerPool (weeklyRevenue * playerSharePercent/100)
  weeklyRevenue?: number;
  distributionPercentage: number; // this rank's % of the player pool (config-driven, e.g. 20/15/10/7.875...)
  amount: number; // Final amount earned
  currency: string;
  status: "pending" | "processed" | "paid" | "failed";
  paymentReference?: string;
  processedAt?: Date;
  // Config values snapshotted at calculation time (for audit even if Config
  // changes later — see services/config/config.service.ts payout.*SharePercent)
  playerSharePercent?: number;
  platformSharePercent?: number;
  walletTransactionId?: string;
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
    weeklyRevenue: { type: Number },
    distributionPercentage: { type: Number, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "NGN" },
    status: { type: String, enum: ["pending", "processed", "paid", "failed"], default: "pending" },
    paymentReference: { type: String },
    processedAt: { type: Date },
    playerSharePercent: { type: Number },
    platformSharePercent: { type: Number },
    walletTransactionId: { type: String },
  },
  { timestamps: true }
);

// Compound index for unique user per week
payoutSchema.index({ userId: 1, weekKey: 1 }, { unique: true });

const PayoutModel = mongoose.model<IPayout>("Payout", payoutSchema);
export default PayoutModel;
