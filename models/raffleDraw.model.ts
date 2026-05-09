import mongoose, { Document, Model, Schema } from "mongoose";

export interface IRaffleDraw extends Document {
  monthKey: string; // e.g., "2026-04"
  candidates: string[]; // userIds
  winner?: string; // userId
  amount: number;
  drawnAt?: Date;
}

const raffleDrawSchema: Schema<IRaffleDraw> = new mongoose.Schema(
  {
    monthKey: { type: String, required: true, index: true },
    candidates: { type: [String], default: [] },
    winner: { type: String },
    amount: { type: Number, required: true },
    drawnAt: { type: Date },
  },
  { timestamps: true }
);

raffleDrawSchema.index({ monthKey: 1 });

const RaffleDrawModel: Model<IRaffleDraw> = mongoose.model(
  "RaffleDraw",
  raffleDrawSchema
);
export default RaffleDrawModel;
