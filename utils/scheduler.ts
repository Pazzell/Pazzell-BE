import mongoose from "mongoose";
import LeaderboardModel from "../models/leaderboard.model";
import PuzzleAttemptModel from "../models/puzzleAttempt.model";
import UserModel from "../models/user.model";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";

// Weekly leaderboard scheduler
export const startScheduler = () => {
  // Run once per day at midnight to check if we need to finalize the weekly leaderboard
  const dailyCheckInterval = 24 * 60 * 60 * 1000; // 24 hours
  const hourlyCheckInterval = 60 * 60 * 1000; // 1 hour

  // Daily scheduler for weekly leaderboard
  setInterval(async () => {
    try {
      // Skip if database is not connected
      if (mongoose.connection.readyState !== 1) {
        return;
      }

      const now = new Date();

      // Monthly finalization: if today is the last day of the month, finalize the previous month
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      if (tomorrow.getDate() === 1) {
        // it's the last day of the month
        // finalize previous month key (current month)
        const monthKey = `${now.getFullYear()}-${String(
          now.getMonth() + 1
        ).padStart(2, "0")}`;
        try {
          // dynamic import must include .js extension under `module: node16` resolution
          // TypeScript will resolve the `.ts` file at compile time and emit a runtime import to `.js`.
          const { finalizeMonthlyRewards } = await import(
            "../services/rewards.service.js"
          );
          const result = await finalizeMonthlyRewards(monthKey);
          console.log(`Monthly rewards finalized for ${monthKey}:`, result);
        } catch (err) {
          console.error("Monthly finalization error:", err);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Scheduler error:", err);
    }
  }, dailyCheckInterval);

  // Hourly scheduler for checking expired campaigns
  setInterval(async () => {
    try {
      await checkExpiredCampaigns();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Campaign expiry check error:", err);
    }
  }, hourlyCheckInterval);

  // Run expired campaign check immediately on startup
  checkExpiredCampaigns();
};

// Check and mark expired campaigns as ended
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
