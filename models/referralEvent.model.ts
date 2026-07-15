import mongoose, { Document, Model, Schema } from "mongoose";

export interface IReferralEvent extends Document {
  referrerId: string;
  referredUserId: string;
  eventType: "signup" | "first_puzzle" | "points_threshold_reached";
  eventAt: Date;
}

const referralEventSchema: Schema<IReferralEvent> = new mongoose.Schema(
  {
    referrerId: { type: String, required: true, index: true },
    referredUserId: { type: String, required: true, index: true },
    eventType: {
      type: String,
      // "first_puzzle" retained for historical rows written under the old
      // (pre points-threshold) referral model — new rows use
      // "points_threshold_reached" (see referral.service.ts checkReferralQualification).
      enum: ["signup", "first_puzzle", "points_threshold_reached"],
      required: true,
    },
    eventAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const ReferralEventModel: Model<IReferralEvent> = mongoose.model(
  "ReferralEvent",
  referralEventSchema
);
export default ReferralEventModel;
