import mongoose, { Document, Model, Schema } from "mongoose";

// One row per campaign trivia session a player starts — feeds the brand dashboard
// and the fair rotation (least recently played by this player first).
export interface ICampaignPlay extends Document {
  campaignId: string;
  userId: string;
  attemptId: string;
  completed: boolean;
  score: number; // correct answers
  total: number; // questions
  clickedUrl: boolean;
  completedAt?: Date;
  createdAt: Date;
}

const campaignPlaySchema: Schema<ICampaignPlay> = new mongoose.Schema(
  {
    campaignId: { type: String, required: true },
    userId: { type: String, required: true },
    attemptId: { type: String, required: true, unique: true },
    completed: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    clickedUrl: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

campaignPlaySchema.index({ campaignId: 1, completed: 1 });
campaignPlaySchema.index({ userId: 1, campaignId: 1, createdAt: -1 });

const CampaignPlayModel: Model<ICampaignPlay> = mongoose.model(
  "CampaignPlay",
  campaignPlaySchema
);
export default CampaignPlayModel;
