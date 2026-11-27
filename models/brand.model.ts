import mongoose, { Document, Model, Schema } from "mongoose";
import "dotenv/config";

export interface IBrand extends Document {
  userId: string; // linked user
  companyEmail: string;
  companyName: string; // the brand name shown to players
  logoUrl?: string;
  websiteUrl?: string; // http(s) only — see utils/validators.ts
  verified: boolean;
}

const brandSchema: Schema<IBrand> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    companyEmail: { type: String, required: true },
    companyName: { type: String, required: true },
    logoUrl: { type: String },
    websiteUrl: { type: String },
    verified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const BrandModel: Model<IBrand> = mongoose.model("Brand", brandSchema);
export default BrandModel;
