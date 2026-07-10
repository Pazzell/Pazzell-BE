import mongoose, { Document, Model, Schema } from "mongoose";

export interface IReferral extends Document {
  referrerId: string;
  referredUserId: string;
  referredAt: Date;
  // becomes true once the referred user's lifetime points cross the
  // configured threshold (referral.pointsThreshold, default 21 — i.e. ~3
  // session completions at 7pts each). See referral.service.ts
  // checkReferralQualification, called after every points-ledger award.
  successful: boolean;
  successfulAt?: Date;
  pointsAwarded: number; // points credited to the referrer once successful (config-driven, default 5)
}

const referralSchema: Schema<IReferral> = new mongoose.Schema(
  {
    referrerId: { type: String, required: true, index: true },
    referredUserId: { type: String, required: true, index: true, unique: true },
    referredAt: { type: Date, default: Date.now },
    successful: { type: Boolean, default: false },
    successfulAt: { type: Date },
    pointsAwarded: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// `referrerId` already has `index: true` in the field definition above.
// Avoid duplicate index declaration to prevent Mongoose duplicate index warnings.

const ReferralModel: Model<IReferral> = mongoose.model(
  "Referral",
  referralSchema
);
export default ReferralModel;
