"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const user_controller_1 = require("../controllers/user.controller");
const auth_1 = require("../utils/auth");
const userRouter = express_1.default.Router();
// Configure multer for avatar uploads
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
// Get all gamers
userRouter.get("/gamers", user_controller_1.getAllGamers);
userRouter.post("/registration", user_controller_1.registerUser);
userRouter.post("/activate-user", user_controller_1.activateUser);
userRouter.post("/login", user_controller_1.loginUser);
userRouter.post("/logout", auth_1.isAuthenticated, user_controller_1.logoutUser);
userRouter.post("/refresh", user_controller_1.updateAccessToken);
userRouter.get("/me", auth_1.isAuthenticated, user_controller_1.getUserInfo);
// Get gamer profile with full analytics
userRouter.get("/profile/gamer", auth_1.isAuthenticated, user_controller_1.getGamerProfile);
// Get brand profile with brand details and campaigns
userRouter.get("/profile/brand", auth_1.isAuthenticated, user_controller_1.getBrandProfile);
// Update gamer profile (with optional avatar upload)
userRouter.put("/profile/gamer", auth_1.isAuthenticated, upload.single("avatar"), user_controller_1.updateGamerProfile);
// Update brand profile (with optional avatar upload)
userRouter.put("/profile/brand", auth_1.isAuthenticated, upload.single("avatar"), user_controller_1.updateBrandProfile);
// Settings endpoints
userRouter.patch("/profile/change-password", auth_1.isAuthenticated, user_controller_1.changePassword);
userRouter.patch("/profile/notifications", auth_1.isAuthenticated, user_controller_1.updateNotifications);
userRouter.patch("/profile/privacy", auth_1.isAuthenticated, user_controller_1.updatePrivacy);
userRouter.delete("/profile/account", auth_1.isAuthenticated, user_controller_1.deleteAccount);
// Clear all gamer data (Admin only)
userRouter.post("/admin/clear-all-data", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("admin"), user_controller_1.clearAllGamerData);
exports.default = userRouter;
