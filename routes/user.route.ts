import express from "express";
import multer from "multer";
import {
  registerUser,
  activateUser,
  loginUser,
  logoutUser,
  updateAccessToken,
  getUserInfo,
  getGamerProfile,
  getBrandProfile,
  updateGamerProfile,
  updateBrandProfile,
  getAllGamers,
  clearAllGamerData
} from "../controllers/user.controller";
import { isAuthenticated, authorizeRoles } from "../utils/auth";

const userRouter = express.Router();

// Configure multer for avatar uploads
const upload = multer({ storage: multer.memoryStorage() });

// Get all gamers
userRouter.get("/gamers", getAllGamers);

userRouter.post("/registration", registerUser);

userRouter.post("/activate-user", activateUser);

userRouter.post("/login", loginUser);

userRouter.post("/logout", isAuthenticated, logoutUser);

userRouter.post("/refresh", updateAccessToken);

userRouter.get("/me", isAuthenticated, getUserInfo);

// Get gamer profile with full analytics
userRouter.get("/profile/gamer", isAuthenticated, getGamerProfile);

// Get brand profile with brand details and campaigns
userRouter.get("/profile/brand", isAuthenticated, getBrandProfile);

// Update gamer profile (with optional avatar upload)
userRouter.put("/profile/gamer", isAuthenticated, upload.single("avatar"), updateGamerProfile);

// Update brand profile (with optional avatar upload)
userRouter.put("/profile/brand", isAuthenticated, upload.single("avatar"), updateBrandProfile);

// Clear all gamer data (Admin only)
userRouter.post("/admin/clear-all-data", isAuthenticated, authorizeRoles("admin"), clearAllGamerData);

export default userRouter;