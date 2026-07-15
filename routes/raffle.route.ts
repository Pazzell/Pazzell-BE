import express from "express";
import {
  getCurrentCampaignRaffle,
  getMyTickets,
  triggerDraw,
  updateFulfillment,
  getDrawVerification,
} from "../controllers/raffle.controller";
import { isAuthenticated, authorizeRoles } from "../utils/auth";

const router = express.Router();

router.get("/raffles/campaign/:campaignId/current", getCurrentCampaignRaffle);
router.get("/raffles/my-tickets", isAuthenticated, getMyTickets);
router.post(
  "/raffles/:campaignId/draw",
  isAuthenticated,
  authorizeRoles("admin"),
  triggerDraw
);
router.patch(
  "/raffles/:drawId/fulfillment",
  isAuthenticated,
  authorizeRoles("brand", "admin"),
  updateFulfillment
);
router.get("/raffles/:drawId/verify", getDrawVerification);

export default router;
