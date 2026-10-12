import mongoose, { Document, Model, Schema } from "mongoose";

// draft -> live <-> unpublished. "locked" is applied automatically to a freemium
// owner's quizzes beyond the free limit (see services/customQuiz/quizLock.service.ts).
export type CustomQuizStatus = "draft" | "live" | "unpublished" | "locked";

export interface ICustomQuiz extends Document {
  ownerId: string;
  title: string;
  description?: string;
  coverImageUrl?: string;
  status: CustomQuizStatus;
  statusBeforeLock?: "draft" | "live" | "unpublished"; // restored when the lock lifts
  shareSlug?: string; // unguessable token; only resolves while status === "live"
  defaultTimerSeconds: number;
  defaultCardCount: number;
  deletedAt?: Date | null; // soft delete — deleted quizzes do not count toward the limit
  createdAt: Date;
  updatedAt: Date;
}

const customQuizSchema: Schema<ICustomQuiz> = new mongoose.Schema(
  {
    ownerId: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
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
  },
  { timestamps: true }
);

customQuizSchema.index({ ownerId: 1, deletedAt: 1, createdAt: 1 });
customQuizSchema.index(
  { shareSlug: 1 },
  { unique: true, partialFilterExpression: { shareSlug: { $type: "string" } } }
);

const CustomQuizModel: Model<ICustomQuiz> = mongoose.model(
  "CustomQuiz",
  customQuizSchema
);
export default CustomQuizModel;
