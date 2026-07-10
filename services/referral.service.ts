import mongoose from "mongoose";
import UserModel from "../models/user.model";
import ReferralModel from "../models/referral.model";
import ReferralEventModel from "../models/referralEvent.model";
import {
  getReferralPointsThreshold,
  getReferrerBonusPoints,
} from "./config/config.service";

/**
 * Resolves a referrer from a lookup string that may be a Mongo _id, a
 * username, or an email. Previously duplicated 3x inline in auth.controller.ts
 * (googleAuth, registerGamer, activateUser).
 */
export function findReferrer(refLookup: string) {
  const conditions: any[] = [{ username: refLookup }, { email: refLookup }];
  if (mongoose.isValidObjectId(refLookup))
    conditions.unshift({ _id: refLookup });
  return UserModel.findOne({ $or: conditions });
}

/**
 * Captures a referral relationship at signup time. Safe to call for every
 * signup path — swallows duplicate/invalid errors the same way the inline
 * implementations did (referredUserId is unique, so a second capture attempt
 * for the same user is a silent no-op).
 */
export async function captureReferralAtSignup(
  refLookup: string | undefined,
  newUserId: string
): Promise<void> {
  if (!refLookup) return;
  try {
    const refUser = await findReferrer(refLookup);
    if (!refUser || String(refUser._id) === String(newUserId)) return;

    await ReferralModel.create({
      referrerId: String(refUser._id),
      referredUserId: String(newUserId),
    });
    await ReferralEventModel.create({
      referrerId: String(refUser._id),
      referredUserId: String(newUserId),
      eventType: "signup",
    });
  } catch (e) {
    // ignore duplicate referral (unique index on referredUserId) or lookup errors
  }
}

/**
 * Called after every points-ledger award (see pointsLedger.service.ts
 * awardPoints). If `refereeUserId` has a pending referral and their lifetime
 * points have now crossed the configured threshold (default 21 — ~3 session
 * completions at 7pts each), credits the referrer's bonus points (default 5)
 * and marks the referral successful. A no-op if there's no pending referral
 * or the threshold hasn't been reached yet.
 */
export async function checkReferralQualification(
  refereeUserId: string
): Promise<void> {
  const referral = await ReferralModel.findOne({
    referredUserId: refereeUserId,
    successful: false,
  });
  if (!referral) return;

  // Lazy require to avoid a circular top-level import with pointsLedger.service.ts
  // (that module calls checkReferralQualification, this one calls its awardPoints/
  // getUserLifetimePoints — both are only invoked inside async function bodies,
  // well after both modules have finished loading, so this is safe).
  const {
    getUserLifetimePoints,
    awardPoints,
  } = require("./points/pointsLedger.service") as typeof import("./points/pointsLedger.service");

  const threshold = await getReferralPointsThreshold();
  const refereeTotal = await getUserLifetimePoints(refereeUserId);
  if (refereeTotal < threshold) return;

  const bonusPoints = await getReferrerBonusPoints();

  referral.successful = true;
  referral.successfulAt = new Date();
  referral.pointsAwarded = bonusPoints;
  await referral.save();

  await ReferralEventModel.create({
    referrerId: referral.referrerId,
    referredUserId: referral.referredUserId,
    eventType: "points_threshold_reached",
  });

  await awardPoints({
    userId: referral.referrerId,
    points: bonusPoints,
    source: "referral_bonus",
    sourceRefId: String(referral._id),
  });
}
