import express from "express";
import {
  adminListTopics,
  adminCreateTopic,
  adminGetTopic,
  adminUpdateTopic,
  adminDeleteTopic,
  adminCreateCard,
  adminBulkCreateCards,
  adminUpdateCard,
  adminDeleteCard,
  adminListImportCategories,
  adminImportImageCards,
  adminListStarterTopics,
  adminLoadStarterTopics,
  adminGetGenerateInfo,
  adminGenerateCards,
} from "../controllers/trivia.controller";
import {
  listCampaigns,
  getCampaign,
  pauseCampaign,
  resumeCampaign,
  takeDownCampaign,
  getRevenueSummary,
  listPayments,
} from "../controllers/admin.controller";
import { isAuthenticated, authorizeRoles } from "../utils/auth";
import { imageUpload } from "../services/upload/image.service";
import { documentUploadMiddleware } from "../services/quizGen/extract";
import { generateLimiter } from "../middlewares/rateLimit";

const router = express.Router();

// Everything under /admin requires an authenticated admin, enforced here on the server.
// (Settings — prices, durations, the interruption threshold — are in routes/config.route.ts.)
router.use("/admin", isAuthenticated, authorizeRoles("admin"));

const image = imageUpload.single("image");

// Trivia topics and cards
router.get("/admin/trivia/topics", adminListTopics);
router.post("/admin/trivia/topics", image, adminCreateTopic);
router.get("/admin/trivia/topics/:id", adminGetTopic);
router.patch("/admin/trivia/topics/:id", image, adminUpdateTopic);
router.delete("/admin/trivia/topics/:id", adminDeleteTopic);
router.post("/admin/trivia/topics/:id/cards", image, adminCreateCard);
router.post("/admin/trivia/topics/:id/cards/bulk", adminBulkCreateCards);
router.patch("/admin/trivia/topics/:id/cards/:cardId", image, adminUpdateCard);
router.delete("/admin/trivia/topics/:id/cards/:cardId", adminDeleteCard);
// Image cards fetched from Wikidata / Wikimedia Commons
router.get("/admin/trivia/import/categories", adminListImportCategories);
router.post("/admin/trivia/import", adminImportImageCards);
// Built-in definition questions (scripts/seedData.ts)
router.get("/admin/trivia/starter", adminListStarterTopics);
router.post("/admin/trivia/starter", adminLoadStarterTopics);
// Draft definition cards written from an uploaded document; saved through the bulk endpoint
router.get("/admin/trivia/generate", adminGetGenerateInfo);
router.post("/admin/trivia/generate", generateLimiter, documentUploadMiddleware, adminGenerateCards);

// Campaign moderation
router.get("/admin/campaigns", listCampaigns);
router.get("/admin/campaigns/:id", getCampaign);
router.post("/admin/campaigns/:id/pause", pauseCampaign);
router.post("/admin/campaigns/:id/resume", resumeCampaign);
router.post("/admin/campaigns/:id/takedown", takeDownCampaign);

// Revenue
router.get("/admin/revenue", getRevenueSummary);
router.get("/admin/payments", listPayments);

export default router;
