import express from "express";
import {
  getGameSettings,
  getMyPlan,
  startProCheckout,
  verifyPayment,
  listMyPayments,
  paystackWebhook,
} from "../controllers/plan.controller";
import { isAuthenticated } from "../utils/auth";
import { checkoutLimiter } from "../middlewares/rateLimit";

const router = express.Router();

// Global game settings (timer range, card bounds, prices) — public
router.get("/settings/game", getGameSettings);

// Plan
router.get("/plan/me", isAuthenticated, getMyPlan);
router.post("/plan/pro/checkout", isAuthenticated, checkoutLimiter, startProCheckout);

// Payments (Pro and campaigns)
router.get("/payments/mine", isAuthenticated, listMyPayments);
router.get("/payments/verify/:reference", isAuthenticated, checkoutLimiter, verifyPayment);

// Paystack webhook (no auth - called by Paystack, verified by signature)
router.post("/payments/webhook/paystack", paystackWebhook);
router.post("/payments/webhook", paystackWebhook); // Legacy endpoint

export default router;
