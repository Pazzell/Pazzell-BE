import mongoose, { Document, Model, Schema } from "mongoose";

export interface IPackage extends Document {
  name: string;
  amount: number;
  priority: number; // higher priority = shown first (premium > basic)
  description?: string;
  isActive: boolean;
}

const packageSchema: Schema<IPackage> = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    priority: { type: Number, required: true }, // higher = shown first
    description: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const PackageModel: Model<IPackage> = mongoose.model("Package", packageSchema);
export default PackageModel;
