"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const brand_controller_1 = require("../controllers/brand.controller");
const auth_1 = require("../utils/auth");
const router = express_1.default.Router();
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    // Ceiling sits above the configured video.maxSizeBytes (10MB) so the
    // friendlier size error from services/video/videoValidation.service.ts
    // fires first; this is just a defense-in-depth backstop.
    limits: { fileSize: 20 * 1024 * 1024 },
});
// Get all brands
router.get("/brands", brand_controller_1.getAllBrands);
router.post("/brands/campaigns", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("brand"), upload.fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
]), brand_controller_1.createCampaign);
router.get("/brands/analytics", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("brand"), brand_controller_1.getCampaignAnalytics);
exports.default = router;
