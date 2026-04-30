import express from "express";
import {
  getActiveCampaigns,
  getAllCampaigns,
  getCampaignsByBrand,
  getCampaignById,
  checkCampaignCompletion,
  submitCampaign,
  updateCampaign,
  deleteCampaign,
} from "../controllers/campaign.controller";
import { isAuthenticated } from "../utils/auth";

const router = express.Router();

// Get all campaigns
router.get("/campaigns", getAllCampaigns);

// Get active campaigns only
router.get("/campaigns/active", getActiveCampaigns);

// Get campaigns by brand ID
router.get("/campaigns/brand/:brandId", getCampaignsByBrand);

// Check if current user has completed a campaign
router.get(
  "/campaigns/:campaignId/completion",
  isAuthenticated,
  checkCampaignCompletion
);

// Get single campaign by campaign ID
router.get("/campaigns/:campaignId", getCampaignById);

// Submit campaign result
router.post("/campaigns/:campaignId/submit", isAuthenticated, submitCampaign);

// Update campaign
router.patch("/campaigns/:campaignId", isAuthenticated, updateCampaign);

// Delete campaign
router.delete("/campaigns/:campaignId", isAuthenticated, deleteCampaign);

export default router;
