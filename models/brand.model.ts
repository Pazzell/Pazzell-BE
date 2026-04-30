import mongoose, { Document, Model, Schema } from "mongoose";
import "dotenv/config";

export interface IBrand extends Document {
  userId: string; // linked user
  companyEmail: string;
  companyName: string;
  verified: boolean;
  campaigns: string[]; // campaign ids (no restrictions on count)
  analytics: any;
}

const brandSchema: Schema<IBrand> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    companyEmail: { type: String, required: true },
    companyName: { type: String, required: true },
    verified: { type: Boolean, default: false },
    campaigns: [{ type: String }],
    analytics: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const BrandModel: Model<IBrand> = mongoose.model("Brand", brandSchema);
export default BrandModel;
