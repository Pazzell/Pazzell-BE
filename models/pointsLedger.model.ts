import mongoose, { Document, Model, Schema } from "mongoose";

export type PointsSource =
  | "session_completion"
  | "referral_bonus"
  | "winner_share_bonus"
  | "admin_adjustment";

export interface IPointsLedgerEntry extends Document {
  userId: string;
  points: number;
  source: PointsSource;
  sourceRefId?: string; // e.g. GameSession _id, Referral _id, WinnerShareSubmission _id
  campaignId?: string;
  completionTimeMs?: number; // session_completion only — feeds the weekly avgTime tiebreaker
  weekKey: string;
}

const pointsLedgerSchema: Schema<IPointsLedgerEntry> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    points: { type: Number, required: true },
    source: {
      type: String,
      enum: [
        "session_completion",
        "referral_bonus",
        "winner_share_bonus",
        "admin_adjustment",
      ],
      required: true,
    },
    sourceRefId: { type: String },
    campaignId: { type: String, index: true },
    completionTimeMs: { type: Number },
    weekKey: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

pointsLedgerSchema.index({ userId: 1, weekKey: 1 });
pointsLedgerSchema.index({ weekKey: 1, source: 1 });

const PointsLedgerModel: Model<IPointsLedgerEntry> = mongoose.model(
  "PointsLedger",
  pointsLedgerSchema
);
export default PointsLedgerModel;
