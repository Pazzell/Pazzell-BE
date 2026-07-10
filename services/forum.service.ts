import ForumPostModel from "../models/forumPost.model";
import ForumLikeModel from "../models/forumLike.model";
import WinnerShareSubmissionModel from "../models/winnerShareSubmission.model";
import { awardPoints } from "./points/pointsLedger.service";
import { getWinnerShareBonusPoints } from "./config/config.service";

export class ForumError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function likePost(postId: string, userId: string): Promise<boolean> {
  try {
    await ForumLikeModel.create({ postId, userId });
  } catch (e: any) {
    if (e.code === 11000) return false; // already liked — no-op
    throw e;
  }
  await ForumPostModel.findByIdAndUpdate(postId, { $inc: { likeCount: 1 } });
  return true;
}

export async function unlikePost(postId: string, userId: string): Promise<boolean> {
  const result = await ForumLikeModel.deleteOne({ postId, userId });
  if (result.deletedCount === 0) return false;
  await ForumPostModel.findByIdAndUpdate(postId, { $inc: { likeCount: -1 } });
  return true;
}

/**
 * Admin verifies a winner-share submission — credits the flat bonus (config-
 * driven, default 5) into the currently-open week via the points ledger.
 * Idempotent: verifying an already-verified submission does not re-credit.
 */
export async function verifyWinnerShareSubmission(
  submissionId: string,
  adminReviewerId: string,
  adminNotes?: string
) {
  const submission = await WinnerShareSubmissionModel.findById(submissionId);
  if (!submission) throw new ForumError("Submission not found", 404);
  if (submission.status === "verified") return submission; // idempotent no-op
  if (submission.status === "rejected") {
    throw new ForumError("Cannot verify a previously rejected submission", 400);
  }

  const bonusPoints = await getWinnerShareBonusPoints();

  submission.status = "verified";
  submission.adminReviewerId = adminReviewerId;
  submission.adminNotes = adminNotes;
  submission.reviewedAt = new Date();
  submission.bonusPointsGranted = bonusPoints;
  await submission.save();

  await awardPoints({
    userId: submission.userId,
    points: bonusPoints,
    source: "winner_share_bonus",
    sourceRefId: String(submission._id),
    campaignId: submission.campaignId,
  });

  return submission;
}

export async function rejectWinnerShareSubmission(
  submissionId: string,
  adminReviewerId: string,
  adminNotes?: string
) {
  const submission = await WinnerShareSubmissionModel.findById(submissionId);
  if (!submission) throw new ForumError("Submission not found", 404);
  if (submission.status === "verified") {
    throw new ForumError("Cannot reject an already-verified submission", 400);
  }

  submission.status = "rejected";
  submission.adminReviewerId = adminReviewerId;
  submission.adminNotes = adminNotes;
  submission.reviewedAt = new Date();
  await submission.save();

  return submission;
}
