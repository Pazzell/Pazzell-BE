import express from "express";
import {
  createThread,
  listThreads,
  createPost,
  listPosts,
  likeForumPost,
  unlikeForumPost,
  flagForumPost,
  listFlags,
  resolveFlag,
} from "../controllers/forum.controller";
import { isAuthenticated, authorizeRoles } from "../utils/auth";

const router = express.Router();

router.post("/forum/threads", isAuthenticated, createThread);
router.get("/forum/threads", listThreads);

router.post("/forum/threads/:id/posts", isAuthenticated, createPost);
router.get("/forum/threads/:id/posts", listPosts);

router.post("/forum/posts/:id/like", isAuthenticated, likeForumPost);
router.delete("/forum/posts/:id/like", isAuthenticated, unlikeForumPost);
router.post("/forum/posts/:id/flag", isAuthenticated, flagForumPost);

router.get(
  "/forum/moderation/flags",
  isAuthenticated,
  authorizeRoles("admin"),
  listFlags
);
router.patch(
  "/forum/moderation/flags/:id",
  isAuthenticated,
  authorizeRoles("admin"),
  resolveFlag
);

export default router;
