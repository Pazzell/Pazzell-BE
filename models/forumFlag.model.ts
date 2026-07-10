import mongoose, { Document, Model, Schema } from "mongoose";

export type ForumFlagStatus = "open" | "resolved" | "dismissed";

export interface IForumFlag extends Document {
  postId: string;
  flaggedBy: string;
  reason: string;
  status: ForumFlagStatus;
}

const forumFlagSchema: Schema<IForumFlag> = new mongoose.Schema(
  {
    postId: { type: String, required: true, index: true },
    flaggedBy: { type: String, required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ["open", "resolved", "dismissed"], default: "open" },
  },
  { timestamps: true }
);

const ForumFlagModel: Model<IForumFlag> = mongoose.model("ForumFlag", forumFlagSchema);
export default ForumFlagModel;
