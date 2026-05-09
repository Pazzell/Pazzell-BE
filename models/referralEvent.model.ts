import mongoose, { Document, Model, Schema } from "mongoose";

export interface IReferralEvent extends Document {
  referrerId: string;
  referredUserId: string;
  eventType: "signup" | "first_puzzle";
  eventAt: Date;
}

const referralEventSchema: Schema<IReferralEvent> = new mongoose.Schema(
  {
    referrerId: { type: String, required: true, index: true },
    referredUserId: { type: String, required: true, index: true },
    eventType: {
      type: String,
      enum: ["signup", "first_puzzle"],
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
