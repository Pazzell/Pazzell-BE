import express from "express";
import {
  initializePayment,
  verifyPayment,
  paystackWebhook,
  getCampaignBudget,
  getTransactionHistory,
  calculateWeeklyPrice,
} from "../controllers/payment.controller";
import {
  fetchWeeklyPrizePoolSummary,
  triggerWeeklyPayoutCalculation,
  getGamerPayouts,
  getWeekPayouts,
  processPayouts,
  getPlatformEarnings,
} from "../controllers/payout.controller";
import { isAuthenticated, authorizeRoles } from "../utils/auth";

const router = express.Router();

// Weekly pricing calculator (public — brands check price before creating a campaign)
router.get("/payments/calculate-weekly-price", calculateWeeklyPrice);

// Payment endpoints
router.post("/payments/initialize", isAuthenticated, authorizeRoles("brand"), initializePayment);
router.get("/payments/verify/:reference", isAuthenticated, authorizeRoles("brand"), verifyPayment);
router.get("/payments/transactions", isAuthenticated, authorizeRoles("brand"), getTransactionHistory);

// Paystack webhook (no auth - called by Paystack)
router.post("/payments/webhook/paystack", paystackWebhook);
router.post("/payments/webhook", paystackWebhook); // Legacy endpoint

// Campaign budget
router.get("/campaigns/:campaignId/budget", getCampaignBudget);

// Weekly prize pool (revenue-based — replaces the retired daily-drip prize pool/table)
router.get("/prize-pools/weekly/summary", fetchWeeklyPrizePoolSummary);

// Payouts
router.post("/payouts/weekly/calculate", isAuthenticated, authorizeRoles("admin"), triggerWeeklyPayoutCalculation);
router.get("/payouts/my-earnings", isAuthenticated, getGamerPayouts);
router.get("/payouts/week/:weekKey", isAuthenticated, authorizeRoles("admin"), getWeekPayouts);
router.post("/payouts/process", isAuthenticated, authorizeRoles("admin"), processPayouts);

// Platform earnings
router.get("/platform/earnings", isAuthenticated, authorizeRoles("admin"), getPlatformEarnings);

export default router;
