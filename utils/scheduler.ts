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

      // Check if it's Sunday (end of week)
      if (now.getDay() === 0) {
        // Calculate the week's date range (Monday to Sunday)
        const weekEnd = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        );
        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekStart.getDate() - 6); // Go back 6 days to Monday

        // Get all first-time solved attempts from this week
        const weeklyAttempts = await PuzzleAttemptModel.aggregate([
          {
            $match: {
              firstTimeSolved: true,
              timestamp: { $gte: weekStart, $lt: weekEnd },
            },
          },
          {
            $group: {
              _id: "$userId",
              puzzlesSolved: { $sum: 1 },
              points: { $sum: "$pointsEarned" },
            },
          },
          { $sort: { puzzlesSolved: -1, points: -1 } },
          { $limit: 100 },
        ]);

        const entries = weeklyAttempts.map((a: any) => ({
          userId: a._id,
          puzzlesSolved: a.puzzlesSolved,
          points: a.points,
        }));

        // Create weekly leaderboard
        const weekKey = `${weekStart.toISOString().slice(0, 10)}_to_${weekEnd.toISOString().slice(0, 10)}`;
        await LeaderboardModel.findOneAndUpdate(
          { type: "weekly", date: weekKey },
          { type: "weekly", date: weekKey, entries },
          { upsert: true }
        );

        console.log(`Created weekly leaderboard for week: ${weekKey}`);
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
        paymentStatus: "paid",  // Only end paid campaigns
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
