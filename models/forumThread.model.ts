import mongoose, { Document, Model, Schema } from "mongoose";

export interface IForumThread extends Document {
  title: string;
  createdBy: string;
  category?: string;
  pinned: boolean;
  locked: boolean;
}

const forumThreadSchema: Schema<IForumThread> = new mongoose.Schema(
  {
    title: { type: String, required: true },
    createdBy: { type: String, required: true, index: true },
    category: { type: String },
    pinned: { type: Boolean, default: false },
    locked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

forumThreadSchema.index({ pinned: -1, createdAt: -1 });

const ForumThreadModel: Model<IForumThread> = mongoose.model(
  "ForumThread",
  forumThreadSchema
);
export default ForumThreadModel;
