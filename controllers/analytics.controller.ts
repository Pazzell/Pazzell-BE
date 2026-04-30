import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PuzzleAttemptModel from "../models/puzzleAttempt.model";
import { redis } from "../utils/redis";

// Get global app analytics
export const getAppAnalytics = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 1. Total games played (all-time count of puzzle attempts)
      const totalGamesPlayed = await PuzzleAttemptModel.countDocuments();

      // 2. Total games played today (count of puzzle attempts created today)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const gamesPlayedToday = await PuzzleAttemptModel.countDocuments({
        timestamp: {
          $gte: todayStart,
          $lte: todayEnd,
        },
      });

      // 3. Currently playing (users actively in a game right now)
      const currentlyPlayingSet = await redis.smembers("users:currently_playing");
      const currentlyPlaying = currentlyPlayingSet.length;

      // 4. Online users (logged in users)
      const onlineUsersSet = await redis.smembers("users:online");
      const onlineUsers = onlineUsersSet.length;

      res.status(200).json({
        success: true,
        analytics: {
          totalGamesPlayed,
          gamesPlayedToday,
          currentlyPlaying,
          onlineUsers,
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(`Failed to fetch analytics: ${error.message}`, 500));
    }
  }
);

// Mark user as starting to play a game
export const startPlayingGame = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id as string;
      const { campaignId } = req.body;

      if (!userId) {
        return next(new ErrorHandler("User not authenticated", 401));
      }

      if (!campaignId) {
        return next(new ErrorHandler("Campaign ID is required", 400));
      }

      // Add user to "currently playing" set with expiry (auto-remove after 1 hour)
      await redis.sadd("users:currently_playing", userId);
      await redis.expire("users:currently_playing", 3600); // 1 hour

      // Store which campaign they're playing
      await redis.set(`user:${userId}:playing`, campaignId, "EX", 3600);

      res.status(200).json({
        success: true,
        message: "Started playing game",
      });
    } catch (error: any) {
      return next(new ErrorHandler(`Failed to start game: ${error.message}`, 500));
    }
  }
);

// Mark user as finished playing a game
export const stopPlayingGame = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id as string;

      if (!userId) {
        return next(new ErrorHandler("User not authenticated", 401));
      }

      // Remove user from "currently playing" set
      await redis.srem("users:currently_playing", userId);

      // Remove the campaign they were playing
      await redis.del(`user:${userId}:playing`);

      res.status(200).json({
        success: true,
        message: "Stopped playing game",
      });
    } catch (error: any) {
      return next(new ErrorHandler(`Failed to stop game: ${error.message}`, 500));
    }
  }
);

// Track user as online (called on login and periodically via heartbeat)
export const markUserOnline = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id as string;

      if (!userId) {
        return next(new ErrorHandler("User not authenticated", 401));
      }

      // Add user to "online" set with 5-minute expiry
      // Frontend should send heartbeat every 2-3 minutes to keep user marked as online
      await redis.sadd("users:online", userId);
      await redis.expire("users:online", 300); // 5 minutes

      // Update last activity timestamp
      await redis.set(`user:${userId}:last_active`, Date.now(), "EX", 300);

      res.status(200).json({
        success: true,
        message: "User marked as online",
      });
    } catch (error: any) {
      return next(new ErrorHandler(`Failed to mark user online: ${error.message}`, 500));
    }
  }
);

// Mark user as offline (called on logout)
export const markUserOffline = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id as string;

      if (!userId) {
        return next(new ErrorHandler("User not authenticated", 401));
      }

      // Remove from online set
      await redis.srem("users:online", userId);

      // Remove from currently playing (in case they were playing)
      await redis.srem("users:currently_playing", userId);

      // Clean up keys
      await redis.del(`user:${userId}:last_active`);
      await redis.del(`user:${userId}:playing`);

      res.status(200).json({
        success: true,
        message: "User marked as offline",
      });
    } catch (error: any) {
      return next(new ErrorHandler(`Failed to mark user offline: ${error.message}`, 500));
    }
  }
);
