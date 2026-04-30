import { Request, Response, NextFunction } from "express";
import userModel, { IUser } from "../models/user.model";
import ErrorHandler from "../utils/ErrorHandler";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import jwt, { Secret, JwtPayload } from "jsonwebtoken";
import PuzzleAttemptModel from "../models/puzzleAttempt.model";
import LeaderboardModel from "../models/leaderboard.model";
import { bucket } from "../firebaseConfig";

import ejs from "ejs";
import path from "path";
import sendMail from "../utils/sendEmail";
import { redis } from "../utils/redis";

import "dotenv/config";
import {
  accessTokenOptions,
  refreshTokenOptions,
  sendToken,
} from "../utils/jwt";

//using interface for req.user
declare module "express" {
  interface Request {
    user?: IUser;
  }
}

//Register user interface
interface IRegistrationBody {
  name: string;
  email: string;
  password: string;
  avatar?: string;
}

//Register user
export const registerUser = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, email, password } = req.body;

      //Check if email already exists
      const isEmailExist = await userModel.findOne({ email });
      if (isEmailExist) {
        return next(new ErrorHandler("Email already exists", 400));
      }

      const user: IRegistrationBody = {
        name,
        email,
        password,
      };

      const activationToken = createActivationToken(user);
      const activationCode = activationToken.activationCode;

      const data = { user: { name: user.name }, activationCode };
      await ejs.renderFile(
        path.join(__dirname, "../mails/activation-mail.ejs"),
        data
      );

      //send email to user
      try {
        await sendMail({
          email: user.email,
          subject: "Activate your account",
          template: "activation-mail.ejs",
          data,
        });

        res.status(201).json({
          success: true,
          message: `Please check your email: ${user.email} to activate your account!`,
          activationToken: activationToken.token,
        });
      } catch (error: any) {
        console.log(error);
        return next(new ErrorHandler(error.message, 400));
      }
    } catch (error: any) {
      console.log(error);
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

//Generate user activation token
interface IActivationToken {
  token: string;
  activationCode: string;
}

export const createActivationToken = (user: any): IActivationToken => {
  const activationCode = Math.floor(1000 + Math.random() * 9000).toString();

  const token = jwt.sign(
    {
      user,
      activationCode,
    },
    process.env.ACTIVATION_SECRET as Secret,
    {
      expiresIn: "5m",
    }
  );
  return { token, activationCode };
};

//Activate user
interface IActivationRequest {
  activation_token: string;
  activation_code: string;
}

export const activateUser = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { activation_token, activation_code } =
        req.body as IActivationRequest;

      const newUser: { user: IUser; activationCode: string } = jwt.verify(
        activation_token,
        process.env.ACTIVATION_SECRET as string
      ) as { user: IUser; activationCode: string };

      if (newUser.activationCode !== activation_code) {
        return next(new ErrorHandler("Invalid activation code", 400));
      }

      const { name, email, password } = newUser.user;

      const existUser = await userModel.findOne({ email });

      if (existUser) {
        return next(new ErrorHandler("Email already exist", 400));
      }

      //store user data in database
      await userModel.create({
        name,
        email,
        password,
      });

      res.status(201).json({
        success: true,
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

//login user
interface ILoginRequest {
  email: string;
  password: string;
}

export const loginUser = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body as ILoginRequest;
      if (!email || !password) {
        res.status(400).json({
          message: "Invalid credentials",
        });
      }

      const user = await userModel.findOne({ email }).select("+password");

      if (!user) {
        return next(new ErrorHandler("Invalid email or password. Please check your credentials and try again.", 401));
      }

      //check password
      const isPasswordMatch = await user.comparePassword?.(password);
      if (!isPasswordMatch) {
        return next(new ErrorHandler("Invalid email or password. Please check your credentials and try again.", 401));
      }
      sendToken(user, 200, res);
    } catch (error: any) {
      return next(new ErrorHandler(`Login failed: ${error.message}`, 500));
    }
  }
);

//logout user
export const logoutUser = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.cookie("access_token", "", { maxAge: 1 });
      res.cookie("refresh_token", "", { maxAge: 1 });

      // delete cache from redis
      const userId = req.user?._id as string;

      redis.del(userId);

      res.status(200).json({
        success: true,
        message: "logged out successfully",
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// update access token
export const updateAccessToken = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refresh_token = req.cookies.refresh_token as string;

      //Verify refresh token
      const decoded = jwt.verify(
        refresh_token,
        process.env.REFRESH_TOKEN as string
      ) as JwtPayload;
      if (!decoded) {
        return next(new ErrorHandler("Could not refresh access token", 400));
      }

      //Get user id
      const session = await redis.get(decoded.id);
      if (!session) {
        return next(new ErrorHandler("Could not refresh access token", 400));
      }

      const user = JSON.parse(session);

      //create access and refresh token
      const accessToken = jwt.sign(
        { id: user._id },
        process.env.ACCESS_TOKEN as string,
        {
          expiresIn: "5m",
        }
      );

      const refreshToken = jwt.sign(
        { id: user._id },
        process.env.REFRESH_TOKEN as string,
        {
          expiresIn: "3d",
        }
      );

      req.user = user;

      res.cookie("access_token", accessToken, accessTokenOptions);
      res.cookie("refresh_token", refreshToken, refreshTokenOptions);

      res.status(200).json({
        success: true,
        accessToken,
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// get user
export const getUserInfo = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id as string;

      const userJson = await redis.get(userId);

      if (userJson) {
        const user = JSON.parse(userJson);

        res.status(200).json({
          success: true,
          user,
        });
      }
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Get gamer profile with full analytics
export const getGamerProfile = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id as string;

      if (!req.user || req.user.role !== "gamer") {
        return next(new ErrorHandler("Access denied. Gamer profile only.", 403));
      }

      const user = await userModel.findById(userId).select("-password").lean();

      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      // Calculate current week's leaderboard position
      const now = new Date();
      const dayOfWeek = now.getDay();
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

      const weekStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - daysFromMonday
      );
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      // Get current week's leaderboard for position
      const weeklyLeaderboard = await PuzzleAttemptModel.aggregate([
        {
          $match: {
            firstTimeSolved: true,
            timestamp: { $gte: weekStart, $lte: weekEnd },
          },
        },
        {
          $group: {
            _id: "$userId",
            puzzlesSolved: { $sum: 1 },
            points: { $sum: "$pointsEarned" },
          },
        },
        { $sort: { puzzlesSolved: -1, points: -1 } },
      ]);

      // Find user's weekly leaderboard position
      let weeklyLeaderboardPosition = null;
      const weeklyUserIndex = weeklyLeaderboard.findIndex(
        (entry: any) => entry._id.toString() === userId.toString()
      );
      if (weeklyUserIndex !== -1) {
        weeklyLeaderboardPosition = weeklyUserIndex + 1;
      }

      // Get all-time leaderboard for position
      const allTimeLeaderboard = await PuzzleAttemptModel.aggregate([
        {
          $match: {
            firstTimeSolved: true,
          },
        },
        {
          $group: {
            _id: "$userId",
            puzzlesSolved: { $sum: 1 },
            points: { $sum: "$pointsEarned" },
          },
        },
        { $sort: { points: -1, puzzlesSolved: -1 } },
      ]);

      // Find user's all-time leaderboard position
      let allTimeLeaderboardPosition = null;
      const allTimeUserIndex = allTimeLeaderboard.findIndex(
        (entry: any) => entry._id.toString() === userId.toString()
      );
      if (allTimeUserIndex !== -1) {
        allTimeLeaderboardPosition = allTimeUserIndex + 1;
      }

      // Calculate weekly analytics from puzzle attempts
      const weeklyAttempts = await PuzzleAttemptModel.find({
        userId: userId,
        timestamp: { $gte: weekStart, $lte: weekEnd },
      }).lean();

      const weeklyStats = weeklyAttempts.reduce(
        (acc, attempt) => {
          if (attempt.firstTimeSolved) {
            acc.puzzlesSolved += 1;
          }
          acc.totalPoints += attempt.pointsEarned || 0;
          acc.totalTime += attempt.timeTaken || 0;
          acc.totalMoves += attempt.movesTaken || 0;
          acc.attempts += 1;
          if (attempt.solved) {
            acc.successfulAttempts += 1;
          }
          return acc;
        },
        {
          puzzlesSolved: 0,
          totalPoints: 0,
          totalEarnings: 0,
          totalTime: 0,
          totalMoves: 0,
          attempts: 0,
          successfulAttempts: 0,
          successRate: 0,
        }
      );

      // Calculate success rate
      weeklyStats.successRate =
        weeklyStats.attempts > 0
          ? weeklyStats.successfulAttempts / weeklyStats.attempts
          : 0;
      weeklyStats.totalEarnings = weeklyStats.totalPoints; // Points = Earnings

      res.status(200).json({
        success: true,
        profile: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          role: user.role,
          isVerified: user.isVerified,
          analytics: {
            lifetime: {
              puzzlesSolved: user.analytics?.lifetime?.puzzlesSolved || 0,
              totalPoints: user.analytics?.lifetime?.totalPoints || 0,
              totalEarnings: user.analytics?.lifetime?.totalEarnings || 0,
              totalTime: user.analytics?.lifetime?.totalTime || 0,
              totalMoves: user.analytics?.lifetime?.totalMoves || 0,
              attempts: user.analytics?.lifetime?.attempts || 0,
              successRate: user.analytics?.lifetime?.successRate || 0,
              leaderboardPosition: allTimeLeaderboardPosition,
            },
            weekly: {
              weekStart: weekStart.toISOString().slice(0, 10),
              weekEnd: weekEnd.toISOString().slice(0, 10),
              puzzlesSolved: weeklyStats.puzzlesSolved,
              totalPoints: weeklyStats.totalPoints,
              totalEarnings: weeklyStats.totalEarnings,
              totalTime: weeklyStats.totalTime,
              totalMoves: weeklyStats.totalMoves,
              attempts: weeklyStats.attempts,
              successRate: Math.round(weeklyStats.successRate * 100) / 100,
              leaderboardPosition: weeklyLeaderboardPosition,
            },
          },
          puzzlesSolved: user.puzzlesSolved,
          createdAt: (user as any).createdAt,
          updatedAt: (user as any).updatedAt,
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(`Failed to fetch gamer profile: ${error.message}`, 500));
    }
  }
);

// Get brand profile with brand details and campaigns
export const getBrandProfile = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id as string;

      if (!req.user || req.user.role !== "brand") {
        return next(new ErrorHandler("Access denied. Brand profile only.", 403));
      }

      const user = await userModel.findById(userId).select("-password").lean();

      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      // Get brand details
      const BrandModel = require("../models/brand.model").default;
      const brandProfile = await BrandModel.findOne({ userId }).lean();

      // Get campaign count only (not the full list for better performance)
      const PuzzleCampaignModel = require("../models/puzzleCampaign.model").default;
      const totalCampaigns = await PuzzleCampaignModel.countDocuments({
        brandId: userId,
      });

      res.status(200).json({
        success: true,
        profile: {
          _id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          role: user.role,
          companyName: user.companyName,
          isVerified: user.isVerified,
          createdAt: (user as any).createdAt,
          updatedAt: (user as any).updatedAt,
          brandDetails: brandProfile
            ? {
                companyEmail: brandProfile.companyEmail,
                companyName: brandProfile.companyName,
                verified: brandProfile.verified,
                totalCampaigns,
              }
            : null,
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Update gamer profile
export const updateGamerProfile = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id as string;

      if (!req.user || req.user.role !== "gamer") {
        return next(new ErrorHandler("Access denied. Gamer profile only.", 403));
      }

      const { firstName, lastName, username, avatar } = req.body;

      // Build update object with only provided fields
      const updateData: any = {};
      if (firstName && typeof firstName === "string" && firstName.trim() !== "") {
        updateData.firstName = firstName.trim();
      }
      if (lastName !== undefined && typeof lastName === "string") {
        updateData.lastName = lastName.trim();
      }

      // Handle username update with uniqueness check
      if (username && typeof username === "string" && username.trim() !== "") {
        const trimmedUsername = username.trim();

        // Check if username is already taken by another user
        const existingUser = await userModel.findOne({
          username: trimmedUsername,
          _id: { $ne: userId } // Exclude current user
        });

        if (existingUser) {
          return next(new ErrorHandler("Username is already taken. Please choose a different username.", 400));
        }

        updateData.username = trimmedUsername;
      }

      // Handle avatar upload (file or URL)
      const uploadedFile: any = (req as any).file;

      if (uploadedFile) {
        // File was uploaded - upload to Firebase Storage
        const now = Date.now();
        const avatarName = `avatars/${userId}-${now}-${uploadedFile.originalname}`;

        const fileRef = bucket.file(avatarName);
        await fileRef.save(uploadedFile.buffer, {
          resumable: false,
          contentType: uploadedFile.mimetype,
        });
        await fileRef.makePublic();

        updateData.avatar = `https://storage.googleapis.com/${bucket.name}/${avatarName}`;
      } else if (avatar && typeof avatar === "string") {
        // URL was provided as string
        updateData.avatar = avatar;
      }

      // Check if there's anything to update
      if (Object.keys(updateData).length === 0) {
        return next(new ErrorHandler("No valid fields provided for update", 400));
      }

      const updatedUser = await userModel
        .findByIdAndUpdate(userId, updateData, { new: true })
        .select("-password");

      if (!updatedUser) {
        return next(new ErrorHandler("User not found", 404));
      }

      // Update redis cache if exists
      try {
        await redis.set(userId, JSON.stringify(updatedUser));
      } catch (redisErr) {
        console.error("Redis update error:", redisErr);
      }

      res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        profile: {
          _id: updatedUser._id,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          username: updatedUser.username,
          email: updatedUser.email,
          avatar: updatedUser.avatar,
          role: updatedUser.role,
          isVerified: updatedUser.isVerified,
          analytics: updatedUser.analytics,
          puzzlesSolved: updatedUser.puzzlesSolved,
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Update brand profile
export const updateBrandProfile = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id as string;

      if (!req.user || req.user.role !== "brand") {
        return next(new ErrorHandler("Access denied. Brand profile only.", 403));
      }

      const { name, avatar, companyName } = req.body;

      // Build update object for user model with only provided fields
      const userUpdateData: any = {};
      if (name && typeof name === "string" && name.trim() !== "") {
        userUpdateData.name = name.trim();
      }
      if (companyName && typeof companyName === "string" && companyName.trim() !== "") {
        userUpdateData.companyName = companyName.trim();
      }

      // Handle avatar upload (file or URL)
      const uploadedFile: any = (req as any).file;

      if (uploadedFile) {
        // File was uploaded - upload to Firebase Storage
        const now = Date.now();
        const avatarName = `avatars/${userId}-${now}-${uploadedFile.originalname}`;

        const fileRef = bucket.file(avatarName);
        await fileRef.save(uploadedFile.buffer, {
          resumable: false,
          contentType: uploadedFile.mimetype,
        });
        await fileRef.makePublic();

        userUpdateData.avatar = `https://storage.googleapis.com/${bucket.name}/${avatarName}`;
      } else if (avatar && typeof avatar === "string") {
        // URL was provided as string
        userUpdateData.avatar = avatar;
      }

      // Check if there's anything to update
      if (Object.keys(userUpdateData).length === 0) {
        return next(new ErrorHandler("No valid fields provided for update", 400));
      }

      // Update user model
      const updatedUser = await userModel
        .findByIdAndUpdate(userId, userUpdateData, { new: true })
        .select("-password");

      if (!updatedUser) {
        return next(new ErrorHandler("User not found", 404));
      }

      // If companyName is updated, also update brand profile
      if (companyName) {
        const BrandModel = require("../models/brand.model").default;
        await BrandModel.findOneAndUpdate(
          { userId },
          { companyName: companyName.trim() }
        );
      }

      // Update redis cache if exists
      try {
        await redis.set(userId, JSON.stringify(updatedUser));
      } catch (redisErr) {
        console.error("Redis update error:", redisErr);
      }

      res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        profile: {
          _id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          avatar: updatedUser.avatar,
          role: updatedUser.role,
          companyName: updatedUser.companyName,
          isVerified: updatedUser.isVerified,
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Get all gamers
export const getAllGamers = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Find all users who are NOT brands or admins (includes users with role 'gamer' or no role set)
      const gamerUsers = await userModel.find({
        role: { $nin: ["brand", "admin"] }
      })
        .select("_id firstName lastName username email avatar isVerified analytics puzzlesSolved createdAt")
        .lean();

      const gamers = gamerUsers.map((gamer) => ({
        _id: gamer._id,
        firstName: gamer.firstName,
        lastName: gamer.lastName,
        username: gamer.username,
        email: gamer.email,
        avatar: gamer.avatar,
        isVerified: gamer.isVerified,
        analytics: gamer.analytics,
        totalPuzzlesSolved: gamer.puzzlesSolved?.length || 0,
        createdAt: (gamer as any).createdAt,
      }));

      res.status(200).json({ success: true, gamers });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Clear all gamer data (Admin only)
export const clearAllGamerData = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { confirm } = req.body;

      if (!confirm || confirm !== true) {
        return next(
          new ErrorHandler(
            "Please confirm this action by sending { confirm: true } in the request body",
            400
          )
        );
      }

      // Delete all puzzle attempts
      const puzzleAttemptsDeleted = await PuzzleAttemptModel.deleteMany({});

      // Reset all gamer analytics to zero
      const usersUpdateResult = await userModel.updateMany(
        { role: { $nin: ["brand", "admin"] } },
        {
          $set: {
            "analytics.lifetime.puzzlesSolved": 0,
            "analytics.lifetime.totalPoints": 0,
            "analytics.lifetime.totalEarnings": 0,
            "analytics.lifetime.totalTime": 0,
            "analytics.lifetime.totalMoves": 0,
            "analytics.lifetime.attempts": 0,
            "analytics.lifetime.successRate": 0,
            "analytics.daily": {
              date: new Date().toISOString().slice(0, 10),
              puzzlesSolved: 0,
            },
            puzzlesSolved: [],
          },
        }
      );

      // Clear all leaderboard records
      const leaderboardsDeleted = await LeaderboardModel.deleteMany({});

      res.status(200).json({
        success: true,
        message: "All gamer data cleared successfully",
        summary: {
          puzzleAttemptsDeleted: puzzleAttemptsDeleted.deletedCount,
          usersReset: usersUpdateResult.modifiedCount,
          leaderboardsCleared: leaderboardsDeleted.deletedCount,
        },
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to clear gamer data: ${error.message}`, 500)
      );
    }
  }
);
