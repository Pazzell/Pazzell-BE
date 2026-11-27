import mongoose, { Document, Model, Schema } from "mongoose";

export type PaymentPurpose = "pro" | "campaign";
export type PaymentStatus = "pending" | "success" | "failed";

export interface IPayment extends Document {
  userId: string;
  purpose: PaymentPurpose;
  campaignId?: string; // purpose === "campaign"
  amount: number; // major units of `currency`, snapshotted from settings at checkout
  currency: string;
  durationDays: number; // snapshotted from settings at checkout
  gateway: "paystack";
  reference: string; // gateway reference
  status: PaymentStatus;
  // Caller-supplied key that makes "start checkout" safe to retry: the same key
  // returns the same pending payment instead of creating a second one.
  idempotencyKey: string;
  authorizationUrl?: string;
  paidAt?: Date; // confirmed payment time (from the gateway)
  // Set once the purchase has been applied (Pro extended / campaign activated).
  fulfilledAt?: Date;
  failureReason?: string;
  gatewayResponse?: any;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema: Schema<IPayment> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    purpose: { type: String, enum: ["pro", "campaign"], required: true },
    campaignId: { type: String, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    durationDays: { type: Number, required: true, min: 1 },
    gateway: { type: String, enum: ["paystack"], default: "paystack" },
    reference: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },
    idempotencyKey: { type: String, required: true, unique: true },
    authorizationUrl: { type: String },
    paidAt: { type: Date },
    fulfilledAt: { type: Date },
    failureReason: { type: String },
    gatewayResponse: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, purpose: 1, paidAt: -1 });

const PaymentModel: Model<IPayment> = mongoose.model("Payment", paymentSchema);
export default PaymentModel;
