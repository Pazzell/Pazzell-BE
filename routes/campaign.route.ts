import express from "express";
import {
  getPricing,
  createCampaign,
  listMyCampaigns,
  getMyCampaign,
  updateCampaign,
  deleteCampaign,
  createCard,
  bulkCreateCards,
  updateCard,
  deleteCard,
  startCampaignCheckout,
  cancelCampaignCheckout,
  getDashboard,
  getNextCampaign,
  getCampaignInfo,
  postUrlClick,
} from "../controllers/campaign.controller";
import { isAuthenticated, authorizeRoles } from "../utils/auth";
import { imageUpload } from "../services/upload/image.service";
import { checkoutLimiter, clickLimiter, writeLimiter } from "../middlewares/rateLimit";

const router = express.Router();
const brand = [isAuthenticated, authorizeRoles("brand")];
const brandImages = imageUpload.fields([
  { name: "logo", maxCount: 1 },
  { name: "cover", maxCount: 1 },
]);
const cardImage = imageUpload.single("image");

// Brand: campaigns (every :id is checked against the calling brand in the controller)
router.get("/brand/campaigns/pricing", brand, getPricing);
router.post("/brand/campaigns", brand, writeLimiter, brandImages, createCampaign);
router.get("/brand/campaigns", brand, listMyCampaigns);
router.get("/brand/campaigns/:id", brand, getMyCampaign);
router.get("/brand/campaigns/:id/preview", brand, getMyCampaign);
router.patch("/brand/campaigns/:id", brand, writeLimiter, brandImages, updateCampaign);
router.delete("/brand/campaigns/:id", brand, deleteCampaign);

router.post("/brand/campaigns/:id/cards", brand, writeLimiter, cardImage, createCard);
router.post("/brand/campaigns/:id/cards/bulk", brand, writeLimiter, bulkCreateCards);
router.patch("/brand/campaigns/:id/cards/:cardId", brand, writeLimiter, cardImage, updateCard);
router.delete("/brand/campaigns/:id/cards/:cardId", brand, deleteCard);

router.post("/brand/campaigns/:id/checkout", brand, checkoutLimiter, startCampaignCheckout);
router.post("/brand/campaigns/:id/cancel-checkout", brand, cancelCampaignCheckout);
router.get("/brand/campaigns/:id/dashboard", brand, getDashboard);

// Players
router.get("/campaigns/next", isAuthenticated, getNextCampaign);
router.get("/campaigns/:id", isAuthenticated, getCampaignInfo);
router.post("/campaigns/:id/click", isAuthenticated, clickLimiter, postUrlClick);

export default router;
