import mongoose, { Document, Model, Schema } from "mongoose";
import { ICardContent, cardContentFields } from "./cardFields";

export interface ICampaignCard extends Document, ICardContent {
  campaignId: string;
}

const campaignCardSchema: Schema<ICampaignCard> = new mongoose.Schema(
  {
    campaignId: { type: String, required: true, index: true },
    ...cardContentFields,
  },
  { timestamps: true }
);

const CampaignCardModel: Model<ICampaignCard> = mongoose.model(
  "CampaignCard",
  campaignCardSchema
);
export default CampaignCardModel;
