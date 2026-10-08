import ErrorHandler from "../../utils/ErrorHandler";
import CampaignModel, { ICampaign } from "../../models/campaign.model";
import CampaignPlayModel from "../../models/campaignPlay.model";
import userModel from "../../models/user.model";
import { IPayment } from "../../models/payment.model";
import { getInterruptionThreshold } from "../config/config.service";
import { isExemptFromCampaignInterruptions } from "../plan/policy";

const DAY_MS = 24 * 60 * 60 * 1000;

type CampaignLike = Pick<ICampaign, "status" | "startsAt" | "endsAt">;

/**
 * On-read expiry guard: a campaign is only ever served while it is live AND inside
 * its paid window, whatever the scheduler has or has not done yet.
 */
export const isServable = (campaign: CampaignLike, now: Date = new Date()): boolean =>
  campaign.status === "live" &&
  !!campaign.startsAt &&
  !!campaign.endsAt &&
  campaign.startsAt.getTime() <= now.getTime() &&
  campaign.endsAt.getTime() > now.getTime();

const servableFilter = (now: Date) => ({
  status: "live",
  startsAt: { $lte: now },
  endsAt: { $gt: now },
});

/** Scheduler: marks campaigns whose paid window is over as ended. */
export async function expireCampaigns(now: Date = new Date()): Promise<number> {
  const result = await CampaignModel.updateMany(
    { status: { $in: ["live", "paused"] }, endsAt: { $lte: now } },
    { $set: { status: "ended" } }
  );
  return result.modifiedCount;
}

/**
 * Activates a campaign for a confirmed payment: it goes live at the payment time and
 * ends exactly `durationDays` later. The status guard makes this idempotent — a second
 * delivery of the same payment finds nothing to update.
 */
export async function activateCampaignFromPayment(payment: IPayment): Promise<void> {
  if (!payment.campaignId) return;
  const startsAt = payment.paidAt || new Date();
  await CampaignModel.updateOne(
    { _id: payment.campaignId, status: { $in: ["draft", "awaiting_payment"] } },
    {
      $set: {
        status: "live",
        paymentId: String(payment._id),
        startsAt,
        endsAt: new Date(startsAt.getTime() + payment.durationDays * DAY_MS),
      },
    }
  );
}

/** What a player may know about a campaign: brand identity, never the cards. */
export const publicCampaign = (campaign: any) => ({
  id: String(campaign._id),
  title: campaign.title,
  description: campaign.description || null,
  coverImageUrl: campaign.coverImageUrl || null,
  brandName: campaign.brandName,
  logoUrl: campaign.logoUrl,
  websiteUrl: campaign.websiteUrl,
  ctaText: campaign.ctaText || null,
  endsAt: campaign.endsAt || null,
});

/**
 * Fair rotation: the live campaign this player played least recently (never-played
 * first); ties go to the campaign that was served to anyone least recently.
 */
export async function pickCampaignForPlayer(
  userId: string,
  now: Date = new Date()
): Promise<ICampaign | null> {
  const live = await CampaignModel.find(servableFilter(now));
  if (live.length === 0) return null;

  const plays = await CampaignPlayModel.aggregate([
    { $match: { userId, campaignId: { $in: live.map((c) => String(c._id)) } } },
    { $group: { _id: "$campaignId", lastPlayedAt: { $max: "$createdAt" } } },
  ]);
  const lastPlayed = new Map<string, number>(
    plays.map((p) => [p._id, new Date(p.lastPlayedAt).getTime()])
  );

  const time = (d?: Date) => (d ? d.getTime() : 0);
  live.sort(
    (a, b) =>
      (lastPlayed.get(String(a._id)) || 0) - (lastPlayed.get(String(b._id)) || 0) ||
      time(a.lastServedAt) - time(b.lastServedAt) ||
      String(a._id).localeCompare(String(b._id))
  );
  return live[0];
}

type GateUser = { _id: any; proUntil?: Date | string | null; nonCampaignPlaysSinceCampaign?: number };

export interface CampaignGateState {
  required: boolean;
  counter: number;
  threshold: number;
  campaign: ReturnType<typeof publicCampaign> | null;
}

/**
 * The interruption rule. A freemium player owes a campaign trivia once they have
 * completed N non-campaign trivias since their last campaign. Pro players never owe
 * one, and nobody is blocked while no campaign is live.
 */
export async function getCampaignGateState(user: GateUser): Promise<CampaignGateState> {
  const threshold = await getInterruptionThreshold();
  const counter = user.nonCampaignPlaysSinceCampaign || 0;
  const open: CampaignGateState = { required: false, counter, threshold, campaign: null };

  if (isExemptFromCampaignInterruptions(user)) return open;
  if (counter < threshold) return open;

  const campaign = await pickCampaignForPlayer(String(user._id));
  if (!campaign) return open;
  return { required: true, counter, threshold, campaign: publicCampaign(campaign) };
}

/** Rejects the start of a non-campaign trivia session while a campaign is owed. */
export async function assertNoCampaignOwed(user: GateUser): Promise<void> {
  const gate = await getCampaignGateState(user);
  if (gate.required) {
    throw new ErrorHandler(
      "Play a sponsored trivia to keep going.",
      403,
      "CAMPAIGN_REQUIRED",
      { campaign: gate.campaign, counter: gate.counter, threshold: gate.threshold }
    );
  }
}

/** A completed non-campaign trivia moves a freemium player one step toward the gate. */
export async function countNonCampaignPlay(userId: string): Promise<void> {
  const user = await userModel.findById(userId).select("proUntil").lean();
  if (!user || isExemptFromCampaignInterruptions(user)) return;
  await userModel.updateOne({ _id: userId }, { $inc: { nonCampaignPlaysSinceCampaign: 1 } });
}

/** A completed campaign trivia clears the debt. */
export async function resetCampaignCounter(userId: string): Promise<void> {
  await userModel.updateOne({ _id: userId }, { $set: { nonCampaignPlaysSinceCampaign: 0 } });
}

export async function recordCampaignPlayStart(
  campaignId: string,
  userId: string,
  attemptId: string,
  total: number
): Promise<void> {
  await CampaignPlayModel.create({ campaignId, userId, attemptId, total });
  await CampaignModel.updateOne({ _id: campaignId }, { $set: { lastServedAt: new Date() } });
}

export async function recordCampaignPlayCompleted(
  attemptId: string,
  score: number,
  total: number
): Promise<void> {
  await CampaignPlayModel.updateOne(
    { attemptId },
    { $set: { completed: true, score, total, completedAt: new Date() } }
  );
}

/**
 * Counts a click on the brand URL and returns the URL to open. Only campaigns that
 * have actually run (live or ended) are countable.
 */
export async function recordUrlClick(campaignId: string, userId: string): Promise<string> {
  const campaign = await CampaignModel.findOneAndUpdate(
    { _id: campaignId, status: { $in: ["live", "ended"] } },
    { $inc: { urlClicks: 1 } },
    { new: true }
  );
  if (!campaign) throw new ErrorHandler("Campaign not found", 404, "CAMPAIGN_NOT_FOUND");

  const latestPlay = await CampaignPlayModel.findOne({ campaignId, userId }).sort({ createdAt: -1 });
  if (latestPlay && !latestPlay.clickedUrl) {
    latestPlay.clickedUrl = true;
    await latestPlay.save();
  }
  return campaign.websiteUrl;
}

/** Aggregate numbers for the brand dashboard. No per-player data is exposed. */
export async function getCampaignStats(campaign: ICampaign, now: Date = new Date()) {
  const campaignId = String(campaign._id);
  const [plays, completedAgg, uniqueClickers] = await Promise.all([
    CampaignPlayModel.countDocuments({ campaignId }),
    CampaignPlayModel.aggregate([
      { $match: { campaignId, completed: true, total: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          completions: { $sum: 1 },
          averageScore: { $avg: "$score" },
          averagePercent: { $avg: { $multiply: [{ $divide: ["$score", "$total"] }, 100] } },
        },
      },
    ]),
    CampaignPlayModel.countDocuments({ campaignId, clickedUrl: true }),
  ]);
  const completed = completedAgg[0];
  const running = isServable(campaign, now);

  return {
    status: campaign.status === "live" && !running ? "ended" : campaign.status,
    startsAt: campaign.startsAt || null,
    endsAt: campaign.endsAt || null,
    daysRemaining:
      running && campaign.endsAt
        ? Math.ceil((campaign.endsAt.getTime() - now.getTime()) / DAY_MS)
        : 0,
    plays,
    completions: completed?.completions || 0,
    averageScore: completed ? Math.round(completed.averageScore * 100) / 100 : null,
    averageScorePercent: completed ? Math.round(completed.averagePercent * 10) / 10 : null,
    urlClicks: campaign.urlClicks,
    uniqueUrlClickers: uniqueClickers,
  };
}
