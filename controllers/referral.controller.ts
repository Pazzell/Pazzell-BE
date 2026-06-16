import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import ReferralModel from "../models/referral.model";
import ReferralEventModel from "../models/referralEvent.model";
import UserModel from "../models/user.model";

function monthRangeFromKey(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 0, 23, 59, 59, 999);
  return { start, end };
}

// GET /referrals/summary?month=YYYY-MM&limit=20
export const getReferralSummary = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const monthKey =
        (req.query.month as string) || new Date().toISOString().slice(0, 7);
      const limit = parseInt((req.query.limit as string) || "100", 10);
      const { start, end } = monthRangeFromKey(monthKey);

      const agg = await ReferralModel.aggregate([
        {
          $match: {
            successful: true,
            successfulAt: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: "$referrerId",
            successfulCount: { $sum: 1 },
            pointsEarned: { $sum: "$pointsAwarded" },
            referred: { $push: "$referredUserId" },
          },
        },
        { $sort: { successfulCount: -1 } },
        { $limit: limit },
      ]);

      // enrich with user info
      const results = await Promise.all(
        agg.map(async (row: any, idx: number) => {
          const user = await UserModel.findById(row._id)
            .select("firstName lastName username email avatar")
            .lean();
          return {
            rank: idx + 1,
            user: user || { userId: row._id },
            successfulCount: row.successfulCount,
            pointsEarned: row.pointsEarned || 0,
            referredUserIds: row.referred,
          };
        })
      );

      res
        .status(200)
        .json({ success: true, month: monthKey, summary: results });
    } catch (err: any) {
      return next(
        new ErrorHandler(err.message || "Failed to get referral summary", 500)
      );
    }
  }
);

// GET /referrals/events?month=YYYY-MM&eventType=signup|first_puzzle
export const getReferralEvents = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const monthKey =
        (req.query.month as string) || new Date().toISOString().slice(0, 7);
      const eventType = (req.query.eventType as string) || undefined;
      const { start, end } = monthRangeFromKey(monthKey);

      const filter: any = { eventAt: { $gte: start, $lte: end } };
      if (eventType) filter.eventType = eventType;

      const events = await ReferralEventModel.find(filter)
        .sort({ eventAt: -1 })
        .lean();

      res
        .status(200)
        .json({ success: true, month: monthKey, count: events.length, events });
    } catch (err: any) {
      return next(
        new ErrorHandler(err.message || "Failed to get referral events", 500)
      );
    }
  }
);

export default {};
