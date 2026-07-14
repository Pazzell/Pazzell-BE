"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const raffle_controller_1 = require("../controllers/raffle.controller");
const auth_1 = require("../utils/auth");
const router = express_1.default.Router();
router.get("/raffles/campaign/:campaignId/current", raffle_controller_1.getCurrentCampaignRaffle);
router.get("/raffles/my-tickets", auth_1.isAuthenticated, raffle_controller_1.getMyTickets);
router.post("/raffles/:campaignId/draw", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("admin"), raffle_controller_1.triggerDraw);
router.patch("/raffles/:drawId/fulfillment", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("brand", "admin"), raffle_controller_1.updateFulfillment);
router.get("/raffles/:drawId/verify", raffle_controller_1.getDrawVerification);
exports.default = router;
