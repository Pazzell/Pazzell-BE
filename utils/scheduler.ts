import mongoose from "mongoose";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";

// Check and mark expired campaigns as ended. Scheduled hourly via
// services/scheduler/index.ts (node-cron) — this file just holds the check
// itself, reused by both the cron job and campaign.controller.ts's
// pre-read expiry sweep.
export const checkExpiredCampaigns = async () => {
  try {
    // Skip if database is not connected
    if (mongoose.connection.readyState !== 1) {
      return;
    }

    const now = new Date();

    // Find all active campaigns that have passed their end date
    // Only auto-end campaigns that have been paid for
    const result = await PuzzleCampaignModel.updateMany(
      {
        status: "active",
        paymentStatus: "paid", // Only end paid campaigns
        endDate: { $lt: now },
      },
      {
        $set: { status: "ended" },
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Marked ${result.modifiedCount} campaign(s) as ended`);
    }
  } catch (error) {
    console.error("Error checking expired campaigns:", error);
  }
};
