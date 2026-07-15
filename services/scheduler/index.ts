import cron from "node-cron";
import mongoose from "mongoose";
import RaffleTicketModel from "../../models/raffleTicket.model";
import { checkExpiredCampaigns, checkAbandonedSessions } from "../../utils/scheduler";
import { calculateWeeklyPayouts } from "../prizePool.service";
import { runDraw } from "../raffle.service";
import { reconcileAllWallets } from "../wallet/wallet.service";
import { getPreviousWeekKey } from "../../utils/weekBoundary";

/**
 * Consolidated node-cron scheduler — replaces the hand-rolled setInterval
 * jobs (utils/scheduler.ts's old startScheduler, and the monthly-leaderboard
 * setTimeout chain that used to live in server.ts) with discrete, legible
 * cron-scheduled jobs. No explicit "leaderboard reset" job is needed: the
 * weekly leaderboard is a live query bounded by the week range (see
 * services/leaderboard.service.ts), so the reset is implicit once the
 * boundary passes.
 */

export async function runWeeklyRollover(): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  const weekKey = getPreviousWeekKey();

  try {
    const result = await calculateWeeklyPayouts(weekKey);
    console.log(
      `Weekly payouts calculated for ${weekKey}: ${result.payouts?.length ?? 0} payout(s), revenue=${result.totalRevenue}`
    );
  } catch (err) {
    console.error(`Weekly payout calculation failed for ${weekKey}:`, err);
  }

  try {
    // Only campaigns that actually sold a ticket that week need a draw.
    const campaignIds: string[] = await RaffleTicketModel.distinct("campaignId", { weekKey });
    for (const campaignId of campaignIds) {
      try {
        await runDraw(campaignId, weekKey);
      } catch (err) {
        console.error(`Raffle draw failed for campaign ${campaignId}, week ${weekKey}:`, err);
      }
    }
    console.log(`Weekly raffle draws completed for ${weekKey}: ${campaignIds.length} campaign(s)`);
  } catch (err) {
    console.error(`Weekly raffle draw lookup failed for ${weekKey}:`, err);
  }
}

export async function runHourlyCampaignExpiry(): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  await checkExpiredCampaigns();
  await checkAbandonedSessions();
}

export async function runNightlyWalletReconciliation(): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const result = await reconcileAllWallets();
    if (result.corrected > 0) {
      console.log(`Wallet reconciliation corrected ${result.corrected}/${result.checked} wallet(s)`);
    }
  } catch (err) {
    console.error("Wallet reconciliation failed:", err);
  }
}

let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;

  // Monday 00:00 — weekly payout calculation + per-campaign raffle draws for the week that just ended
  cron.schedule("0 0 * * 1", () => {
    runWeeklyRollover().catch((err) => console.error("Weekly rollover error:", err));
  });

  // Hourly — campaign auto-complete/expiry
  cron.schedule("0 * * * *", () => {
    runHourlyCampaignExpiry().catch((err) => console.error("Campaign expiry check error:", err));
  });

  // Nightly at 03:00 — wallet ledger reconciliation (defense-in-depth against the narrow
  // crash window described in services/wallet/wallet.service.ts)
  cron.schedule("0 3 * * *", () => {
    runNightlyWalletReconciliation().catch((err) => console.error("Wallet reconciliation error:", err));
  });

  // Run the expiry check immediately on startup, same as the old hand-rolled scheduler did.
  runHourlyCampaignExpiry().catch((err) => console.error("Campaign expiry check error:", err));
}
