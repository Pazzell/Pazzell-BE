import mongoose, { Document, Model, Schema } from "mongoose";
import { ICardContent, cardContentFields } from "./cardFields";

export interface ITriviaCard extends Document, ICardContent {
  topicId: string;
}

const triviaCardSchema: Schema<ITriviaCard> = new mongoose.Schema(
  {
    topicId: { type: String, required: true, index: true },
    ...cardContentFields,
  },
  { timestamps: true }
);

const TriviaCardModel: Model<ITriviaCard> = mongoose.model(
  "TriviaCard",
  triviaCardSchema
);
export default TriviaCardModel;
