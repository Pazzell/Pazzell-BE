import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PuzzleAttemptModel from "../models/puzzleAttempt.model";
import UserModel from "../models/user.model";
import { getWeekBounds, parseWeekKey } from "../utils/weekBoundary";
import {
  getUnifiedWeeklyEntries,
  getHiddenUserIds,
} from "../services/leaderboard.service";

async function buildWeeklyResponseEntries(
  weekStart: Date,
  weekEnd: Date,
  weekKey: string
) {
  const entries = await getUnifiedWeeklyEntries(weekStart, weekEnd, weekKey);
  const hiddenIds = await getHiddenUserIds();
  const visible = entries.filter((e) => !hiddenIds.has(String(e.userId))).slice(0, 100);

  return Promise.all(
    visible.map(async (entry, index) => {
      const user = await UserModel.findById(entry.userId)
        .select("firstName lastName username avatar")
        .lean();

      return {
        position: index + 1,
        userId: entry.userId,
        fullName: user ? `${user.firstName} ${user.lastName}` : "Unknown User",
        username: user?.username || "",
        avatar: user?.avatar || "",
        puzzlesSolved: entry.puzzlesSolved,
        points: entry.points,
        avgCompletionTimeMs: entry.avgCompletionTimeMs,
        avgCompletionTimeSec: entry.avgCompletionTimeMs
          ? Math.round(entry.avgCompletionTimeMs / 1000)
          : null,
      };
    })
  );
}

// Get current week's leaderboard. Aggregates points weekly and resets at week
// end (a live query bounded by the week range — no explicit reset job needed).
// Tiebreaker: lower average completion time ranks higher, computed from first
// completions only within the week (see services/leaderboard.service.ts).
export const getWeeklyLeaderboard = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { weekStart, weekEnd, weekKey } = getWeekBounds();
      const entriesWithUserDetails = await buildWeeklyResponseEntries(
        weekStart,
        weekEnd,
        weekKey
      );

      res.status(200).json({
        success: true,
        leaderboard: {
          type: "weekly",
          weekStart: weekStart.toISOString().slice(0, 10),
          weekEnd: weekEnd.toISOString().slice(0, 10),
          totalPlayers: entriesWithUserDetails.length,
          entries: entriesWithUserDetails,
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Get leaderboard for a specific past (or current) week — computed live from
// source data, same as the current-week endpoint above.
export const getLeaderboardByWeek = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { weekKey } = req.params;
      const { weekStart, weekEnd } = parseWeekKey(weekKey);

      const entriesWithUserDetails = await buildWeeklyResponseEntries(
        weekStart,
        weekEnd,
        weekKey
      );

      res.status(200).json({
        success: true,
        leaderboard: {
          type: "weekly",
          weekKey,
          totalPlayers: entriesWithUserDetails.length,
          entries: entriesWithUserDetails,
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Get all-time leaderboard (legacy puzzle-attempt points only — v2 session
// points/referral/bonus points are scoped to weekly ledger entries and not
// yet folded into this endpoint)
export const getAllTimeLeaderboard = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agg = await PuzzleAttemptModel.aggregate([
        {
          $match: {
            pointsEarned: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: "$userId",
            puzzlesSolved: { $sum: 1 },
            points: { $sum: "$pointsEarned" },
            avgTime: { $avg: "$timeTaken" },
          },
        },
        { $sort: { points: -1, avgTime: 1, puzzlesSolved: -1 } },
        { $limit: 100 },
      ]);

      const hiddenIds = await getHiddenUserIds();

      const entries = agg
        .filter((a: any) => !hiddenIds.has(String(a._id)))
        .map((a: any) => ({
          userId: a._id,
          puzzlesSolved: a.puzzlesSolved,
          points: a.points,
          avgTime: a.avgTime || null,
        }));

      const entriesWithUserDetails = await Promise.all(
        entries.map(async (entry: any, index: number) => {
          const user = await UserModel.findById(entry.userId)
            .select("firstName lastName avatar username")
            .lean();

          return {
            position: index + 1,
            userId: entry.userId,
            fullName: user
              ? `${user.firstName} ${user.lastName}`
              : "Unknown User",
            username: user?.username || "",
            avatar: user?.avatar || "",
            puzzlesSolved: entry.puzzlesSolved,
            points: entry.points,
            avgCompletionTimeMs: entry.avgTime || null,
            avgCompletionTimeSec: entry.avgTime
              ? Math.round(entry.avgTime / 1000)
              : null,
          };
        })
      );

      res.status(200).json({
        success: true,
        leaderboard: {
          type: "all-time",
          totalPlayers: entriesWithUserDetails.length,
          entries: entriesWithUserDetails,
        },
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(
          `Failed to fetch all-time leaderboard: ${error.message}`,
          500
        )
      );
    }
  }
);
