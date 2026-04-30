import mongoose, { Document, Schema } from "mongoose";

export interface IDailyPrizePool extends Document {
  date: string; // Format: "2025-01-15"
  activeCampaigns: Array<{
    campaignId: string;
    packageType: "basic" | "premium";
    dailyAllocation: number;
  }>;
  totalDailyPool: number;
  gamerShare: number; // 70%
  platformFee: number; // 30%
  status: "active" | "completed";
  createdAt: Date;
  updatedAt: Date;
}

const dailyPrizePoolSchema: Schema<IDailyPrizePool> = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, index: true },
    activeCampaigns: [
      {
        campaignId: { type: String, required: true },
        packageType: { type: String, enum: ["basic", "premium"], required: true },
        dailyAllocation: { type: Number, required: true },
      },
    ],
    totalDailyPool: { type: Number, required: true },
    gamerShare: { type: Number, required: true },
    platformFee: { type: Number, required: true },
    status: { type: String, enum: ["active", "completed"], default: "active" },
  },
  { timestamps: true }
);

const DailyPrizePoolModel = mongoose.model<IDailyPrizePool>("DailyPrizePool", dailyPrizePoolSchema);
export default DailyPrizePoolModel;
