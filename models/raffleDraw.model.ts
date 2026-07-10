import mongoose, { Document, Model, Schema } from "mongoose";

export type RaffleDrawStatus = "pending" | "drawn" | "fulfilled" | "cancelled";

export interface IRaffleDraw extends Document {
  campaignId: string;
  weekKey: string;
  allTicketUserIds: string[]; // every ticket holder that week for this campaign (tickets bank regardless of eligibility)
  eligibleTicketUserIds: string[]; // subset that met the eligibility floor
  winnerUserId?: string;
  seed?: string; // crypto.randomBytes hex — stored so the draw can be independently re-verified
  winnerIndex?: number;
  status: RaffleDrawStatus;
  fulfillmentStatus?: string; // brand-managed, e.g. "pending" | "shipped" | "delivered"
  fulfillmentNotes?: string;
  drawnAt?: Date;
}

const raffleDrawSchema: Schema<IRaffleDraw> = new mongoose.Schema(
  {
    campaignId: { type: String, required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    allTicketUserIds: { type: [String], default: [] },
    eligibleTicketUserIds: { type: [String], default: [] },
    winnerUserId: { type: String },
    seed: { type: String },
    winnerIndex: { type: Number },
    status: {
      type: String,
      enum: ["pending", "drawn", "fulfilled", "cancelled"],
      default: "pending",
    },
    fulfillmentStatus: { type: String },
    fulfillmentNotes: { type: String },
    drawnAt: { type: Date },
  },
  { timestamps: true }
);

raffleDrawSchema.index({ campaignId: 1, weekKey: 1 }, { unique: true });

const RaffleDrawModel: Model<IRaffleDraw> = mongoose.model(
  "RaffleDraw",
  raffleDrawSchema
);
export default RaffleDrawModel;
