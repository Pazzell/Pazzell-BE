import express from "express";
import {
  getReferralSummary,
  getReferralEvents,
} from "../controllers/referral.controller";

const router = express.Router();

// Public/admin-accessible endpoints
router.get("/referrals/summary", getReferralSummary);
router.get("/referrals/events", getReferralEvents);

export default router;
