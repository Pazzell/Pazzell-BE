import mongoose, { Document, Model, Schema } from "mongoose";

export type WinnerShareStatus = "submitted" | "verified" | "rejected";

export interface IWinnerShareSubmission extends Document {
  userId: string;
  campaignId: string;
  postUrl: string;
  claimedLikeCount?: number; // self-reported, not verified by the system
  status: WinnerShareStatus;
  adminReviewerId?: string;
  adminNotes?: string;
  reviewedAt?: Date;
  bonusPointsGranted?: number;
}

const winnerShareSubmissionSchema: Schema<IWinnerShareSubmission> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    campaignId: { type: String, required: true },
    postUrl: { type: String, required: true },
    claimedLikeCount: { type: Number },
    status: { type: String, enum: ["submitted", "verified", "rejected"], default: "submitted" },
    adminReviewerId: { type: String },
    adminNotes: { type: String },
    reviewedAt: { type: Date },
    bonusPointsGranted: { type: Number },
  },
  { timestamps: true }
);

const WinnerShareSubmissionModel: Model<IWinnerShareSubmission> = mongoose.model(
  "WinnerShareSubmission",
  winnerShareSubmissionSchema
);
export default WinnerShareSubmissionModel;
