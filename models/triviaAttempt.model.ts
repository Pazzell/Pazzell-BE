import mongoose, { Document, Model, Schema } from "mongoose";

export type TriviaSourceType = "topic" | "custom" | "campaign";
export type TriviaAttemptStatus = "studying" | "quiz" | "completed" | "abandoned";

export interface ITriviaAttempt extends Document {
  userId: string;
  sourceType: TriviaSourceType;
  sourceId: string; // TriviaTopic / CustomQuiz / Campaign id
  sourceKey: string; // `${sourceType}:${sourceId}` — backs the one-active-attempt index
  // Owner/brand test play: not gated, and never counted in stats or the campaign counter.
  isPreview: boolean;
  timerSeconds: number;
  cardCount: number;
  status: TriviaAttemptStatus;
  active: boolean; // true while studying or in quiz
  currentIndex: number; // quiz question the player is on
  correctCount: number;
  // Guards the freemium counter update so a completed attempt is counted exactly once.
  counterApplied: boolean;
  startedAt: Date;
  quizStartedAt?: Date;
  completedAt?: Date;
}

const triviaAttemptSchema: Schema<ITriviaAttempt> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    sourceType: { type: String, enum: ["topic", "custom", "campaign"], required: true },
    sourceId: { type: String, required: true },
    sourceKey: { type: String, required: true },
    isPreview: { type: Boolean, default: false },
    timerSeconds: { type: Number, required: true },
    cardCount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["studying", "quiz", "completed", "abandoned"],
      default: "studying",
    },
    active: { type: Boolean, default: true },
    currentIndex: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    counterApplied: { type: Boolean, default: false },
    startedAt: { type: Date, default: Date.now },
    quizStartedAt: { type: Date },
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
