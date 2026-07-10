import crypto from "crypto";
import RaffleTicketModel, { IRaffleTicket } from "../models/raffleTicket.model";
import RaffleDrawModel, { IRaffleDraw } from "../models/raffleDraw.model";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";
import { getRaffleEligibilityFloorCap } from "./config/config.service";
import { getUserDistinctCampaignCompletionsInWeek } from "./points/pointsLedger.service";

/**
 * Mints a raffle ticket for a first completion. Called from
 * gameSession.service.ts completeSession() right after the flat points award —
 * a no-op (idempotent) if a ticket for this user+campaign already exists,
 * since the unique {userId, campaignId} index guarantees one ticket ever per
 * player per campaign regardless of how many times this is called.
 */
export async function mintTicketOnFirstCompletion(
  userId: string,
  campaignId: string,
  sessionId: string,
  weekKey: string
): Promise<IRaffleTicket | null> {
  try {
    return await RaffleTicketModel.create({
      userId,
      campaignId,
      weekKey,
      sourceSessionId: sessionId,
    });
  } catch (e: any) {
    if (e.code === 11000) return null; // already has a ticket for this campaign
    throw e;
  }
}

/**
 * N = lesser of the configured cap (default 3) or the number of platform-wide
 * active (v2) campaigns. A player becomes eligible for ANY draw that week once
 * they've completed at least N distinct campaigns that week — banked tickets
 * for campaigns beyond that don't require anything further once the floor is met.
 */
export async function getEligibilityFloor(): Promise<number> {
  const cap = await getRaffleEligibilityFloorCap();
  const activeCampaignCount = await PuzzleCampaignModel.countDocuments({
    schemaVersion: 2,
    status: "active",
  });
  return Math.min(cap, activeCampaignCount || 0);
}

export async function isEligibleThisWeek(
  userId: string,
  weekKey: string
): Promise<boolean> {
  const floor = await getEligibilityFloor();
  if (floor <= 0) return true; // no active campaigns to require completions against
  const distinctCampaigns = await getUserDistinctCampaignCompletionsInWeek(userId, weekKey);
  return distinctCampaigns.length >= floor;
}

/**
 * Provably-random draw: seed = crypto.randomBytes(32); ticket holders are
 * sorted deterministically (lexicographically by userId) before indexing;
 * winnerIndex = HMAC-SHA256(seed, campaignId:weekKey) mod eligibleList.length.
 * Anyone can recompute the same winnerIndex from the stored seed + the
 * snapshotted eligible-ticket list + this documented algorithm — that's the
 * audit trail (see verifyDraw below).
 */
function computeWinnerIndex(
  seed: string,
  campaignId: string,
  weekKey: string,
  eligibleCount: number
): number {
  const hmac = crypto.createHmac("sha256", Buffer.from(seed, "hex"));
  hmac.update(`${campaignId}:${weekKey}`);
  const digest = hmac.digest();
  // Use the first 4 bytes as an unsigned 32-bit integer for the modulo draw.
  const asUint32 = digest.readUInt32BE(0);
  return asUint32 % eligibleCount;
}

export async function runDraw(
  campaignId: string,
  weekKey: string
): Promise<IRaffleDraw | null> {
  const existing = await RaffleDrawModel.findOne({ campaignId, weekKey });
  if (existing && existing.status !== "pending") return existing; // idempotent — don't re-draw

  const tickets = await RaffleTicketModel.find({ campaignId, weekKey }).lean();
  if (tickets.length === 0) return null;

  const allTicketUserIds = tickets.map((t) => t.userId);

  const eligibilityChecks = await Promise.all(
    allTicketUserIds.map(async (userId) => ({
      userId,
      eligible: await isEligibleThisWeek(userId, weekKey),
    }))
  );
  const eligibleTicketUserIds = eligibilityChecks
    .filter((c) => c.eligible)
    .map((c) => c.userId)
    .sort(); // deterministic ordering for reproducible verification

  if (eligibleTicketUserIds.length === 0) {
    return RaffleDrawModel.findOneAndUpdate(
      { campaignId, weekKey },
      { campaignId, weekKey, allTicketUserIds, eligibleTicketUserIds: [], status: "pending" },
      { upsert: true, new: true }
    );
  }

  const seed = crypto.randomBytes(32).toString("hex");
  const winnerIndex = computeWinnerIndex(seed, campaignId, weekKey, eligibleTicketUserIds.length);
  const winnerUserId = eligibleTicketUserIds[winnerIndex];

  return RaffleDrawModel.findOneAndUpdate(
    { campaignId, weekKey },
    {
      campaignId,
      weekKey,
      allTicketUserIds,
      eligibleTicketUserIds,
      seed,
      winnerIndex,
      winnerUserId,
      status: "drawn",
      drawnAt: new Date(),
    },
    { upsert: true, new: true }
  );
}

export interface DrawVerificationResult {
  valid: boolean;
  recomputedWinnerIndex: number;
  recomputedWinnerUserId: string;
}

/** Independently re-derives the winner from the stored seed + snapshot ticket list. */
export async function verifyDraw(drawId: string): Promise<DrawVerificationResult> {
  const draw = await RaffleDrawModel.findById(drawId);
  if (!draw) throw new Error("Draw not found");
  if (!draw.seed || draw.eligibleTicketUserIds.length === 0) {
    throw new Error("Draw has no recorded seed/eligible list to verify");
  }

  const recomputedWinnerIndex = computeWinnerIndex(
    draw.seed,
    draw.campaignId,
    draw.weekKey,
    draw.eligibleTicketUserIds.length
  );
  const recomputedWinnerUserId = draw.eligibleTicketUserIds[recomputedWinnerIndex];

  return {
    valid:
      recomputedWinnerIndex === draw.winnerIndex &&
      recomputedWinnerUserId === draw.winnerUserId,
    recomputedWinnerIndex,
    recomputedWinnerUserId,
  };
}
