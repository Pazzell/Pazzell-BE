"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const referral_controller_1 = require("../controllers/referral.controller");
const auth_1 = require("../utils/auth");
const router = express_1.default.Router();
// Public/admin: top referrers for a given month
router.get("/referrals/summary", referral_controller_1.getReferralSummary);
// Public/admin: referral events log
router.get("/referrals/events", referral_controller_1.getReferralEvents);
// Authenticated user: own referral stats (dashboard)
router.get("/referrals/my-stats", auth_1.isAuthenticated, referral_controller_1.getMyReferralStats);
exports.default = router;
