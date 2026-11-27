import express from "express";
import { uploadImage } from "../controllers/upload.controller";
import { isAuthenticated } from "../utils/auth";
import { imageUpload } from "../services/upload/image.service";
import { uploadLimiter } from "../middlewares/rateLimit";

const router = express.Router();

router.post("/uploads/images", isAuthenticated, uploadLimiter, imageUpload.single("image"), uploadImage);

export default router;
