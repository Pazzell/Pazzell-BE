import express from "express";
import {
  initializePayment,
  verifyPayment,
  paystackWebhook,
  getCampaignBudget,
  getTransactionHistory,
} from "../controllers/payment.controller";
import {
  fetchDailyPrizePool,
  triggerDailyPrizePoolCalculation,
  fetchWeeklyPrizePoolSummary,
  triggerWeeklyPayoutCalculation,
  getGamerPayouts,
  getWeekPayouts,
  processPayouts,
  getPlatformEarnings,
  getCurrentDailyPrizeTable,
  getDailyPrizeTableByDate,
} from "../controllers/payout.controller";
import { isAuthenticated, authorizeRoles } from "../utils/auth";

const router = express.Router();

// Payment endpoints
router.post("/payments/initialize", isAuthenticated, authorizeRoles("brand"), initializePayment);
router.get("/payments/verify/:reference", isAuthenticated, authorizeRoles("brand"), verifyPayment);
router.get("/payments/transactions", isAuthenticated, authorizeRoles("brand"), getTransactionHistory);

// Paystack webhook (no auth - called by Paystack)
router.post("/payments/webhook/paystack", paystackWebhook);
router.post("/payments/webhook", paystackWebhook); // Legacy endpoint

// Campaign budget
router.get("/campaigns/:campaignId/budget", getCampaignBudget);

// Daily prize pool
router.get("/prize-pools/daily/:date", fetchDailyPrizePool);
router.post("/prize-pools/daily/calculate", isAuthenticated, authorizeRoles("admin"), triggerDailyPrizePoolCalculation);

// Weekly prize pool
router.get("/prize-pools/weekly/summary", fetchWeeklyPrizePoolSummary);

// Payouts
router.post("/payouts/weekly/calculate", isAuthenticated, authorizeRoles("admin"), triggerWeeklyPayoutCalculation);
router.get("/payouts/my-earnings", isAuthenticated, getGamerPayouts);
router.get("/payouts/week/:weekKey", isAuthenticated, authorizeRoles("admin"), getWeekPayouts);
router.post("/payouts/process", isAuthenticated, authorizeRoles("admin"), processPayouts);

// Platform earnings
router.get("/platform/earnings", isAuthenticated, authorizeRoles("admin"), getPlatformEarnings);

// Daily Prize Table (Real-time potential earnings)
router.get("/prize-table/today", getCurrentDailyPrizeTable);
router.get("/prize-table/date/:date", getDailyPrizeTableByDate);

export default router;
