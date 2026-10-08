import express from "express";
import {
  adminListLevels,
  adminUpsertLevel,
  adminDeleteLevel,
} from "../controllers/match.controller";
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

const router = express.Router();

// Everything under /admin requires an authenticated admin, enforced here on the server.
// (Settings — prices, durations, the interruption threshold — are in routes/config.route.ts.)
router.use("/admin", isAuthenticated, authorizeRoles("admin"));

const image = imageUpload.single("image");

// Match level configs
router.get("/admin/match/levels", adminListLevels);
router.put("/admin/match/levels/:level", adminUpsertLevel);
router.delete("/admin/match/levels/:level", adminDeleteLevel);

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
