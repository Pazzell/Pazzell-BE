import express from "express";
import multer from "multer";
import {
  createCampaign,
  getCampaignAnalytics,
  getAllBrands,
} from "../controllers/brand.controller";
import { isAuthenticated, authorizeRoles } from "../utils/auth";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

// Get all brands
router.get("/brands", getAllBrands);

router.post(
  "/brands/campaigns",
  isAuthenticated,
  authorizeRoles("brand"),
  upload.single("image"),
  createCampaign
);
router.get(
  "/brands/analytics",
  isAuthenticated,
  authorizeRoles("brand"),
  getCampaignAnalytics
);

export default router;
