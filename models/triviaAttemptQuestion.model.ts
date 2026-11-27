import mongoose, { Document, Model, Schema } from "mongoose";
import { ICardContent, cardContentFields } from "./cardFields";

export type QuestionOutcome = "correct" | "wrong" | "timeout";

// One row per selected card. The card content is snapshotted at session start, so
// editing or deleting a card in a live quiz cannot corrupt an attempt in progress.
export interface ITriviaAttemptQuestion extends Document {
  attemptId: string;
  quizIndex: number; // position in the quiz
  cardId: string;
  card: ICardContent; // snapshot, including the correct answer — server-side only
  optionOrder: number[]; // display position -> original option index, e.g. [2, 0, 3, 1]
  servedAt?: Date;
  deadlineAt?: Date;
  answeredAt?: Date;
  selectedOptionIndex?: number; // original option index the player chose
  outcome?: QuestionOutcome;
}

const triviaAttemptQuestionSchema: Schema<ITriviaAttemptQuestion> = new mongoose.Schema(
  {
    attemptId: { type: String, required: true },
    quizIndex: { type: Number, required: true },
    cardId: { type: String, required: true },
    card: { type: new Schema(cardContentFields, { _id: false }), required: true },
    optionOrder: { type: [Number], required: true },
    servedAt: { type: Date },
    deadlineAt: { type: Date },
    answeredAt: { type: Date },
    selectedOptionIndex: { type: Number },
    outcome: { type: String, enum: ["correct", "wrong", "timeout"] },
  },
  { timestamps: true }
);

triviaAttemptQuestionSchema.index({ attemptId: 1, quizIndex: 1 }, { unique: true });

const TriviaAttemptQuestionModel: Model<ITriviaAttemptQuestion> = mongoose.model(
  "TriviaAttemptQuestion",
  triviaAttemptQuestionSchema
);
export default TriviaAttemptQuestionModel;
