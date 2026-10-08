import mongoose, { Document, Model, Schema } from "mongoose";

export type QuestionOutcome = "correct" | "wrong" | "timeout";

// Server-held question. `correctOptionId` never leaves the server while the
// question is unanswered.
export interface IMatchQuestion extends Document {
  attemptId: string;
  index: number;
  targetId: string; // artifact shown at the top
  optionIds: string[]; // artifacts in the options box, already shuffled
  correctOptionId: string;
  servedAt?: Date; // when the question was first sent to the client
  deadlineAt?: Date; // servedAt + timerSeconds
  answeredAt?: Date;
  selectedOptionId?: string;
  outcome?: QuestionOutcome;
}

const matchQuestionSchema: Schema<IMatchQuestion> = new mongoose.Schema(
  {
    attemptId: { type: String, required: true },
    index: { type: Number, required: true },
    targetId: { type: String, required: true },
    optionIds: { type: [String], required: true },
    correctOptionId: { type: String, required: true },
    servedAt: { type: Date },
    deadlineAt: { type: Date },
    answeredAt: { type: Date },
    selectedOptionId: { type: String },
    outcome: { type: String, enum: ["correct", "wrong", "timeout"] },
  },
  { timestamps: true }
);

matchQuestionSchema.index({ attemptId: 1, index: 1 }, { unique: true });

const MatchQuestionModel: Model<IMatchQuestion> = mongoose.model(
  "MatchQuestion",
  matchQuestionSchema
);
export default MatchQuestionModel;
