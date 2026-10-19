import crypto from "crypto";
import userModel from "../../models/user.model";
import TriviaAttemptModel, { ITriviaAttempt } from "../../models/triviaAttempt.model";
import { getPointsRules, PointsRules } from "../config/config.service";

// Player points. A completed quiz earns 1 point when it meets the rules an admin sets
// (`points.*` settings): enough cards, a high enough score, not a practice session unless
// practice is allowed to earn, and under the daily cap. With `points.setEarnsOnce` a set of
// questions earns once: practising it or missing a question does not use it up, but after
// it has earned, replaying it gives nothing; a different set can earn again.
//
// Days and months follow Lagos time. `lifetime` counts every point ever earned (the
// current month included); `monthly` counts the current month and starts again from 0
// when a month ends. The month end happens three ways, all giving the same numbers: the
// next award starts the new month, reads treat an old month as 0, and the monthly
// scheduler job resets every player at the turn of the month. So a late or missed
// scheduler run is harmless.

export const POINTS_TIMEZONE = "Africa/Lagos";

export interface PlayerPoints {
  month: string; // "YYYY-MM" (Lagos) the monthly score belongs to
  monthly: number;
  lifetime: number; // every point earned, this month included
  today: number; // points earned today (Lagos)
  dailyCap: number;
}

// Why a completed quiz earned no point.
export type NoPointReason =
  | "practice"
  | "score_too_low"
  | "too_few_cards"
  | "set_already_earned"
  | "daily_cap";

type StoredPoints = {
  month?: string | null;
  monthly?: number;
  lifetime?: number;
  day?: string | null;
  today?: number;
};
type PointsHolder = { points?: StoredPoints | null };

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: POINTS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day (Lagos) a moment falls in, as "YYYY-MM-DD". */
export function dayKey(at: Date = new Date()): string {
  return dayFormat.format(at);
}

/** The calendar month (Lagos) a moment falls in, as "YYYY-MM". */
export function monthKey(at: Date = new Date()): string {
  return dayKey(at).slice(0, 7);
}

/** Identifies a card set regardless of order, so a replay of the same cards is recognised. */
export function cardSetKey(sourceKey: string, cardIds: string[]): string {
  return crypto
    .createHash("sha256")
    .update(`${sourceKey}|${[...cardIds].sort().join(",")}`)
    .digest("hex");
}

/** A player's points as of `now`; an ended month or day counts as 0. */
export function pointsAt(
  user: PointsHolder | null | undefined,
  dailyCap: number,
  now: Date = new Date()
): PlayerPoints {
  const stored = user?.points || {};
  const month = monthKey(now);
  return {
    month,
    monthly: stored.month === month ? stored.monthly || 0 : 0,
    lifetime: stored.lifetime || 0,
    today: stored.day === dayKey(now) ? stored.today || 0 : 0,
    dailyCap,
  };
}

/** A player's points now, with the daily cap currently set. */
export async function readPoints(user: PointsHolder | null | undefined): Promise<PlayerPoints> {
  return pointsAt(user, (await getPointsRules()).dailyCap);
}

/** The rule that keeps a completed session from earning (the daily cap aside), or null. */
export async function ruleBlockingPoint(
  attempt: ITriviaAttempt,
  rules: PointsRules
): Promise<NoPointReason | null> {
  // Practice sessions show the answers.
  if (attempt.practice && !rules.practiceEarns) return "practice";
  // Whole-number comparison of correct/total against the required percent.
  if (attempt.cardCount <= 0 || attempt.correctCount * 100 < rules.minScorePercent * attempt.cardCount) {
    return "score_too_low";
  }
  if (attempt.cardCount < rules.minCards) return "too_few_cards";
  // Sessions started before card sets were recorded have no key and cannot be compared.
  if (!rules.setEarnsOnce || !attempt.cardSetKey) return null;
  const earnedBefore = await TriviaAttemptModel.exists({
    userId: attempt.userId,
    cardSetKey: attempt.cardSetKey,
    _id: { $ne: attempt._id },
    pointAwarded: true,
  });
  return earnedBefore ? "set_already_earned" : null;
}

/**
 * Adds 1 point for a quiz completed at `at`, unless the player already has `dailyCap`
 * points that day. One atomic update, so the cap holds under concurrent completions.
 * Returns false when the cap stopped it.
 */
export async function awardQuizPoint(
  userId: string,
  dailyCap: number,
  at: Date = new Date()
): Promise<boolean> {
  const month = monthKey(at);
  const day = dayKey(at);
  const sameMonth = { $eq: ["$points.month", month] };
  const sameDay = { $eq: ["$points.day", day] };
  const result = await userModel.updateOne(
    {
      _id: userId,
      $or: [{ "points.day": { $ne: day } }, { "points.today": { $lt: dailyCap } }],
    },
    [
      {
        $set: {
          "points.lifetime": { $add: [{ $ifNull: ["$points.lifetime", 0] }, 1] },
          "points.monthly": { $cond: [sameMonth, { $add: [{ $ifNull: ["$points.monthly", 0] }, 1] }, 1] },
          "points.month": month,
          "points.today": { $cond: [sameDay, { $add: [{ $ifNull: ["$points.today", 0] }, 1] }, 1] },
          "points.day": day,
        },
      },
    ]
  );
  return result.modifiedCount === 1;
}

/**
 * Decides and applies the point for a completed, non-preview session. Returns why it
 * earned nothing, or null when it earned the point.
 */
export async function settleQuizPoint(attempt: ITriviaAttempt): Promise<NoPointReason | null> {
  const rules = await getPointsRules();
  const blocked = await ruleBlockingPoint(attempt, rules);
  if (blocked) return blocked;
  const awarded = await awardQuizPoint(attempt.userId, rules.dailyCap, attempt.completedAt);
  return awarded ? null : "daily_cap";
}

/** Scheduler: starts the monthly score again from 0 for players whose month has ended. */
export async function rollOverMonthlyPoints(now: Date = new Date()): Promise<number> {
  const month = monthKey(now);
  const result = await userModel.updateMany(
    { "points.month": { $nin: [null, month] } },
    { $set: { "points.month": month, "points.monthly": 0 } }
  );
  return result.modifiedCount;
}
