import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PayoutModel from "../models/payout.model";
import UserModel from "../models/user.model";
import {
  calculateDailyPrizePool,
  calculateWeeklyPayouts,
  getDailyPrizePool,
  getWeeklyPrizePoolSummary,
} from "../services/prizePool.service";
import {
  calculateDailyPrizeTable,
  getPrizeTableForDate,
} from "../services/dailyPrizeTable.service";

// Get daily prize pool
export const fetchDailyPrizePool = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { date } = req.params; // Format: "2025-01-15"

      const prizePool = await getDailyPrizePool(date);

      res.status(200).json({
        success: true,
        prizePool,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to fetch daily prize pool: ${error.message}`, 500)
      );
    }
  }
);

// Calculate daily prize pool (admin/cron)
export const triggerDailyPrizePoolCalculation = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { date } = req.body; // Format: "2025-01-15"

      if (!date) {
        return next(new ErrorHandler("Date is required", 400));
      }

      const prizePool = await calculateDailyPrizePool(date);

      res.status(200).json({
        success: true,
        message: "Daily prize pool calculated successfully",
        prizePool,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(
          `Failed to calculate daily prize pool: ${error.message}`,
          500
        )
      );
    }
  }
);

// Get weekly prize pool summary
export const fetchWeeklyPrizePoolSummary = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await getWeeklyPrizePoolSummary();

      res.status(200).json({
        success: true,
        summary,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(
          `Failed to fetch weekly prize pool summary: ${error.message}`,
          500
        )
      );
    }
  }
);

// Calculate weekly payouts (admin/cron - runs on Sunday night)
export const triggerWeeklyPayoutCalculation = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { weekKey } = req.body; // Format: "2025-01-06_to_2025-01-12"

      if (!weekKey) {
        return next(new ErrorHandler("Week key is required", 400));
      }

      const result = await calculateWeeklyPayouts(weekKey);

      res.status(200).json({
        success: true,
        message: "Weekly payouts calculated successfully",
        result,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(
          `Failed to calculate weekly payouts: ${error.message}`,
          500
        )
      );
    }
  }
);

// Get gamer's payout history
export const getGamerPayouts = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;

      const payouts = await PayoutModel.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .lean();

      const totalEarnings = payouts.reduce((sum, payout) => sum + payout.amount, 0);

      res.status(200).json({
        success: true,
        payouts,
        totalEarnings,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to fetch payout history: ${error.message}`, 500)
      );
    }
  }
);

// Get specific week's payouts (admin)
export const getWeekPayouts = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { weekKey } = req.params; // Format: "2025-01-06_to_2025-01-12"

      const payouts = await PayoutModel.find({ weekKey })
        .sort({ position: 1 })
        .lean();

      // Fetch user details for each payout
      const payoutsWithUserDetails = await Promise.all(
        payouts.map(async (payout) => {
          const user = await UserModel.findById(payout.userId)
            .select("firstName lastName email avatar")
            .lean();

          return {
            ...payout,
            user: user
              ? {
                  firstName: user.firstName,
                  lastName: user.lastName,
                  email: user.email,
                  avatar: user.avatar,
                }
              : null,
          };
        })
      );

      const totalAmount = payouts.reduce((sum, payout) => sum + payout.amount, 0);

      res.status(200).json({
        success: true,
        weekKey,
        payouts: payoutsWithUserDetails,
        totalAmount,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to fetch week payouts: ${error.message}`, 500)
      );
    }
  }
);

// Mark payouts as processed (admin)
export const processPayouts = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { weekKey, payoutIds } = req.body;

      if (!weekKey || !Array.isArray(payoutIds) || payoutIds.length === 0) {
        return next(
          new ErrorHandler("Week key and payout IDs array are required", 400)
        );
      }

      // Update payouts status to processed
      const result = await PayoutModel.updateMany(
        { _id: { $in: payoutIds }, weekKey },
        {
          $set: {
            status: "processed",
            processedAt: new Date(),
          },
        }
      );

      // Update user analytics with total earnings
      for (const payoutId of payoutIds) {
        const payout = await PayoutModel.findById(payoutId);
        if (payout) {
          const user = await UserModel.findById(payout.userId);
          if (user) {
            user.analytics.lifetime.totalEarnings =
              (user.analytics.lifetime.totalEarnings || 0) + payout.amount;
            await user.save();
          }
        }
      }

      res.status(200).json({
        success: true,
        message: `${result.modifiedCount} payouts marked as processed`,
        modifiedCount: result.modifiedCount,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to process payouts: ${error.message}`, 500)
      );
    }
  }
);

// Get platform earnings summary
export const getPlatformEarnings = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return next(
          new ErrorHandler("Start date and end date are required", 400)
        );
      }

      const DailyPrizePoolModel = require("../models/dailyPrizePool.model").default;

      const dailyPools = await DailyPrizePoolModel.find({
        date: {
          $gte: startDate,
          $lte: endDate,
        },
      });

      const totalRevenue = dailyPools.reduce(
        (sum: number, pool: any) => sum + pool.totalDailyPool,
        0
      );
      const totalPlatformFee = dailyPools.reduce(
        (sum: number, pool: any) => sum + pool.platformFee,
        0
      );
      const totalGamerShare = dailyPools.reduce(
        (sum: number, pool: any) => sum + pool.gamerShare,
        0
      );

      res.status(200).json({
        success: true,
        period: { startDate, endDate },
        summary: {
          totalRevenue,
          totalPlatformFee,
          totalGamerShare,
          platformPercentage: 30,
          gamerPercentage: 70,
        },
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to fetch platform earnings: ${error.message}`, 500)
      );
    }
  }
);

// Get current daily prize table (real-time potential earnings)
export const getCurrentDailyPrizeTable = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const prizeTable = await calculateDailyPrizeTable();

      res.status(200).json({
        success: true,
        prizeTable,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to fetch daily prize table: ${error.message}`, 500)
      );
    }
  }
);

// Get prize table for a specific date
export const getDailyPrizeTableByDate = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { date } = req.params; // Format: "2025-01-20"

      if (!date) {
        return next(new ErrorHandler("Date is required", 400));
      }

      const prizeTable = await getPrizeTableForDate(date);

      res.status(200).json({
        success: true,
        prizeTable,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to fetch prize table for date: ${error.message}`, 500)
      );
    }
  }
);
