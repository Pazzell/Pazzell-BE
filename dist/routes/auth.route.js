"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_controller_1 = require("../controllers/auth.controller");
const auth_1 = require("../utils/auth");
const router = express_1.default.Router();
// Google OAuth
router.post("/auth/google", auth_controller_1.googleAuth);
// Unified login for both user types
router.post("/auth/login", auth_controller_1.login);
// Gamer routes (email/password)
router.post("/auth/gamer/register", auth_controller_1.registerGamer);
// Brand routes
router.post("/auth/brand/register", auth_controller_1.registerBrand);
// Unified user activation and resend
router.post("/auth/user/activate", auth_controller_1.activateUser);
router.post("/auth/user/resend-activation", auth_controller_1.resendActivation);
// Logout (requires authentication)
router.post("/auth/logout", auth_1.isAuthenticated, auth_controller_1.logout);
// Password reset
router.post("/auth/forgot-password", auth_controller_1.forgotPassword);
router.post("/auth/reset-password", auth_controller_1.resetPassword);
exports.default = router;
