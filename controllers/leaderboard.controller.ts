import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PuzzleAttemptModel from "../models/puzzleAttempt.model";
import LeaderboardModel from "../models/leaderboard.model";
import UserModel from "../models/user.model";

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

      // DEBUG: Count all attempts regardless of week
      const totalAttempts = await PuzzleAttemptModel.countDocuments({
        firstTimeSolved: true,
      });

      // DEBUG: Count attempts in current week
      const weekAttempts = await PuzzleAttemptModel.countDocuments({
        firstTimeSolved: true,
        timestamp: { $gte: weekStart, $lte: weekEnd },
      });

      // count firstTimeSolved attempts that occurred this week grouped by user
      const agg = await PuzzleAttemptModel.aggregate([
        {
          $match: {
            firstTimeSolved: true,
            timestamp: { $gte: weekStart, $lte: weekEnd },
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

      const entries = agg.map((a: any) => ({
        userId: a._id,
        puzzlesSolved: a.puzzlesSolved,
        points: a.points,
      }));

      // Create week key
      const weekKey = `${weekStart.toISOString().slice(0, 10)}_to_${weekEnd.toISOString().slice(0, 10)}`;

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
            fullName: user ? `${user.firstName} ${user.lastName}` : "Unknown User",
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
            fullName: user ? `${user.firstName} ${user.lastName}` : "Unknown User",
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
      // Aggregate all puzzle attempts (no time filter)
      const agg = await PuzzleAttemptModel.aggregate([
        {
          $match: {
            firstTimeSolved: true,
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

      const entries = agg.map((a: any) => ({
        userId: a._id,
        puzzlesSolved: a.puzzlesSolved,
        points: a.points,
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
            fullName: user ? `${user.firstName} ${user.lastName}` : "Unknown User",
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
          type: "all-time",
          totalPlayers: entriesWithUserDetails.length,
          entries: entriesWithUserDetails,
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(`Failed to fetch all-time leaderboard: ${error.message}`, 500));
    }
  }
);
