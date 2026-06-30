import express from "express";
import {
  getReferralSummary,
  getReferralEvents,
  getMyReferralStats,
} from "../controllers/referral.controller";
import { isAuthenticated } from "../utils/auth";

const router = express.Router();

// Public/admin: top referrers for a given month
router.get("/referrals/summary", getReferralSummary);
// Public/admin: referral events log
router.get("/referrals/events", getReferralEvents);
// Authenticated user: own referral stats (dashboard)
router.get("/referrals/my-stats", isAuthenticated, getMyReferralStats);

export default router;
