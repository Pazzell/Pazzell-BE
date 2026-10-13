import mongoose, { Document, Model, Schema } from "mongoose";

export interface ITriviaTopic extends Document {
  name: string;
  slug: string;
  description?: string;
  coverImageUrl?: string;
  isActive: boolean;
  order: number;
  /** Share of a session's cards that are pictures; null uses the global setting. */
  imagePercent?: number | null;
  createdBy: string;
}

const triviaTopicSchema: Schema<ITriviaTopic> = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, unique: true },
    description: { type: String, maxlength: 300 },
    coverImageUrl: { type: String },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    imagePercent: { type: Number, min: 0, max: 100, default: null },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

triviaTopicSchema.index({ isActive: 1, order: 1, name: 1 });

const TriviaTopicModel: Model<ITriviaTopic> = mongoose.model(
  "TriviaTopic",
  triviaTopicSchema
);
export default TriviaTopicModel;
