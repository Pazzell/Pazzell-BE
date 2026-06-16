import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PuzzleAttemptModel from "../models/puzzleAttempt.model";
import LeaderboardModel from "../models/leaderboard.model";
import UserModel from "../models/user.model";

const MONTHLY_PRIZES: number[] = [
  100000, 60000, 50000, 40000, 35000, 30000, 25000, 20000, 15000, 10000,
];

// Get current week's leaderboard
export const getWeeklyLeaderboard = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const now = new Date();

      // Calculate current week's start (Monday) and end (Sunday)
      const dayOfWeek = now.getDay();
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday is 0, Monday is 1

      const weekStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - daysFromMonday
      );
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6); // Sunday
      weekEnd.setHours(23, 59, 59, 999);

      // DEBUG: Count all point-earning attempts regardless of week
      const totalAttempts = await PuzzleAttemptModel.countDocuments({
        pointsEarned: { $gt: 0 },
      });

      // DEBUG: Count point-earning attempts in current week
      const weekAttempts = await PuzzleAttemptModel.countDocuments({
        pointsEarned: { $gt: 0 },
        timestamp: { $gte: weekStart, $lte: weekEnd },
      });

      // count point-earning attempts that occurred this week grouped by user
      // (pointsEarned > 0 rather than firstTimeSolved: true, since players can
      // earn points again on later days for the same campaign)
      const agg = await PuzzleAttemptModel.aggregate([
        {
          $match: {
            pointsEarned: { $gt: 0 },
            timestamp: { $gte: weekStart, $lte: weekEnd },
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

      const entries = agg.map((a: any) => ({
        userId: a._id,
        puzzlesSolved: a.puzzlesSolved,
        points: a.points,
        avgTime: a.avgTime || null,
      }));

      // Create week key
      const weekKey = `${weekStart.toISOString().slice(0, 10)}_to_${weekEnd
        .toISOString()
        .slice(0, 10)}`;

      // upsert leaderboard document for this week
      await LeaderboardModel.findOneAndUpdate(
        { type: "weekly", date: weekKey },
        { type: "weekly", date: weekKey, entries },
        { upsert: true }
      );

      // Fetch user details for each entry
      const entriesWithUserDetails = await Promise.all(
        entries.map(async (entry: any, index: number) => {
          const user = await UserModel.findById(entry.userId)
            .select("firstName lastName username avatar")
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
            amountEarned: entry.points, // Points = amount earned
          };
        })
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
        debug: {
          totalAttemptsWithFirstTimeSolved: totalAttempts,
          attemptsInCurrentWeek: weekAttempts,
          weekStartFull: weekStart.toISOString(),
          weekEndFull: weekEnd.toISOString(),
          currentDate: now.toISOString(),
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Get current month's leaderboard (monthly)
export const getMonthlyLeaderboard = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(
        now.getMonth() + 1
      ).padStart(2, "0")}`;
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );

      // Compute live standings for the current month (pointsEarned > 0,
      // since players can earn points on multiple days within the month)
      const agg = await PuzzleAttemptModel.aggregate([
        {
          $match: {
            pointsEarned: { $gt: 0 },
            timestamp: { $gte: monthStart, $lte: monthEnd },
          },
        },
        {
          $group: {
            _id: "$userId",
            puzzlesSolved: { $sum: 1 },
            points: { $sum: "$pointsEarned" },
          },
        },
        { $sort: { points: -1, puzzlesSolved: -1 } },
        { $limit: 100 },
      ]);

      const entries = agg.map((a: any, idx: number) => ({
        position: idx + 1,
        userId: a._id,
        points: a.points,
        puzzlesSolved: a.puzzlesSolved,
        prizeAmount: MONTHLY_PRIZES[idx] || 0,
      }));

      // keep a cached snapshot up to date for this month
      await LeaderboardModel.findOneAndUpdate(
        { type: "monthly", date: monthKey },
        {
          type: "monthly",
          date: monthKey,
          entries: entries.map((e) => ({
            userId: e.userId,
            puzzlesSolved: e.puzzlesSolved,
            points: e.points,
          })),
        },
        { upsert: true }
      );

      const entriesWithUserDetails = await Promise.all(
        entries.map(async (entry: any) => {
          const user = await UserModel.findById(entry.userId)
            .select("firstName lastName username avatar")
            .lean();
          return {
            position: entry.position,
            userId: entry.userId,
            fullName: user
              ? `${user.firstName} ${user.lastName}`
              : "Unknown User",
            username: user?.username || "",
            avatar: user?.avatar || "",
            puzzlesSolved: entry.puzzlesSolved,
            points: entry.points,
            prizeAmount: entry.prizeAmount,
          };
        })
      );

      res.status(200).json({
        success: true,
        leaderboard: {
          type: "monthly",
          monthKey,
          totalPlayers: entriesWithUserDetails.length,
          entries: entriesWithUserDetails,
          jackpot: {
            amount: 65000,
            note: "Top 10 qualify for ₦65,000 Jackpot Draw",
          },
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Get monthly leaderboard by monthKey (YYYY-MM)
export const getLeaderboardByMonth = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { monthKey } = req.params; // e.g., "2026-04"
      const board = await LeaderboardModel.findOne({
        type: "monthly",
        date: monthKey,
      });
      if (!board) {
        return res
          .status(200)
          .json({
            success: true,
            leaderboard: {
              type: "monthly",
              monthKey,
              totalPlayers: 0,
              entries: [],
            },
          });
      }

      const entries = board.entries.map((e: any, idx: number) => ({
        position: idx + 1,
        userId: e.userId,
        points: e.points,
        puzzlesSolved: e.puzzlesSolved || 0,
        prizeAmount: MONTHLY_PRIZES[idx] || 0,
      }));

      const entriesWithUserDetails = await Promise.all(
        entries.map(async (entry: any) => {
          const user = await UserModel.findById(entry.userId)
            .select("firstName lastName username avatar")
            .lean();
          return {
            position: entry.position,
            userId: entry.userId,
            fullName: user
              ? `${user.firstName} ${user.lastName}`
              : "Unknown User",
            username: user?.username || "",
            avatar: user?.avatar || "",
            puzzlesSolved: entry.puzzlesSolved,
            points: entry.points,
            prizeAmount: entry.prizeAmount,
          };
        })
      );

      res
        .status(200)
        .json({
          success: true,
          leaderboard: {
            type: "monthly",
            monthKey,
            totalPlayers: entriesWithUserDetails.length,
            entries: entriesWithUserDetails,
          },
        });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Get leaderboard for a specific week
export const getLeaderboardByWeek = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { weekKey } = req.params; // Format: "2025-01-06_to_2025-01-12"

      const board = await LeaderboardModel.findOne({
        type: "weekly",
        date: weekKey,
      });

      if (!board) {
        return res.status(200).json({
          success: true,
          leaderboard: {
            type: "weekly",
            weekKey,
            totalPlayers: 0,
            entries: [],
          },
        });
      }

      // Fetch user details for each entry
      const entriesWithUserDetails = await Promise.all(
        board.entries.map(async (entry: any, index: number) => {
          const user = await UserModel.findById(entry.userId)
            .select("firstName lastName username avatar")
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
            amountEarned: entry.points, // Points = amount earned
          };
        })
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

// Get all-time leaderboard
export const getAllTimeLeaderboard = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Aggregate all puzzle attempts (no time filter) and compute avg completion time
      // (pointsEarned > 0 rather than firstTimeSolved: true, since players can
      // earn points again on later days for the same campaign)
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

      const entries = agg.map((a: any) => ({
        userId: a._id,
        puzzlesSolved: a.puzzlesSolved,
        points: a.points,
        avgTime: a.avgTime || null,
      }));

      // Fetch user details for each entry
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
            amountEarned: entry.points, // Points = amount earned
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
