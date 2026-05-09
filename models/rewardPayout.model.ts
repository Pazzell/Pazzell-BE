import mongoose, { Document, Model, Schema } from "mongoose";

export interface IRewardPayout extends Document {
  userId: string;
  monthKey: string; // e.g., "2026-04"
  type: "points" | "referral" | "raffle";
  position?: number; // 1-10 for leaderboard
  amount: number;
  currency: string;
  status: "pending" | "processed" | "paid" | "failed";
  processedAt?: Date;
}

const rewardPayoutSchema: Schema<IRewardPayout> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    monthKey: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ["points", "referral", "raffle"],
      required: true,
    },
    position: { type: Number },
    amount: { type: Number, required: true },
    currency: { type: String, default: "NGN" },
    status: {
      type: String,
      enum: ["pending", "processed", "paid", "failed"],
      default: "pending",
    },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

rewardPayoutSchema.index({ userId: 1, monthKey: 1, type: 1 });

const RewardPayoutModel: Model<IRewardPayout> = mongoose.model(
  "RewardPayout",
  rewardPayoutSchema
);
export default RewardPayoutModel;
