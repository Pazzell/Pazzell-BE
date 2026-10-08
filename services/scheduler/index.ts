import cron from "node-cron";
import mongoose from "mongoose";
import { reconcileAllWallets } from "../wallet/wallet.service";
import { expireCampaigns } from "../campaign/campaign.service";
import { lockQuizzesForExpiredPro } from "../customQuiz/quizLock.service";
import { abandonStaleMatchAttempts } from "../match/match.service";
import { abandonStaleTriviaSessions } from "../trivia/session.service";

/**
 * node-cron scheduler. Every job here is a convenience sweep: the rules it applies
 * (an ended campaign is never served, an expired Pro plan grants nothing, an over-limit
 * quiz is locked) are also enforced on read, so a late or missed run is harmless.
 */

export async function runExpirySweep(): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const ended = await expireCampaigns();
    if (ended > 0) console.log(`Marked ${ended} campaign(s) as ended`);
  } catch (err) {
    console.error("Campaign expiry failed:", err);
  }
  try {
    const locked = await lockQuizzesForExpiredPro();
    if (locked > 0) console.log(`Applied quiz locks for ${locked} expired Pro account(s)`);
  } catch (err) {
    console.error("Pro expiry sweep failed:", err);
  }
}

export async function runStaleAttemptSweep(): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const match = await abandonStaleMatchAttempts();
    const trivia = await abandonStaleTriviaSessions();
    if (match + trivia > 0) {
      console.log(`Closed ${match} Match attempt(s) and ${trivia} trivia session(s) as abandoned`);
    }
  } catch (err) {
    console.error("Stale attempt sweep failed:", err);
  }
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

  // Every 10 minutes — campaign auto-end and Pro-expiry quiz locking
  cron.schedule("*/10 * * * *", () => {
    runExpirySweep().catch((err) => console.error("Expiry sweep error:", err));
  });

  // Hourly — close Match attempts and trivia sessions that were walked away from
  cron.schedule("0 * * * *", () => {
    runStaleAttemptSweep().catch((err) => console.error("Stale attempt sweep error:", err));
  });

  // Nightly at 03:00 — wallet ledger reconciliation (defense-in-depth against the narrow
  // crash window described in services/wallet/wallet.service.ts)
  cron.schedule("0 3 * * *", () => {
    runNightlyWalletReconciliation().catch((err) => console.error("Wallet reconciliation error:", err));
  });

  // Run the expiry sweep immediately on startup.
  runExpirySweep().catch((err) => console.error("Expiry sweep error:", err));
}
