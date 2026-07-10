import PayoutModel from "../models/payout.model";
import TransactionModel from "../models/transaction.model";
import { getWeekBounds, parseWeekKey } from "../utils/weekBoundary";
import { getUnifiedWeeklyEntries } from "./leaderboard.service";
import { getPayoutSplit, getRankDistribution } from "./config/config.service";

/**
 * Weekly revenue = sum of successful campaign payments (Transaction.amount)
 * within the week — replaces the old daily-drip DailyPrizePoolModel
 * mechanism (fed by campaign.dailyAllocation), which was built for the old
 * hours/month campaign-duration model and no longer reflects "that week's
 * campaign revenue" in a way that maps cleanly to the weekly billing revert.
 */
export async function getWeeklyRevenue(weekStart: Date, weekEnd: Date): Promise<number> {
  const agg = await TransactionModel.aggregate([
    {
      $match: {
        status: "success",
        createdAt: { $gte: weekStart, $lte: weekEnd },
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return agg[0]?.total || 0;
}

/**
 * Calculates and upserts weekly cash-reward Payout rows for the top 10
 * players that week. Player/platform split and rank distribution percentages
 * are Config-driven (default 50/50 split, may move to 60/40 later — see
 * services/config/config.service.ts) rather than hardcoded, and both are
 * snapshotted onto each Payout row for audit even if Config changes later.
 *
 * Top-10 selection reuses the exact same unified weekly leaderboard source
 * (services/leaderboard.service.ts) that the public leaderboard displays —
 * previously the payout calculation had its own independent aggregation
 * pipeline (sorted puzzlesSolved desc/points desc, no time tiebreaker) that
 * could silently disagree with what players saw on the leaderboard.
 */
export const calculateWeeklyPayouts = async (weekKey: string): Promise<any> => {
  const { weekStart, weekEnd } = parseWeekKey(weekKey);

  const totalRevenue = await getWeeklyRevenue(weekStart, weekEnd);
  const { playerSharePercent, platformSharePercent } = await getPayoutSplit();
  const playerPool = Math.round((totalRevenue * playerSharePercent) / 100 * 100) / 100;
  const platformShare = Math.round((totalRevenue * platformSharePercent) / 100 * 100) / 100;

  const entries = await getUnifiedWeeklyEntries(weekStart, weekEnd, weekKey);
  const top10 = entries.slice(0, 10);

  if (top10.length === 0) {
    return { weekKey, totalRevenue, playerPool, platformShare, payouts: [] };
  }

  const rankDistribution = await getRankDistribution();
  const payouts = [];

  for (let i = 0; i < top10.length; i++) {
    const gamer = top10[i];
    const position = i + 1;
    const distribution = rankDistribution[i];
    if (!distribution) break; // fewer configured ranks than players (shouldn't happen with 10 configured)

    const amount = Math.round(((playerPool * distribution.percentage) / 100) * 100) / 100;

    const payout = await PayoutModel.findOneAndUpdate(
      { userId: gamer.userId, weekKey },
      {
        userId: gamer.userId,
        weekKey,
        position,
        points: gamer.points,
        puzzlesSolved: gamer.puzzlesSolved,
        totalDailyPool: totalRevenue,
        gamerShare: playerPool,
        weeklyRevenue: totalRevenue,
        distributionPercentage: distribution.percentage,
        amount,
        currency: "NGN",
        status: "pending",
        playerSharePercent,
        platformSharePercent,
      },
      { upsert: true, new: true }
    );
    payouts.push(payout);
  }

  return { weekKey, totalRevenue, playerPool, platformShare, payouts };
};

/** Current week's prize pool preview (before Monday's finalization). */
export const getWeeklyPrizePoolSummary = async (): Promise<any> => {
  const { weekStart, weekEnd, weekKey } = getWeekBounds();
  const totalRevenue = await getWeeklyRevenue(weekStart, weekEnd);
  const { playerSharePercent, platformSharePercent } = await getPayoutSplit();

  return {
    weekKey,
    weekStart,
    weekEnd,
    totalRevenue,
    playerPool: Math.round((totalRevenue * playerSharePercent) / 100 * 100) / 100,
    platformShare: Math.round((totalRevenue * platformSharePercent) / 100 * 100) / 100,
    playerSharePercent,
    platformSharePercent,
  };
};
