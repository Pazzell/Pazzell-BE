import mongoose, { Document, Model, Schema } from "mongoose";
import { ICardContent, cardContentFields } from "./cardFields";

export interface ICustomQuizCard extends Document, ICardContent {
  quizId: string;
}

const customQuizCardSchema: Schema<ICustomQuizCard> = new mongoose.Schema(
  {
    quizId: { type: String, required: true, index: true },
    ...cardContentFields,
  },
  { timestamps: true }
);

const CustomQuizCardModel: Model<ICustomQuizCard> = mongoose.model(
  "CustomQuizCard",
  customQuizCardSchema
);
export default CustomQuizCardModel;
