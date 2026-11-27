import express from "express";
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
  changePassword,
  updateNotifications,
  deleteAccount,
} from "../controllers/user.controller";
import { isAuthenticated } from "../utils/auth";
import { imageUpload } from "../services/upload/image.service";

const userRouter = express.Router();

// Avatar / brand logo uploads: jpg, png or webp, validated and resized server-side
const upload = imageUpload;

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

// Settings endpoints
userRouter.patch("/profile/change-password", isAuthenticated, changePassword);
userRouter.patch("/profile/notifications", isAuthenticated, updateNotifications);
userRouter.delete("/profile/account", isAuthenticated, deleteAccount);

export default userRouter;