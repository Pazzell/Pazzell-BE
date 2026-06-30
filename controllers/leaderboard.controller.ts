import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PuzzleAttemptModel from "../models/puzzleAttempt.model";
import LeaderboardModel from "../models/leaderboard.model";
import UserModel from "../models/user.model";
import ReferralModel from "../models/referral.model";

// Returns the set of user IDs who have opted out of the leaderboard
async function getHiddenUserIds(): Promise<Set<string>> {
  const hiddenUsers = await UserModel.find(
    { "privacy.showOnLeaderboard": false },
    { _id: 1 }
  ).lean();
  return new Set(hiddenUsers.map((u: any) => String(u._id)));
}

// Get current week's leaderboard (puzzle points only — no referral breakdown for weekly)
export const getWeeklyLeaderboard = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const now = new Date();

      const dayOfWeek = now.getDay();
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

      const weekStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - daysFromMonday
      );
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

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

      const hiddenIds = await getHiddenUserIds();

      const entries = agg
        .filter((a: any) => !hiddenIds.has(String(a._id)))
        .map((a: any) => ({
          userId: a._id,
          puzzlesSolved: a.puzzlesSolved,
          points: a.points,
          avgTime: a.avgTime || null,
        }));

      const weekKey = `${weekStart.toISOString().slice(0, 10)}_to_${weekEnd
        .toISOString()
        .slice(0, 10)}`;

      await LeaderboardModel.findOneAndUpdate(
        { type: "weekly", date: weekKey },
        { type: "weekly", date: weekKey, entries },
        { upsert: true }
      );

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
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Build monthly leaderboard entries for a given month range (live computation)
async function buildMonthlyEntries(monthStart: Date, monthEnd: Date, hiddenIds?: Set<string>) {
  if (!hiddenIds) hiddenIds = await getHiddenUserIds();
  // Puzzle points earned this month
  const puzzleAgg = await PuzzleAttemptModel.aggregate([
    {
      $match: {
        pointsEarned: { $gt: 0 },
        timestamp: { $gte: monthStart, $lte: monthEnd },
      },
    },
    {
      $group: {
        _id: "$userId",
        puzzlePoints: { $sum: "$pointsEarned" },
        puzzlesSolved: { $sum: 1 },
      },
    },
  ]);

  // Referral bonus points earned this month (when referral became successful)
  const referralAgg = await ReferralModel.aggregate([
    {
      $match: {
        successful: true,
        successfulAt: { $gte: monthStart, $lte: monthEnd },
      },
    },
    {
      $group: {
        _id: "$referrerId",
        referralPoints: { $sum: "$pointsAwarded" },
        referralCount: { $sum: 1 },
      },
    },
  ]);

  // Merge puzzle and referral points by userId
  const userMap = new Map<
    string,
    {
      puzzlePoints: number;
      puzzlesSolved: number;
      referralPoints: number;
      referralCount: number;
    }
  >();

  for (const p of puzzleAgg) {
    userMap.set(String(p._id), {
      puzzlePoints: p.puzzlePoints,
      puzzlesSolved: p.puzzlesSolved,
      referralPoints: 0,
      referralCount: 0,
    });
  }

  for (const r of referralAgg) {
    const uid = String(r._id);
    const existing = userMap.get(uid) || {
      puzzlePoints: 0,
      puzzlesSolved: 0,
      referralPoints: 0,
      referralCount: 0,
    };
    existing.referralPoints = r.referralPoints;
    existing.referralCount = r.referralCount;
    userMap.set(uid, existing);
  }

  // Sort by totalPoints desc, then puzzlePoints desc; exclude hidden users
  return Array.from(userMap.entries())
    .filter(([userId]) => !hiddenIds!.has(userId))
    .map(([userId, data]) => ({
      userId,
      puzzlePoints: data.puzzlePoints,
      puzzlesSolved: data.puzzlesSolved,
      referralPoints: data.referralPoints,
      referralCount: data.referralCount,
      totalPoints: data.puzzlePoints + data.referralPoints,
    }))
    .sort(
      (a, b) =>
        b.totalPoints - a.totalPoints || b.puzzlePoints - a.puzzlePoints
    )
    .slice(0, 100);
}

// Get current month's leaderboard
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

      const entries = await buildMonthlyEntries(monthStart, monthEnd);

      // Cache snapshot
      await LeaderboardModel.findOneAndUpdate(
        { type: "monthly", date: monthKey },
        {
          type: "monthly",
          date: monthKey,
          entries: entries.map((e) => ({
            userId: e.userId,
            puzzlesSolved: e.puzzlesSolved,
            points: e.totalPoints,
          })),
        },
        { upsert: true }
      );

      const entriesWithUserDetails = await Promise.all(
        entries.map(async (entry, idx) => {
          const user = await UserModel.findById(entry.userId)
            .select("firstName lastName username avatar")
            .lean();
          return {
            position: idx + 1,
            userId: entry.userId,
            fullName: user
              ? `${user.firstName} ${user.lastName}`
              : "Unknown User",
            username: user?.username || "",
            avatar: user?.avatar || "",
            puzzlesSolved: entry.puzzlesSolved,
            puzzlePoints: entry.puzzlePoints,
            referralPoints: entry.referralPoints,
            referralCount: entry.referralCount,
            totalPoints: entry.totalPoints,
          };
        })
      );

      res.status(200).json({
        success: true,
        leaderboard: {
          type: "monthly",
          monthKey,
          resetsAt: `End of ${monthKey}`,
          totalPlayers: entriesWithUserDetails.length,
          entries: entriesWithUserDetails,
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Get monthly leaderboard by monthKey (YYYY-MM) — computed live from source data
export const getLeaderboardByMonth = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { monthKey } = req.params;
      const [y, m] = monthKey.split("-").map(Number);
      const monthStart = new Date(y, m - 1, 1);
      const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);

      const entries = await buildMonthlyEntries(monthStart, monthEnd);

      const entriesWithUserDetails = await Promise.all(
        entries.map(async (entry, idx) => {
          const user = await UserModel.findById(entry.userId)
            .select("firstName lastName username avatar")
            .lean();
          return {
            position: idx + 1,
            userId: entry.userId,
            fullName: user
              ? `${user.firstName} ${user.lastName}`
              : "Unknown User",
            username: user?.username || "",
            avatar: user?.avatar || "",
            puzzlesSolved: entry.puzzlesSolved,
            puzzlePoints: entry.puzzlePoints,
            referralPoints: entry.referralPoints,
            referralCount: entry.referralCount,
            totalPoints: entry.totalPoints,
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
      const { weekKey } = req.params;

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

// Get all-time leaderboard (puzzle points only)
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
