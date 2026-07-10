import mongoose, { Document, Model, Schema } from "mongoose";

export interface IRaffleTicket extends Document {
  userId: string;
  campaignId: string;
  weekKey: string; // the week the player's first completion (that minted this ticket) happened
  sourceSessionId: string;
}

const raffleTicketSchema: Schema<IRaffleTicket> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    campaignId: { type: String, required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    sourceSessionId: { type: String, required: true },
  },
  { timestamps: true }
);

// One ticket ever per player per campaign — minted only on first completion,
// never on replays.
raffleTicketSchema.index({ userId: 1, campaignId: 1 }, { unique: true });
raffleTicketSchema.index({ campaignId: 1, weekKey: 1 });

const RaffleTicketModel: Model<IRaffleTicket> = mongoose.model(
  "RaffleTicket",
  raffleTicketSchema
);
export default RaffleTicketModel;
