"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const campaign_controller_1 = require("../controllers/campaign.controller");
const auth_1 = require("../utils/auth");
const router = express_1.default.Router();
// Get all campaigns
router.get("/campaigns", campaign_controller_1.getAllCampaigns);
// Get active campaigns only
router.get("/campaigns/active", campaign_controller_1.getActiveCampaigns);
// Get campaigns by brand ID
router.get("/campaigns/brand/:brandId", campaign_controller_1.getCampaignsByBrand);
// Check if current user has completed a campaign
router.get("/campaigns/:campaignId/completion", auth_1.isAuthenticated, campaign_controller_1.checkCampaignCompletion);
// Get single campaign by campaign ID
router.get("/campaigns/:campaignId", campaign_controller_1.getCampaignById);
// Submit campaign result
router.post("/campaigns/:campaignId/submit", auth_1.isAuthenticated, campaign_controller_1.submitCampaign);
// Update campaign
router.patch("/campaigns/:campaignId", auth_1.isAuthenticated, campaign_controller_1.updateCampaign);
// Delete campaign
router.delete("/campaigns/:campaignId", auth_1.isAuthenticated, campaign_controller_1.deleteCampaign);
exports.default = router;
