import PuzzleCampaignModel from "../models/puzzleCampaign.model";
import DailyPrizePoolModel from "../models/dailyPrizePool.model";
import PayoutModel from "../models/payout.model";
import PuzzleAttemptModel from "../models/puzzleAttempt.model";

// Fixed daily rates
const DAILY_RATES = {
  basic: 1000, // ₦1,000/day
  premium: 1428.57, // ₦1,428.57/day
};

// Prize distribution percentages for top 10
const PRIZE_DISTRIBUTION = [
  { position: 1, percentage: 0.2 }, // 20%
  { position: 2, percentage: 0.15 }, // 15%
  { position: 3, percentage: 0.1 }, // 10%
  { position: 4, percentage: 0.07875 }, // 7.875%
  { position: 5, percentage: 0.07875 }, // 7.875%
  { position: 6, percentage: 0.07875 }, // 7.875%
  { position: 7, percentage: 0.07875 }, // 7.875%
  { position: 8, percentage: 0.07875 }, // 7.875%
  { position: 9, percentage: 0.07875 }, // 7.875%
  { position: 10, percentage: 0.07875 }, // 7.875%
];

/**
 * Calculate and create daily prize pool for a specific date
 */
export const calculateDailyPrizePool = async (date: string): Promise<any> => {
  try {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    // Find all active campaigns for this date
    const activeCampaigns = await PuzzleCampaignModel.find({
      status: "active",
      paymentStatus: "paid",
      startDate: { $lte: targetDate },
      endDate: { $gte: targetDate },
    });

    const campaignAllocations = [];
    let totalDailyPool = 0;

    for (const campaign of activeCampaigns) {
      if (campaign.budgetRemaining && campaign.budgetRemaining > 0) {
        const packageType = campaign.packageType as "basic" | "premium";
        // Prefer campaign-specific dailyAllocation (set at payment), fallback to legacy DAILY_RATES
        const dailyAllocation =
          (campaign.dailyAllocation && Number(campaign.dailyAllocation)) ||
          DAILY_RATES[packageType];

        // Add to pool
        campaignAllocations.push({
          campaignId: String(campaign._id),
          packageType,
          dailyAllocation,
        });

        totalDailyPool += dailyAllocation;

        // Update campaign budget
        campaign.budgetUsed = (campaign.budgetUsed || 0) + dailyAllocation;
        campaign.budgetRemaining =
          (campaign.budgetRemaining || 0) - dailyAllocation;
        await campaign.save();
      }
    }

    // Calculate 70-30 split
    const gamerShare = totalDailyPool * 0.7;
    const platformFee = totalDailyPool * 0.3;

    // Create or update daily prize pool
    const prizePool = await DailyPrizePoolModel.findOneAndUpdate(
      { date },
      {
        date,
        activeCampaigns: campaignAllocations,
        totalDailyPool,
        gamerShare,
        platformFee,
        status: "active",
      },
      { upsert: true, new: true }
    );

    return prizePool;
  } catch (error) {
    throw error;
  }
};

/**
 * Get current week's start and end dates (Monday to Sunday)
 */
const getCurrentWeekDates = () => {
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

  return { weekStart, weekEnd };
};

/**
 * Calculate weekly payouts for top 10 gamers
 */
export const calculateWeeklyPayouts = async (weekKey: string): Promise<any> => {
  try {
    // Parse week key to get dates
    const [startStr, endStr] = weekKey.split("_to_");
    const weekStart = new Date(startStr);
    const weekEnd = new Date(endStr);

    // Get top 10 gamers for the week
    const topGamers = await PuzzleAttemptModel.aggregate([
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
      { $sort: { puzzlesSolved: -1, points: -1 } },
      { $limit: 10 },
    ]);

    if (topGamers.length === 0) {
      return { message: "No gamers found for this week" };
    }

    // Get all daily prize pools for the week
    const dailyPools = await DailyPrizePoolModel.find({
      date: {
        $gte: startStr,
        $lte: endStr,
      },
    });

    // Calculate total weekly pool
    const totalWeeklyPool = dailyPools.reduce(
      (sum, pool) => sum + pool.totalDailyPool,
      0
    );
    const weeklyGamerShare = totalWeeklyPool * 0.7;

    // Create payouts for each gamer
    const payouts = [];

    for (let i = 0; i < topGamers.length; i++) {
      const gamer = topGamers[i];
      const position = i + 1;
      const distribution = PRIZE_DISTRIBUTION[i];

      const amount = weeklyGamerShare * distribution.percentage;

      // Create or update payout
      const payout = await PayoutModel.findOneAndUpdate(
        { userId: gamer._id, weekKey },
        {
          userId: gamer._id,
          weekKey,
          position,
          points: gamer.points,
          puzzlesSolved: gamer.puzzlesSolved,
          totalDailyPool: totalWeeklyPool,
          gamerShare: weeklyGamerShare,
          distributionPercentage: distribution.percentage * 100,
          amount,
          currency: "NGN",
          status: "pending",
        },
        { upsert: true, new: true }
      );

      payouts.push(payout);
    }

    return {
      weekKey,
      totalWeeklyPool,
      weeklyGamerShare,
      platformFee: totalWeeklyPool * 0.3,
      payouts,
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Get daily prize pool for a specific date
 */
export const getDailyPrizePool = async (date: string): Promise<any> => {
  try {
    const prizePool = await DailyPrizePoolModel.findOne({ date });

    if (!prizePool) {
      // Calculate if not exists
      return await calculateDailyPrizePool(date);
    }

    return prizePool;
  } catch (error) {
    throw error;
  }
};

/**
 * Get current week's prize pool summary
 */
export const getWeeklyPrizePoolSummary = async (): Promise<any> => {
  try {
    const { weekStart, weekEnd } = getCurrentWeekDates();

    const weekKey = `${weekStart.toISOString().slice(0, 10)}_to_${weekEnd
      .toISOString()
      .slice(0, 10)}`;

    // Get all daily pools for the week
    const dailyPools = await DailyPrizePoolModel.find({
      date: {
        $gte: weekKey.split("_to_")[0],
        $lte: weekKey.split("_to_")[1],
      },
    });

    const totalWeeklyPool = dailyPools.reduce(
      (sum, pool) => sum + pool.totalDailyPool,
      0
    );

    return {
      weekKey,
      weekStart,
      weekEnd,
      dailyPools: dailyPools.length,
      totalWeeklyPool,
      weeklyGamerShare: totalWeeklyPool * 0.7,
      weeklyPlatformFee: totalWeeklyPool * 0.3,
    };
  } catch (error) {
    throw error;
  }
};
