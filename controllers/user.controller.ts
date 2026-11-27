import { Request, Response, NextFunction } from "express";
import userModel, { IUser } from "../models/user.model";
import ErrorHandler from "../utils/ErrorHandler";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import jwt, { Secret, JwtPayload } from "jsonwebtoken";
import BrandModel from "../models/brand.model";
import CampaignModel from "../models/campaign.model";
import { storeImage } from "../services/upload/image.service";
import { getPlan } from "../services/plan/plan.service";
import { parseHttpUrl } from "../utils/validators";

import ejs from "ejs";
import path from "path";
import { getEmailService } from "../services/email/emailFactory";
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
        await getEmailService().sendMail({
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
      // req.user is read fresh from MongoDB by isAuthenticated
      res.status(200).json({
        success: true,
        user: req.user,
        plan: getPlan(req.user),
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Get gamer profile
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
          plan: getPlan(user),
          notifications: (user as any).notifications || {
            emailNotifications: true,
            newCampaignAlerts: true,
            weeklyDigest: true,
          },
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
      const brandProfile = await BrandModel.findOne({ userId }).lean();

      // Get campaign count only (not the full list for better performance)
      const totalCampaigns = await CampaignModel.countDocuments({
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
                logoUrl: brandProfile.logoUrl || null,
                websiteUrl: brandProfile.websiteUrl || null,
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
        updateData.avatar = (await storeImage(uploadedFile, userId, "avatars")).url;
      } else if (avatar && typeof avatar === "string") {
        // URL was provided as string
        updateData.avatar = parseHttpUrl(avatar, "avatar");
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

      const { name, avatar, companyName, websiteUrl } = req.body;

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

      // The brand logo doubles as the account avatar ("avatar" file field or URL)
      const brandUpdateData: any = {};
      if (uploadedFile) {
        userUpdateData.avatar = (await storeImage(uploadedFile, userId, "logos")).url;
        brandUpdateData.logoUrl = userUpdateData.avatar;
      } else if (avatar && typeof avatar === "string") {
        // URL was provided as string
        userUpdateData.avatar = parseHttpUrl(avatar, "avatar");
        brandUpdateData.logoUrl = userUpdateData.avatar;
      }
      if (userUpdateData.companyName) {
        brandUpdateData.companyName = userUpdateData.companyName;
      }
      if (websiteUrl !== undefined && websiteUrl !== "") {
        brandUpdateData.websiteUrl = parseHttpUrl(websiteUrl, "websiteUrl");
      }

      // Check if there's anything to update
      if (
        Object.keys(userUpdateData).length === 0 &&
        Object.keys(brandUpdateData).length === 0
      ) {
        return next(new ErrorHandler("No valid fields provided for update", 400));
      }

      // Update user model
      const updatedUser = await userModel
        .findByIdAndUpdate(userId, userUpdateData, { new: true })
        .select("-password");

      if (!updatedUser) {
        return next(new ErrorHandler("User not found", 404));
      }

      const brandProfile = await BrandModel.findOneAndUpdate(
        { userId },
        { $set: brandUpdateData },
        { new: true }
      );

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
          logoUrl: brandProfile?.logoUrl || null,
          websiteUrl: brandProfile?.websiteUrl || null,
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, Number(error.statusCode) || 400));
    }
  }
);

// PATCH /profile/change-password
export const changePassword = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id as string;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return next(
          new ErrorHandler("currentPassword and newPassword are required", 400)
        );
      }
      if (newPassword.length < 6) {
        return next(
          new ErrorHandler("New password must be at least 6 characters", 400)
        );
      }

      const user = await userModel.findById(userId).select("+password");
      if (!user) return next(new ErrorHandler("User not found", 404));

      if (!user.password) {
        return next(
          new ErrorHandler(
            "This account uses Google Sign-In and has no password set",
            400
          )
        );
      }

      const isMatch = await user.comparePassword!(currentPassword);
      if (!isMatch) {
        return next(new ErrorHandler("Current password is incorrect", 401));
      }

      user.password = newPassword;
      await user.save();

      res
        .status(200)
        .json({ success: true, message: "Password changed successfully" });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// PATCH /profile/notifications
export const updateNotifications = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id as string;
      const { emailNotifications, newCampaignAlerts, weeklyDigest } = req.body;

      const update: Record<string, boolean> = {};
      if (typeof emailNotifications === "boolean")
        update["notifications.emailNotifications"] = emailNotifications;
      if (typeof newCampaignAlerts === "boolean")
        update["notifications.newCampaignAlerts"] = newCampaignAlerts;
      if (typeof weeklyDigest === "boolean")
        update["notifications.weeklyDigest"] = weeklyDigest;

      if (Object.keys(update).length === 0) {
        return next(
          new ErrorHandler("No valid notification fields provided", 400)
        );
      }

      const updated = await userModel
        .findByIdAndUpdate(userId, { $set: update }, { new: true })
        .select("notifications");

      if (!updated) return next(new ErrorHandler("User not found", 404));

      res.status(200).json({
        success: true,
        message: "Notification preferences saved",
        notifications: updated.notifications,
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// DELETE /profile/account — requires password confirmation
export const deleteAccount = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?._id as string;
      const { password } = req.body;

      if (!password) {
        return next(
          new ErrorHandler("Password is required to delete your account", 400)
        );
      }

      const user = await userModel.findById(userId).select("+password");
      if (!user) return next(new ErrorHandler("User not found", 404));

      if (!user.password) {
        return next(
          new ErrorHandler(
            "This account uses Google Sign-In. Contact support to delete your account.",
            400
          )
        );
      }

      const isMatch = await user.comparePassword!(password);
      if (!isMatch) {
        return next(new ErrorHandler("Incorrect password", 401));
      }

      await userModel.findByIdAndDelete(userId);

      // Clear session cookies and redis
      res.cookie("access_token", "", { maxAge: 1 });
      res.cookie("refresh_token", "", { maxAge: 1 });
      try {
        await redis.del(userId);
      } catch (_) {}

      res
        .status(200)
        .json({ success: true, message: "Account deleted successfully" });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);
