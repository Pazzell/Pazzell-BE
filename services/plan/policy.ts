import ErrorHandler from "../../utils/ErrorHandler";
import CustomQuizModel from "../../models/customQuiz.model";
import { getCustomQuizFreeLimit, getProPricing } from "../config/config.service";
import { getPlan } from "./plan.service";

// Every Pro-gated rule lives in this file. Controllers and services ask these
// helpers; they do not compare proUntil themselves.

type PlanUser = { _id: any; proUntil?: Date | string | null };

/** Pro benefit (a): Pro players are never interrupted by campaign trivia. */
export function isExemptFromCampaignInterruptions(user: PlanUser): boolean {
  return getPlan(user).isPro;
}

/**
 * Pro benefit (b): unlimited custom trivias. Freemium players may own
 * `customQuiz.freeLimit` (default 1) non-deleted quizzes.
 */
export async function assertCanCreateCustomQuiz(user: PlanUser): Promise<void> {
  if (getPlan(user).isPro) return;

  const limit = await getCustomQuizFreeLimit();
  const current = await CustomQuizModel.countDocuments({
    ownerId: String(user._id),
    deletedAt: null,
  });
  if (current >= limit) {
    const pro = await getProPricing();
    throw new ErrorHandler(
      `Freemium accounts can create ${limit} custom trivia. Upgrade to Pro for unlimited.`,
      403,
      "UPGRADE_REQUIRED",
      { feature: "custom_quiz", limit, current, pro }
    );
  }
}
