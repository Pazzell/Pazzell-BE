import express from "express";
import multer from "multer";
import {
  getActiveCampaigns,
  getAllCampaigns,
  getCampaignsByBrand,
  getCampaignById,
  checkCampaignCompletion,
  updateCampaign,
  deleteCampaign,
  generateCampaignQuestions,
} from "../controllers/campaign.controller";
import { isAuthenticated } from "../utils/auth";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Get all campaigns
router.get("/campaigns", getAllCampaigns);

// Get active campaigns only
router.get("/campaigns/active", getActiveCampaigns);

// Get campaigns by brand ID
router.get("/campaigns/brand/:brandId", getCampaignsByBrand);

// AI: generate 5 quiz questions from a brand passage (brand only)
router.post(
  "/campaigns/generate-questions",
  isAuthenticated,
  generateCampaignQuestions
);

// Check if current user has completed a campaign
router.get(
  "/campaigns/:campaignId/completion",
  isAuthenticated,
  checkCampaignCompletion
);

// Get single campaign by campaign ID
router.get("/campaigns/:campaignId", getCampaignById);

// Update campaign
router.patch("/campaigns/:campaignId", isAuthenticated, upload.single("image"), updateCampaign);

// Delete campaign
router.delete("/campaigns/:campaignId", isAuthenticated, deleteCampaign);

export default router;
