import mongoose, { Document, Model, Schema } from "mongoose";

// draft -> live <-> unpublished. "locked" is applied automatically to a freemium
// owner's quizzes beyond the free limit (see services/customQuiz/quizLock.service.ts).
export type CustomQuizStatus = "draft" | "live" | "unpublished" | "locked";
// "ai": an AI generated trivia, written from a topic and a prompt (services/aiTrivia).
// It is played by its owner only and stays outside the freemium quiz limit and its locks.
export type CustomQuizOrigin = "manual" | "ai";
export type AiReviewStatus = "pending" | "approved" | "rejected";
// "broadcast": shared with a link, each player plays alone and gets their own score.
// "team": hosted as a team game (services/teamGame), with no solo share link.
export type CustomQuizMode = "broadcast" | "team";
export const CUSTOM_QUIZ_MODES: CustomQuizMode[] = ["broadcast", "team"];

export interface ICustomQuiz extends Document {
  ownerId: string;
  title: string;
  mode: CustomQuizMode;
  description?: string;
  coverImageUrl?: string;
  status: CustomQuizStatus;
  statusBeforeLock?: "draft" | "live" | "unpublished"; // restored when the lock lifts
  shareSlug?: string; // unguessable token; only resolves while status === "live"
  defaultTimerSeconds: number;
  defaultCardCount: number;
  deletedAt?: Date | null; // soft delete — deleted quizzes do not count toward the limit
  origin: CustomQuizOrigin;
  // AI generated trivia only
  aiTopicId?: string; // the General Trivia topic it was written for, when one was chosen
  aiTopicName?: string;
  aiPrompt?: string;
  // An admin decides whether its cards also go into General Trivia.
  reviewStatus?: AiReviewStatus;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNote?: string;
  publishedTopicId?: string; // the topic the approved cards were copied into
  publishedCardCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

const customQuizSchema: Schema<ICustomQuiz> = new mongoose.Schema(
  {
    ownerId: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    mode: { type: String, enum: CUSTOM_QUIZ_MODES, default: "broadcast" },
    description: { type: String, maxlength: 300 },
    coverImageUrl: { type: String },
    status: {
      type: String,
      enum: ["draft", "live", "unpublished", "locked"],
      default: "draft",
    },
    statusBeforeLock: { type: String, enum: ["draft", "live", "unpublished"] },
    shareSlug: { type: String },
    defaultTimerSeconds: { type: Number, required: true },
    defaultCardCount: { type: Number, required: true },
    deletedAt: { type: Date, default: null },
    origin: { type: String, enum: ["manual", "ai"], default: "manual" },
    aiTopicId: { type: String },
    aiTopicName: { type: String, maxlength: 60 },
    aiPrompt: { type: String, maxlength: 500 },
    reviewStatus: { type: String, enum: ["pending", "approved", "rejected"] },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    reviewNote: { type: String, maxlength: 300 },
    publishedTopicId: { type: String },
    publishedCardCount: { type: Number },
  },
  { timestamps: true }
);

customQuizSchema.index({ ownerId: 1, deletedAt: 1, createdAt: 1 });
// The admin review queue
customQuizSchema.index({ origin: 1, reviewStatus: 1, createdAt: 1 });
customQuizSchema.index(
  { shareSlug: 1 },
  { unique: true, partialFilterExpression: { shareSlug: { $type: "string" } } }
);

const CustomQuizModel: Model<ICustomQuiz> = mongoose.model(
  "CustomQuiz",
  customQuizSchema
);
export default CustomQuizModel;
