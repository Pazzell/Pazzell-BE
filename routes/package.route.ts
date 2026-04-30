import express from "express";
import { getAllPackages, getPackageById, createPackage } from "../controllers/package.controller";
import { isAuthenticated } from "../utils/auth";

const router = express.Router();

// Get all active packages
router.get("/packages", isAuthenticated, getAllPackages);

// Get package by ID
router.get("/packages/:packageId", isAuthenticated, getPackageById);

// Create new package (Admin only - TODO: add admin middleware)
router.post("/packages", isAuthenticated, createPackage);

export default router;
