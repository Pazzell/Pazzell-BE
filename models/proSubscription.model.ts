import mongoose, { Document, Model, Schema } from "mongoose";

// One row per successful Pro payment — the history that User.proUntil is derived from.
export interface IProSubscription extends Document {
  userId: string;
  paymentId: string;
  paidAt: Date;
  startsAt: Date; // paidAt, or the previous proUntil when renewing while still Pro
  endsAt: Date;
  durationDays: number;
}

const proSubscriptionSchema: Schema<IProSubscription> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    // Unique: a payment can never produce two subscription periods.
    paymentId: { type: String, required: true, unique: true },
    paidAt: { type: Date, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    durationDays: { type: Number, required: true },
  },
  { timestamps: true }
);

proSubscriptionSchema.index({ userId: 1, paidAt: 1 });

const ProSubscriptionModel: Model<IProSubscription> = mongoose.model(
  "ProSubscription",
  proSubscriptionSchema
);
export default ProSubscriptionModel;
