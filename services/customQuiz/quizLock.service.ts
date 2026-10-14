import CustomQuizModel from "../../models/customQuiz.model";
import userModel from "../../models/user.model";
import { getCustomQuizFreeLimit } from "../config/config.service";

const isProAt = (proUntil: Date | string | null | undefined, now: Date) =>
  !!proUntil && new Date(proUntil).getTime() > now.getTime();

/**
 * Brings the owner's custom quizzes in line with their current plan.
 *
 * Freemium: the oldest non-deleted quizzes up to the free limit stay as they are;
 * every other one is locked (its share link stops resolving, nothing is deleted, the
 * owner can still view and edit it). Pro: every locked quiz returns to the status it
 * had before it was locked.
 */
export async function syncQuizLocks(userId: string, now: Date = new Date()): Promise<void> {
  const user = await userModel.findById(userId).select("proUntil").lean();
  if (!user) return;
  const isPro = isProAt(user.proUntil, now);
  const freeLimit = await getCustomQuizFreeLimit();

  // AI generated trivia is not part of the limit: its owner keeps playing it after Pro ends.
  const quizzes = await CustomQuizModel.find({
    ownerId: userId,
    deletedAt: null,
    origin: { $ne: "ai" },
  })
    .sort({ createdAt: 1, _id: 1 })
    .select("status statusBeforeLock");

  for (let i = 0; i < quizzes.length; i++) {
    const quiz = quizzes[i];
    const allowed = isPro || i < freeLimit;
    if (allowed && quiz.status === "locked") {
      quiz.status = quiz.statusBeforeLock || "unpublished";
      quiz.statusBeforeLock = undefined;
      await quiz.save();
    } else if (!allowed && quiz.status !== "locked") {
      quiz.statusBeforeLock = quiz.status;
      quiz.status = "locked";
      await quiz.save();
    }
  }

  await userModel.updateOne({ _id: userId }, { $set: { quizLocksSyncedAsPro: isPro } });
}

/**
 * On-read guard: re-applies the locks when the owner's plan has changed since they
 * were last applied (typically Pro expiring), so a late scheduler can never leave an
 * over-limit quiz playable.
 */
export async function ensureQuizLocks(userId: string, now: Date = new Date()): Promise<void> {
  const user = await userModel.findById(userId).select("proUntil quizLocksSyncedAsPro").lean();
  if (!user) return;
  if (isProAt(user.proUntil, now) !== !!user.quizLocksSyncedAsPro) {
    await syncQuizLocks(userId, now);
  }
}

/** Scheduled sweep: lock the extra quizzes of every user whose Pro plan has lapsed. */
export async function lockQuizzesForExpiredPro(now: Date = new Date()): Promise<number> {
  const lapsed = await userModel
    .find({ quizLocksSyncedAsPro: true, proUntil: { $lte: now } })
    .select("_id")
    .lean();
  for (const user of lapsed) {
    await syncQuizLocks(String(user._id), now);
  }
  return lapsed.length;
}
