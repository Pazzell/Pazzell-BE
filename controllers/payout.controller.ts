import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PayoutModel from "../models/payout.model";
import UserModel from "../models/user.model";
import TransactionModel from "../models/transaction.model";
import {
  calculateWeeklyPayouts,
  getWeeklyPrizePoolSummary,
} from "../services/prizePool.service";
import { credit } from "../services/wallet/wallet.service";

// Get weekly prize pool summary (current week, live preview)
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

// Calculate weekly payouts (admin/cron - runs on Monday, see services/scheduler)
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

// Mark payouts as paid (admin) — credits each payout's amount to the
// player's wallet (idempotent via `payout:${payoutId}` ledger key) and
// advances status straight to "paid". Previously this only flipped a status
// field and bumped a dead `analytics.lifetime.totalEarnings` counter without
// ever moving real money — now it's the actual crediting step.
export const processPayouts = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { weekKey, payoutIds } = req.body;

      if (!weekKey || !Array.isArray(payoutIds) || payoutIds.length === 0) {
        return next(
          new ErrorHandler("Week key and payout IDs array are required", 400)
        );
      }

      const payouts = await PayoutModel.find({
        _id: { $in: payoutIds },
        weekKey,
      });

      let processedCount = 0;
      for (const payout of payouts) {
        if (payout.status === "paid") continue; // already processed, idempotent no-op

        const ledgerEntry = await credit({
          userId: payout.userId,
          amount: payout.amount,
          reason: "weekly_payout",
          referenceId: String(payout._id),
          idempotencyKey: `payout:${payout._id}`,
        });

        payout.status = "paid";
        payout.processedAt = new Date();
        payout.walletTransactionId = String(ledgerEntry._id);
        await payout.save();
        processedCount++;
      }

      res.status(200).json({
        success: true,
        message: `${processedCount} payout(s) credited to player wallets`,
        processedCount,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to process payouts: ${error.message}`, 500)
      );
    }
  }
);

// Get platform earnings summary (revenue collected vs. player pool paid out)
export const getPlatformEarnings = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

      if (!startDate || !endDate) {
        return next(
          new ErrorHandler("Start date and end date are required", 400)
        );
      }

      const revenueAgg = await TransactionModel.aggregate([
        {
          $match: {
            status: "success",
            createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);
      const totalRevenue = revenueAgg[0]?.total || 0;

      const payoutAgg = await PayoutModel.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);
      const totalPlayerPayouts = payoutAgg[0]?.total || 0;

      res.status(200).json({
        success: true,
        period: { startDate, endDate },
        summary: {
          totalRevenue,
          totalPlayerPayouts,
          platformRetained: totalRevenue - totalPlayerPayouts,
        },
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to fetch platform earnings: ${error.message}`, 500)
      );
    }
  }
);
