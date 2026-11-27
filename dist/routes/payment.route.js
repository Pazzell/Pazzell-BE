"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const payment_controller_1 = require("../controllers/payment.controller");
const payout_controller_1 = require("../controllers/payout.controller");
const auth_1 = require("../utils/auth");
const router = express_1.default.Router();
// Weekly pricing calculator (public — brands check price before creating a campaign)
router.get("/payments/calculate-weekly-price", payment_controller_1.calculateWeeklyPrice);
// Payment endpoints
router.post("/payments/initialize", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("brand"), payment_controller_1.initializePayment);
router.get("/payments/verify/:reference", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("brand"), payment_controller_1.verifyPayment);
router.get("/payments/transactions", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("brand"), payment_controller_1.getTransactionHistory);
// Paystack webhook (no auth - called by Paystack)
router.post("/payments/webhook/paystack", payment_controller_1.paystackWebhook);
router.post("/payments/webhook", payment_controller_1.paystackWebhook); // Legacy endpoint
// Campaign budget
router.get("/campaigns/:campaignId/budget", payment_controller_1.getCampaignBudget);
// Weekly prize pool (revenue-based — replaces the retired daily-drip prize pool/table)
router.get("/prize-pools/weekly/summary", payout_controller_1.fetchWeeklyPrizePoolSummary);
// Payouts
router.post("/payouts/weekly/calculate", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("admin"), payout_controller_1.triggerWeeklyPayoutCalculation);
router.get("/payouts/my-earnings", auth_1.isAuthenticated, payout_controller_1.getGamerPayouts);
router.get("/payouts/week/:weekKey", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("admin"), payout_controller_1.getWeekPayouts);
router.post("/payouts/process", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("admin"), payout_controller_1.processPayouts);
// Platform earnings
router.get("/platform/earnings", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("admin"), payout_controller_1.getPlatformEarnings);
exports.default = router;
