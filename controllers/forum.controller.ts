import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import ForumThreadModel from "../models/forumThread.model";
import ForumPostModel from "../models/forumPost.model";
import ForumFlagModel from "../models/forumFlag.model";
import WinnerShareSubmissionModel from "../models/winnerShareSubmission.model";
import {
  likePost,
  unlikePost,
  verifyWinnerShareSubmission,
  rejectWinnerShareSubmission,
  ForumError,
} from "../services/forum.service";

function handleForumError(error: any, next: NextFunction) {
  if (error instanceof ForumError) {
    return next(new ErrorHandler(error.message, error.statusCode));
  }
  return next(new ErrorHandler(error.message || "Forum operation failed", 500));
}

// POST /forum/threads  { title, category? }
export const createThread = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { title, category } = req.body;
      if (!title || typeof title !== "string" || !title.trim()) {
        return next(new ErrorHandler("title is required", 400));
      }
      const thread = await ForumThreadModel.create({
        title: title.trim(),
        createdBy: userId,
        category,
      });
      res.status(201).json({ success: true, thread });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// GET /forum/threads
export const listThreads = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const threads = await ForumThreadModel.find({})
        .sort({ pinned: -1, createdAt: -1 })
        .lean();
      res.status(200).json({ success: true, threads });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// POST /forum/threads/:id/posts  { body, imageUrls? }
export const createPost = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { id: threadId } = req.params;
      const { body, imageUrls } = req.body;

      if (!body || typeof body !== "string" || !body.trim()) {
        return next(new ErrorHandler("body is required", 400));
      }

      const thread = await ForumThreadModel.findById(threadId);
      if (!thread) return next(new ErrorHandler("Thread not found", 404));
      if (thread.locked) return next(new ErrorHandler("This thread is locked", 400));

      const post = await ForumPostModel.create({
        threadId,
        userId,
        body: body.trim(),
        imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
      });
      res.status(201).json({ success: true, post });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// GET /forum/threads/:id/posts
export const listPosts = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id: threadId } = req.params;
      const posts = await ForumPostModel.find({
        threadId,
        moderationStatus: { $ne: "removed" },
      })
        .sort({ createdAt: 1 })
        .lean();
      res.status(200).json({ success: true, posts });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// POST /forum/posts/:id/like
export const likeForumPost = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { id: postId } = req.params;
      const liked = await likePost(postId, userId);
      res.status(200).json({ success: true, liked });
    } catch (error: any) {
      handleForumError(error, next);
    }
  }
);

// DELETE /forum/posts/:id/like
export const unlikeForumPost = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { id: postId } = req.params;
      const unliked = await unlikePost(postId, userId);
      res.status(200).json({ success: true, unliked });
    } catch (error: any) {
      handleForumError(error, next);
    }
  }
);

// POST /forum/posts/:id/flag  { reason }
export const flagForumPost = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { id: postId } = req.params;
      const { reason } = req.body;
      if (!reason) return next(new ErrorHandler("reason is required", 400));

      const flag = await ForumFlagModel.create({ postId, flaggedBy: userId, reason });
      res.status(201).json({ success: true, flag });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// GET /forum/moderation/flags?status=open (admin)
export const listFlags = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = (req.query.status as string) || "open";
      const flags = await ForumFlagModel.find({ status }).sort({ createdAt: -1 }).lean();
      res.status(200).json({ success: true, flags });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// PATCH /forum/moderation/flags/:id  { status, hidePost? } (admin)
export const resolveFlag = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { status, hidePost } = req.body;
      if (!status || !["resolved", "dismissed"].includes(status)) {
        return next(new ErrorHandler("status must be 'resolved' or 'dismissed'", 400));
      }

      const flag = await ForumFlagModel.findById(id);
      if (!flag) return next(new ErrorHandler("Flag not found", 404));

      flag.status = status;
      await flag.save();

      if (hidePost && status === "resolved") {
        await ForumPostModel.findByIdAndUpdate(flag.postId, {
          moderationStatus: "hidden",
        });
      }

      res.status(200).json({ success: true, flag });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// POST /forum/winner-submissions  { campaignId, postUrl, claimedLikeCount? }
export const createWinnerShareSubmission = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { campaignId, postUrl, claimedLikeCount } = req.body;
      if (!campaignId || !postUrl) {
        return next(new ErrorHandler("campaignId and postUrl are required", 400));
      }

      const submission = await WinnerShareSubmissionModel.create({
        userId,
        campaignId,
        postUrl,
        claimedLikeCount,
      });
      res.status(201).json({ success: true, submission });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// GET /forum/winner-submissions/mine
export const getMyWinnerShareSubmissions = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const submissions = await WinnerShareSubmissionModel.find({ userId })
        .sort({ createdAt: -1 })
        .lean();
      res.status(200).json({ success: true, submissions });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// GET /forum/winner-submissions?status=submitted (admin)
export const listWinnerShareSubmissions = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query.status as string | undefined;
      const filter = status ? { status } : {};
      const submissions = await WinnerShareSubmissionModel.find(filter)
        .sort({ createdAt: -1 })
        .lean();
      res.status(200).json({ success: true, submissions });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// POST /forum/winner-submissions/:id/verify  { adminNotes? } (admin)
export const verifySubmission = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminId = String(req.user!._id);
      const { id } = req.params;
      const { adminNotes } = req.body;
      const submission = await verifyWinnerShareSubmission(id, adminId, adminNotes);
      res.status(200).json({ success: true, submission });
    } catch (error: any) {
      handleForumError(error, next);
    }
  }
);

// POST /forum/winner-submissions/:id/reject  { adminNotes? } (admin)
export const rejectSubmission = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const adminId = String(req.user!._id);
      const { id } = req.params;
      const { adminNotes } = req.body;
      const submission = await rejectWinnerShareSubmission(id, adminId, adminNotes);
      res.status(200).json({ success: true, submission });
    } catch (error: any) {
      handleForumError(error, next);
    }
  }
);
