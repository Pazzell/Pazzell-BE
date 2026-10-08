import ForumPostModel from "../models/forumPost.model";
import ForumLikeModel from "../models/forumLike.model";

export class ForumError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function likePost(postId: string, userId: string): Promise<boolean> {
  try {
    await ForumLikeModel.create({ postId, userId });
  } catch (e: any) {
    if (e.code === 11000) return false; // already liked — no-op
    throw e;
  }
  await ForumPostModel.findByIdAndUpdate(postId, { $inc: { likeCount: 1 } });
  return true;
}

export async function unlikePost(postId: string, userId: string): Promise<boolean> {
  const result = await ForumLikeModel.deleteOne({ postId, userId });
  if (result.deletedCount === 0) return false;
  await ForumPostModel.findByIdAndUpdate(postId, { $inc: { likeCount: -1 } });
  return true;
}
