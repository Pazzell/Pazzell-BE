import mongoose, { Document, Model, Schema } from "mongoose";

export interface IInstantParticipant {
  userId: string;
  joinedAt: Date;
  timeTaken?: number;
  movesTaken?: number;
  submitted?: boolean;
  rank?: number;
}

export interface IInstantEvent extends Document {
  title: string;
  campaignId: string;
  startAt: Date;
  endAt: Date;
  participants: IInstantParticipant[];
  status: "pending" | "running" | "finished";
}

const instantEventSchema: Schema<IInstantEvent> = new mongoose.Schema(
  {
    title: { type: String, required: true },
    campaignId: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    participants: [
      {
        userId: { type: String, required: true },
        joinedAt: { type: Date, required: true },
        timeTaken: { type: Number },
        movesTaken: { type: Number },
        submitted: { type: Boolean, default: false },
        rank: { type: Number },
      },
    ],
    status: {
      type: String,
      enum: ["pending", "running", "finished"],
      default: "pending",
    },
  },
  { timestamps: true }
);

instantEventSchema.index({ startAt: 1, endAt: 1 });

const InstantEventModel: Model<IInstantEvent> = mongoose.model(
  "InstantEvent",
  instantEventSchema
);

export default InstantEventModel;
