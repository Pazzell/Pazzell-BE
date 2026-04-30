import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PackageModel from "../models/package.model";

// Initialize default packages (run once on server startup)
export const initializePackages = async () => {
  try {
    const count = await PackageModel.countDocuments();
    if (count === 0) {
      await PackageModel.insertMany([
        {
          name: "premium",
          amount: 10000,
          priority: 2,
          description: "Premium package - Higher visibility",
          isActive: true,
        },
        {
          name: "basic",
          amount: 7000,
          priority: 1,
          description: "Basic package - Standard visibility",
          isActive: true,
        },
      ]);
      console.log("✅ Default packages initialized successfully");
    }
  } catch (error) {
    console.error("Error initializing packages:", error);
  }
};

// Get all active packages
export const getAllPackages = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const packages = await PackageModel.find({ isActive: true })
        .select("_id name amount priority description")
        .sort({ priority: -1 }) // Higher priority first
        .lean();

      res.status(200).json({
        success: true,
        packages,
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Get package by ID
export const getPackageById = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { packageId } = req.params;

      const packageData = await PackageModel.findById(packageId).lean();

      if (!packageData) {
        return next(new ErrorHandler("Package not found", 404));
      }

      res.status(200).json({
        success: true,
        package: packageData,
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Create a new package (Admin only)
export const createPackage = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, amount, priority, description } = req.body;

      // Validate required fields
      if (!name || typeof name !== "string" || name.trim() === "") {
        return next(
          new ErrorHandler("name is required and must be a non-empty string", 400)
        );
      }

      if (!amount || typeof amount !== "number" || amount <= 0) {
        return next(
          new ErrorHandler("amount is required and must be a positive number", 400)
        );
      }

      if (priority === undefined || typeof priority !== "number" || priority < 0) {
        return next(
          new ErrorHandler(
            "priority is required and must be a non-negative number",
            400
          )
        );
      }

      // Check if package with same name already exists
      const existingPackage = await PackageModel.findOne({
        name: name.trim().toLowerCase(),
      });

      if (existingPackage) {
        return next(
          new ErrorHandler(
            `Package with name "${name}" already exists`,
            400
          )
        );
      }

      // Create new package
      const newPackage = await PackageModel.create({
        name: name.trim().toLowerCase(),
        amount,
        priority,
        description: description || `${name.trim()} package`,
        isActive: true,
      });

      res.status(201).json({
        success: true,
        message: "Package created successfully",
        package: newPackage,
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);
