import mongoose, { Document, Model, Schema } from "mongoose";

export interface IForumLike extends Document {
  postId: string;
  userId: string;
}

const forumLikeSchema: Schema<IForumLike> = new mongoose.Schema(
  {
    postId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

forumLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

const ForumLikeModel: Model<IForumLike> = mongoose.model("ForumLike", forumLikeSchema);
export default ForumLikeModel;
