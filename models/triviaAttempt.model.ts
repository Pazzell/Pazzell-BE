import mongoose, { Document, Model, Schema } from "mongoose";

export type TriviaSourceType = "topic" | "custom" | "campaign";
export type TriviaAttemptStatus = "quiz" | "completed" | "abandoned";

export interface ITriviaAttempt extends Document {
  userId: string;
  sourceType: TriviaSourceType;
  sourceId: string; // TriviaTopic / CustomQuiz / Campaign id
  sourceKey: string; // `${sourceType}:${sourceId}` — backs the one-active-attempt index
  // Owner/brand test play: not gated, and never counted in stats or the campaign counter.
  isPreview: boolean;
  // Practice mode: each question is served with its correct option marked.
  practice: boolean;
  timerSeconds: number;
  cardCount: number;
  status: TriviaAttemptStatus;
  active: boolean; // true while the quiz is in progress
  currentIndex: number; // quiz question the player is on
  correctCount: number;
  // Guards the freemium counter update so a completed attempt is counted exactly once.
  counterApplied: boolean;
  startedAt: Date;
  completedAt?: Date;
}

const triviaAttemptSchema: Schema<ITriviaAttempt> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    sourceType: { type: String, enum: ["topic", "custom", "campaign"], required: true },
    sourceId: { type: String, required: true },
    sourceKey: { type: String, required: true },
    isPreview: { type: Boolean, default: false },
    practice: { type: Boolean, default: false },
    timerSeconds: { type: Number, required: true },
    cardCount: { type: Number, required: true },
    status: {
      type: String,
      // "studying" is only on sessions started before the study step was removed;
      // they are moved to "quiz" the next time their player opens them.
      enum: ["studying", "quiz", "completed", "abandoned"],
      default: "quiz",
    },
    active: { type: Boolean, default: true },
    currentIndex: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    counterApplied: { type: Boolean, default: false },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

// One active attempt per user per topic / quiz / campaign.
triviaAttemptSchema.index(
  { userId: 1, sourceKey: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);
// Stats for a quiz or campaign
triviaAttemptSchema.index({ sourceKey: 1, status: 1, isPreview: 1 });
triviaAttemptSchema.index({ active: 1, startedAt: 1 });

const TriviaAttemptModel: Model<ITriviaAttempt> = mongoose.model(
  "TriviaAttempt",
  triviaAttemptSchema
);
export default TriviaAttemptModel;
