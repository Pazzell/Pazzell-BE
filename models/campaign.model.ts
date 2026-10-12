import mongoose, { Document, Model, Schema } from "mongoose";

// draft -> awaiting_payment -> live -> ended, plus paused / taken_down set by an admin.
export type CampaignStatus =
  | "draft"
  | "awaiting_payment"
  | "live"
  | "ended"
  | "paused"
  | "taken_down";

export interface ICampaign extends Document {
  brandId: string; // the brand's user id
  brandName: string;
  logoUrl: string;
  websiteUrl: string;
  ctaText?: string;
  title: string;
  description?: string;
  coverImageUrl?: string;
  tags: string[];
  status: CampaignStatus;
  paymentId?: string;
  startsAt?: Date; // the confirmed payment time
  endsAt?: Date; // startsAt + the campaign duration
  moderationReason?: string; // why an admin paused / took it down
  moderatedBy?: string;
  moderatedAt?: Date;
  lastServedAt?: Date; // rotation tie-breaker across live campaigns
  urlClicks: number;
  createdAt: Date;
  updatedAt: Date;
}

const campaignSchema: Schema<ICampaign> = new mongoose.Schema(
  {
    brandId: { type: String, required: true },
    brandName: { type: String, required: true, trim: true, maxlength: 80 },
    logoUrl: { type: String, required: true },
    websiteUrl: { type: String, required: true },
    ctaText: { type: String, maxlength: 40 },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, maxlength: 300 },
    coverImageUrl: { type: String },
    tags: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["draft", "awaiting_payment", "live", "ended", "paused", "taken_down"],
      default: "draft",
    },
    paymentId: { type: String },
    startsAt: { type: Date },
    endsAt: { type: Date },
    moderationReason: { type: String, maxlength: 500 },
    moderatedBy: { type: String },
    moderatedAt: { type: Date },
    lastServedAt: { type: Date },
    urlClicks: { type: Number, default: 0 },
  },
  { timestamps: true }
);

campaignSchema.index({ brandId: 1, createdAt: -1 });
// Delivery and expiry: live campaigns by end date
campaignSchema.index({ status: 1, endsAt: 1 });

const CampaignModel: Model<ICampaign> = mongoose.model("Campaign", campaignSchema);
export default CampaignModel;
