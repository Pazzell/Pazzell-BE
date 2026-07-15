import PointsLedgerModel, {
  IPointsLedgerEntry,
  PointsSource,
} from "../../models/pointsLedger.model";
import { getWeekKey } from "../../utils/weekBoundary";
import { checkReferralQualification } from "../referral.service";

export interface AwardPointsParams {
  userId: string;
  points: number;
  source: PointsSource;
  sourceRefId?: string;
  campaignId?: string;
  completionTimeMs?: number;
  at?: Date; // defaults to now — the week the points land in is derived from this
}

/**
 * Single write path for every point-earning event on the platform (session
 * completions, referral bonuses, forum winner-share bonuses, admin
 * adjustments) — one ledger, one aggregation, and weekKey is stamped at
 * write time so the weekly leaderboard reset is just "query bounded by
 * week" with no explicit reset step required.
 */
export async function awardPoints(
  params: AwardPointsParams
): Promise<IPointsLedgerEntry> {
  const weekKey = getWeekKey(params.at ?? new Date());
  const entry = await PointsLedgerModel.create({
    userId: params.userId,
    points: params.points,
    source: params.source,
    sourceRefId: params.sourceRefId,
    campaignId: params.campaignId,
    completionTimeMs: params.completionTimeMs,
    weekKey,
  });

  // Event-driven referral qualification check: if this user was referred and
  // has now crossed the points threshold, credit their referrer. Non-fatal —
  // a referral-side failure should never roll back the points that were just
  // legitimately earned.
  try {
    await checkReferralQualification(params.userId);
  } catch (e) {
    console.error("Referral qualification check failed:", e);
  }

  return entry;
}

/** Lifetime point total for a user across all sources — used by the referral
 * 21-point qualification check. */
export async function getUserLifetimePoints(userId: string): Promise<number> {
  const agg = await PointsLedgerModel.aggregate([
    { $match: { userId } },
    { $group: { _id: null, total: { $sum: "$points" } } },
  ]);
  return agg[0]?.total || 0;
}

export interface WeeklyPointsEntry {
  userId: string;
  points: number;
  avgCompletionTimeMs: number | null;
  sessionCompletions: number;
}

/**
 * Per-user point totals for a given week, plus the average completion time
 * computed ONLY from session_completion entries (i.e. first completions only —
 * replays never write a ledger entry, so this is automatically first-completion-only).
 */
export async function getWeeklyPointsAggregate(
  weekKey: string
): Promise<WeeklyPointsEntry[]> {
  const agg = await PointsLedgerModel.aggregate([
    { $match: { weekKey } },
    {
      $group: {
        _id: "$userId",
        points: { $sum: "$points" },
        avgCompletionTimeMs: {
          $avg: {
            $cond: [
              { $eq: ["$source", "session_completion"] },
              "$completionTimeMs",
              "$$REMOVE",
            ],
          },
        },
        sessionCompletions: {
          $sum: {
            $cond: [{ $eq: ["$source", "session_completion"] }, 1, 0],
          },
        },
      },
    },
  ]);

  return agg.map((a: any) => ({
    userId: a._id,
    points: a.points,
    avgCompletionTimeMs: a.avgCompletionTimeMs ?? null,
    sessionCompletions: a.sessionCompletions || 0,
  }));
}

/**
 * Per-user point totals across all time, plus average completion time from
 * session_completion entries only (first completions — replays never write
 * a ledger entry). Used by the all-time leaderboard.
 */
export async function getAllTimePointsAggregate(): Promise<WeeklyPointsEntry[]> {
  const agg = await PointsLedgerModel.aggregate([
    {
      $group: {
        _id: "$userId",
        points: { $sum: "$points" },
        avgCompletionTimeMs: {
          $avg: {
            $cond: [
              { $eq: ["$source", "session_completion"] },
              "$completionTimeMs",
              "$$REMOVE",
            ],
          },
        },
        sessionCompletions: {
          $sum: {
            $cond: [{ $eq: ["$source", "session_completion"] }, 1, 0],
          },
        },
      },
    },
  ]);

  return agg.map((a: any) => ({
    userId: a._id,
    points: a.points,
    avgCompletionTimeMs: a.avgCompletionTimeMs ?? null,
    sessionCompletions: a.sessionCompletions || 0,
  }));
}

/** Distinct campaigns a user completed (session_completion entries) within a week — used by the raffle eligibility floor. */
export async function getUserDistinctCampaignCompletionsInWeek(
  userId: string,
  weekKey: string
): Promise<string[]> {
  const rows = await PointsLedgerModel.distinct("campaignId", {
    userId,
    source: "session_completion",
    campaignId: { $ne: null },
    weekKey,
  });
  return rows as string[];
}
