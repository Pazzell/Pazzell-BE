import mongoose from "mongoose";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";
import GameSessionModel from "../models/gameSession.model";

// Sessions are meant to be played in one sitting (4 games + video + quiz).
// Anything still "in_progress" this long after it started was walked away
// from, not just slow.
const ABANDONED_SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

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

// Mark stale in_progress sessions as abandoned. They're already excluded
// from live stats (which only count status:"completed"), but without this
// they'd linger as "in_progress" forever, and completeSession() rejects
// abandoned sessions the same way it does voided ones — so a player who
// walks away and comes back after the TTL gets a clean "start over" instead
// of silently resuming a stale session.
export const checkAbandonedSessions = async () => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return;
    }

    const cutoff = new Date(Date.now() - ABANDONED_SESSION_TTL_MS);

    const result = await GameSessionModel.updateMany(
      {
        status: "in_progress",
        startedAt: { $lt: cutoff },
      },
      {
        $set: { status: "abandoned" },
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Marked ${result.modifiedCount} session(s) as abandoned`);
    }
  } catch (error) {
    console.error("Error checking abandoned sessions:", error);
  }
};
