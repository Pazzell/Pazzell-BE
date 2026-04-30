import express from "express";
import {
  googleAuth,
  registerBrand,
  logout,
  registerGamer,
  activateUser,
  login,
  resendActivation,
  forgotPassword,
  resetPassword,
} from "../controllers/auth.controller";
import { isAuthenticated } from "../utils/auth";

const router = express.Router();

// Google OAuth
router.post("/auth/google", googleAuth);

// Unified login for both user types
router.post("/auth/login", login);

// Gamer routes (email/password)
router.post("/auth/gamer/register", registerGamer);

// Brand routes
router.post("/auth/brand/register", registerBrand);

// Unified user activation and resend
router.post("/auth/user/activate", activateUser);
router.post("/auth/user/resend-activation", resendActivation);

// Logout (requires authentication)
router.post("/auth/logout", isAuthenticated, logout);

// Password reset
router.post("/auth/forgot-password", forgotPassword);
router.post("/auth/reset-password", resetPassword);

export default router;
