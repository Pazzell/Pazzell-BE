import ProSubscriptionModel, { IProSubscription } from "../../models/proSubscription.model";
import userModel from "../../models/user.model";
import { IPayment } from "../../models/payment.model";
import { syncQuizLocks } from "../customQuiz/quizLock.service";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanTier = "freemium" | "pro";

export interface Plan {
  tier: PlanTier;
  isPro: boolean;
  proUntil: Date | null;
}

/**
 * The single source of truth for a player's tier. Pro is active only while
 * proUntil > now; it is computed on every call and never read from the client.
 */
export function getPlan(
  user: { proUntil?: Date | string | null } | null | undefined,
  now: Date = new Date()
): Plan {
  const proUntil = user?.proUntil ? new Date(user.proUntil) : null;
  const isPro = !!proUntil && proUntil.getTime() > now.getTime();
  return { tier: isPro ? "pro" : "freemium", isPro, proUntil: isPro ? proUntil : null };
}

/**
 * End of the Pro period implied by the full payment history: each period starts at
 * its own startsAt, or at the end of the previous period if that is later. Chaining
 * (rather than taking the latest endsAt) keeps two renewals that were processed at
 * the same moment from overlapping and losing days.
 */
function chainEnd(subscriptions: Pick<IProSubscription, "startsAt" | "durationDays">[]): Date | null {
  let end: number | null = null;
  for (const sub of subscriptions) {
    const start = Math.max(end ?? 0, sub.startsAt.getTime());
    end = start + sub.durationDays * DAY_MS;
  }
  return end === null ? null : new Date(end);
}

/**
 * Applies a successful Pro payment. Safe to call any number of times for the same
 * payment: ProSubscription.paymentId is unique, so the period is recorded once and
 * proUntil is recomputed from the history rather than incremented.
 *
 * - Renewing while still Pro extends from the current proUntil.
 * - Renewing after expiry starts from the payment time.
 */
export async function applyProPayment(payment: IPayment): Promise<{ proUntil: Date }> {
  const userId = String(payment.userId);
  const paymentId = String(payment._id);
  const paidAt = payment.paidAt || new Date();

  const existing = await ProSubscriptionModel.findOne({ paymentId });
  if (!existing) {
    const user = await userModel.findById(userId).select("proUntil").lean();
    const currentEnd = user?.proUntil ? new Date(user.proUntil) : null;
    const startsAt = currentEnd && currentEnd.getTime() > paidAt.getTime() ? currentEnd : paidAt;
    try {
      await ProSubscriptionModel.create({
        userId,
        paymentId,
        paidAt,
        startsAt,
        endsAt: new Date(startsAt.getTime() + payment.durationDays * DAY_MS),
        durationDays: payment.durationDays,
      });
    } catch (e: any) {
      // A concurrent delivery of the same payment recorded it first — nothing to add.
      if (e.code !== 11000) throw e;
    }
  }

  const history = await ProSubscriptionModel.find({ userId })
    .sort({ startsAt: 1, paidAt: 1, _id: 1 })
    .lean();
  const proUntil = chainEnd(history)!;

  await userModel.updateOne({ _id: userId }, { $set: { proUntil } });
  await syncQuizLocks(userId);

  return { proUntil };
}

export async function listProSubscriptions(userId: string) {
  return ProSubscriptionModel.find({ userId }).sort({ paidAt: -1 }).lean();
}
