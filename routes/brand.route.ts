import express from "express";
import multer from "multer";
import {
  createCampaign,
  getCampaignAnalytics,
  getAllBrands,
} from "../controllers/brand.controller";
import { isAuthenticated, authorizeRoles } from "../utils/auth";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  // Generous ceiling as a defense-in-depth guard; the real duration/size check
  // against the configured limit happens in services/video/videoValidation.service.ts
  limits: { fileSize: 150 * 1024 * 1024 },
});

// Get all brands
router.get("/brands", getAllBrands);

router.post(
  "/brands/campaigns",
  isAuthenticated,
  authorizeRoles("brand"),
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  createCampaign
);
router.get(
  "/brands/analytics",
  isAuthenticated,
  authorizeRoles("brand"),
  getCampaignAnalytics
);

export default router;
