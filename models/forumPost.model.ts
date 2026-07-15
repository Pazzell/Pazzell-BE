import mongoose, { Document, Model, Schema } from "mongoose";

export type ForumModerationStatus = "visible" | "hidden" | "removed";

export interface IForumPost extends Document {
  threadId: string;
  userId: string;
  body: string;
  imageUrls?: string[];
  moderationStatus: ForumModerationStatus;
  likeCount: number; // cached counter, kept in sync by forum.service.ts like/unlike
}

const forumPostSchema: Schema<IForumPost> = new mongoose.Schema(
  {
    threadId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    body: { type: String, required: true, maxlength: 5000 },
    imageUrls: { type: [String], default: [] },
    moderationStatus: {
      type: String,
      enum: ["visible", "hidden", "removed"],
      default: "visible",
    },
    likeCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

forumPostSchema.index({ threadId: 1, createdAt: 1 });

const ForumPostModel: Model<IForumPost> = mongoose.model("ForumPost", forumPostSchema);
export default ForumPostModel;
