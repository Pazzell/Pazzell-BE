import PuzzleCampaignModel from "../models/puzzleCampaign.model";

// Fixed daily rates
const DAILY_RATES = {
  basic: 1000, // ₦1,000/day
  premium: 1428.57, // ₦1,428.57/day
};

// Prize distribution percentages for top 10
const PRIZE_DISTRIBUTION = [
  { position: 1, percentage: 20.0 }, // 20%
  { position: 2, percentage: 15.0 }, // 15%
  { position: 3, percentage: 10.0 }, // 10%
  { position: 4, percentage: 7.875 }, // 7.875%
  { position: 5, percentage: 7.875 }, // 7.875%
  { position: 6, percentage: 7.875 }, // 7.875%
  { position: 7, percentage: 7.875 }, // 7.875%
  { position: 8, percentage: 7.875 }, // 7.875%
  { position: 9, percentage: 7.875 }, // 7.875%
  { position: 10, percentage: 7.875 }, // 7.875%
];

/**
 * Calculate current daily prize table
 * Shows what each position (1-10) would earn based on current active campaigns
 * Updates in real-time as new campaigns are created
 */
export const calculateDailyPrizeTable = async (): Promise<any> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find all active campaigns that are paid and active TODAY
    const activeCampaigns = await PuzzleCampaignModel.find({
      status: "active",
      paymentStatus: "paid",
      startDate: { $lte: today },
      endDate: { $gte: today },
      budgetRemaining: { $gt: 0 },
    }).select("_id packageType dailyAllocation budgetRemaining");

    let totalDailyPool = 0;
    const campaignBreakdown = [];

    // Calculate total daily pool from all active campaigns
    for (const campaign of activeCampaigns) {
      const packageType = campaign.packageType as "basic" | "premium";
      // Prefer stored campaign.dailyAllocation (set at payment) else fallback to legacy DAILY_RATES
      const dailyAllocation =
        (campaign.dailyAllocation && Number(campaign.dailyAllocation)) ||
        DAILY_RATES[packageType];

      totalDailyPool += dailyAllocation;

      campaignBreakdown.push({
        campaignId: String(campaign._id),
        packageType,
        dailyAllocation,
      });
    }

    // Calculate 70-30 split
    const gamerShare = totalDailyPool * 0.7;
    const platformFee = totalDailyPool * 0.3;

    // Calculate prize distribution for each position
    const prizeTable = PRIZE_DISTRIBUTION.map((item) => ({
      position: item.position,
      percentage: item.percentage,
      amount: Math.round(((gamerShare * item.percentage) / 100) * 100) / 100, // Round to 2 decimals
    }));

    return {
      date: today.toISOString().split("T")[0],
      activeCampaignsCount: activeCampaigns.length,
      totalDailyPool,
      gamerShare,
      platformFee,
      prizeTable,
      campaignBreakdown,
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Get prize table for a specific date
 * Useful for historical data or future projections
 */
export const getPrizeTableForDate = async (date: string): Promise<any> => {
  try {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const activeCampaigns = await PuzzleCampaignModel.find({
      status: "active",
      paymentStatus: "paid",
      startDate: { $lte: targetDate },
      endDate: { $gte: targetDate },
      budgetRemaining: { $gt: 0 },
    }).select("_id packageType dailyAllocation");

    let totalDailyPool = 0;
    const campaignBreakdown = [];

    for (const campaign of activeCampaigns) {
      const packageType = campaign.packageType as "basic" | "premium";
      const dailyAllocation = DAILY_RATES[packageType];

      totalDailyPool += dailyAllocation;

      campaignBreakdown.push({
        campaignId: String(campaign._id),
        packageType,
        dailyAllocation,
      });
    }

    const gamerShare = totalDailyPool * 0.7;
    const platformFee = totalDailyPool * 0.3;

    const prizeTable = PRIZE_DISTRIBUTION.map((item) => ({
      position: item.position,
      percentage: item.percentage,
      amount: Math.round(((gamerShare * item.percentage) / 100) * 100) / 100,
    }));

    return {
      date,
      activeCampaignsCount: activeCampaigns.length,
      totalDailyPool,
      gamerShare,
      platformFee,
      prizeTable,
      campaignBreakdown,
    };
  } catch (error) {
    throw error;
  }
};
