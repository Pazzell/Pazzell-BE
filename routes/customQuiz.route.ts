import express from "express";
import {
  createQuiz,
  listMyQuizzes,
  getMyQuiz,
  updateQuiz,
  deleteQuiz,
  createCard,
  bulkCreateCards,
  updateCard,
  deleteCard,
  publishQuiz,
  unpublishQuiz,
  regenerateShareLink,
  revokeShareLink,
  getQuizStats,
  resolveShareLink,
  getShareLinkPlayInfo,
} from "../controllers/customQuiz.controller";
import { isAuthenticated } from "../utils/auth";
import { imageUpload } from "../services/upload/image.service";
import { linkResolveLimiter, writeLimiter } from "../middlewares/rateLimit";

const router = express.Router();
const image = imageUpload.single("image");

// Public share-link landing: title, creator and cover only — never the cards
router.get("/custom-quizzes/link/:slug", linkResolveLimiter, resolveShareLink);
router.get(
  "/custom-quizzes/link/:slug/play-info",
  isAuthenticated,
  linkResolveLimiter,
  getShareLinkPlayInfo
);

// Owner-only from here on (ownership is enforced in the controller for every :id)
router.post("/custom-quizzes", isAuthenticated, writeLimiter, image, createQuiz);
router.get("/custom-quizzes", isAuthenticated, listMyQuizzes);
router.get("/custom-quizzes/:id", isAuthenticated, getMyQuiz);
router.get("/custom-quizzes/:id/preview", isAuthenticated, getMyQuiz);
router.patch("/custom-quizzes/:id", isAuthenticated, writeLimiter, image, updateQuiz);
router.delete("/custom-quizzes/:id", isAuthenticated, deleteQuiz);

router.post("/custom-quizzes/:id/cards", isAuthenticated, writeLimiter, image, createCard);
router.post("/custom-quizzes/:id/cards/bulk", isAuthenticated, writeLimiter, bulkCreateCards);
router.patch("/custom-quizzes/:id/cards/:cardId", isAuthenticated, writeLimiter, image, updateCard);
router.delete("/custom-quizzes/:id/cards/:cardId", isAuthenticated, deleteCard);

router.post("/custom-quizzes/:id/publish", isAuthenticated, publishQuiz);
router.post("/custom-quizzes/:id/unpublish", isAuthenticated, unpublishQuiz);
router.post("/custom-quizzes/:id/share-link/regenerate", isAuthenticated, regenerateShareLink);
router.delete("/custom-quizzes/:id/share-link", isAuthenticated, revokeShareLink);
router.get("/custom-quizzes/:id/stats", isAuthenticated, getQuizStats);

export default router;
