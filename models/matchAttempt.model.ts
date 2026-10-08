import mongoose, { Document, Model, Schema } from "mongoose";

export type MatchAttemptStatus = "in_progress" | "completed" | "abandoned";

export interface IMatchAttempt extends Document {
  userId: string;
  level: number;
  timerSeconds: number; // chosen by the player, applied to every question
  status: MatchAttemptStatus;
  active: boolean; // true while in_progress — backs the one-active-attempt index
  questionCount: number;
  currentIndex: number; // index of the question the player is on
  correctCount: number;
  passed: boolean;
  unlockedNextLevel: boolean;
  startedAt: Date;
  completedAt?: Date;
}

const matchAttemptSchema: Schema<IMatchAttempt> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    level: { type: Number, required: true },
    timerSeconds: { type: Number, required: true },
    status: {
      type: String,
      enum: ["in_progress", "completed", "abandoned"],
      default: "in_progress",
    },
    active: { type: Boolean, default: true },
    questionCount: { type: Number, required: true },
    currentIndex: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    unlockedNextLevel: { type: Boolean, default: false },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

// One active attempt per user per level.
matchAttemptSchema.index(
  { userId: 1, level: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);
matchAttemptSchema.index({ active: 1, startedAt: 1 });

const MatchAttemptModel: Model<IMatchAttempt> = mongoose.model(
  "MatchAttempt",
  matchAttemptSchema
);
export default MatchAttemptModel;
