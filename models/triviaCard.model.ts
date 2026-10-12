import mongoose, { Document, Model, Schema } from "mongoose";
import { ICardContent, cardContentFields } from "./cardFields";

export interface ITriviaCard extends Document, ICardContent {
  topicId: string;
  // Set on cards fetched from an API (see services/trivia/imageImport.service.ts);
  // absent on cards an admin made by hand.
  source?: string;
  sourceRef?: string; // the source's own id for the subject, e.g. a Wikidata id
}

const triviaCardSchema: Schema<ITriviaCard> = new mongoose.Schema(
  {
    topicId: { type: String, required: true, index: true },
    ...cardContentFields,
    source: { type: String },
    sourceRef: { type: String },
  },
  { timestamps: true }
);

// A subject is imported into a topic only once.
triviaCardSchema.index(
  { topicId: 1, sourceRef: 1 },
  { unique: true, partialFilterExpression: { sourceRef: { $type: "string" } } }
);

const TriviaCardModel: Model<ITriviaCard> = mongoose.model(
  "TriviaCard",
  triviaCardSchema
);
export default TriviaCardModel;
