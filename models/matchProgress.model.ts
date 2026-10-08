import mongoose, { Document, Model, Schema } from "mongoose";

export interface IMatchLevelProgress {
  level: number;
  attempts: number;
  bestCorrect: number;
  bestTotal: number;
  passed: boolean;
  lastPlayedAt?: Date;
}

export interface IMatchProgress extends Document {
  userId: string;
  highestUnlockedLevel: number;
  levels: IMatchLevelProgress[];
}

const levelProgressSchema = new Schema<IMatchLevelProgress>(
  {
    level: { type: Number, required: true },
    attempts: { type: Number, default: 0 },
    bestCorrect: { type: Number, default: 0 },
    bestTotal: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    lastPlayedAt: { type: Date },
  },
  { _id: false }
);

const matchProgressSchema: Schema<IMatchProgress> = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    highestUnlockedLevel: { type: Number, default: 1, min: 1 },
    levels: { type: [levelProgressSchema], default: [] },
  },
  { timestamps: true }
);

const MatchProgressModel: Model<IMatchProgress> = mongoose.model(
  "MatchProgress",
  matchProgressSchema
);
export default MatchProgressModel;
