import express from "express";
import { listConfig, updateConfig } from "../controllers/config.controller";
import { isAuthenticated, authorizeRoles } from "../utils/auth";

const router = express.Router();

router.get("/admin/config", isAuthenticated, authorizeRoles("admin"), listConfig);
router.put(
  "/admin/config/:key",
  isAuthenticated,
  authorizeRoles("admin"),
  updateConfig
);

export default router;
