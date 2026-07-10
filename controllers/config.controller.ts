import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import {
  getAllConfig,
  setConfigValue,
  CONFIG_DEFAULTS,
} from "../services/config/config.service";

// GET /admin/config — list all effective config values (DB overrides merged over defaults)
export const listConfig = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await getAllConfig();
      res.status(200).json({ success: true, config });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// PUT /admin/config/:key  body: { value, description? }
export const updateConfig = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key } = req.params;
      const { value, description } = req.body;

      if (value === undefined) {
        return next(new ErrorHandler("value is required", 400));
      }
      if (!(key in CONFIG_DEFAULTS)) {
        return next(
          new ErrorHandler(
            `Unknown config key "${key}" — no default exists for it`,
            400
          )
        );
      }

      const updatedBy = String((req.user as any)?._id || "");
      await setConfigValue(key, value, updatedBy, description);

      res.status(200).json({ success: true, key, value });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);
