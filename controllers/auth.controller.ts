import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import UserModel from "../models/user.model";
import BrandModel from "../models/brand.model";
import { sendToken } from "../utils/jwt";
import admin from "firebase-admin";
// ensure firebase admin is initialized (firebaseConfig reads env and calls initializeApp)
import "../firebaseConfig";
import jwt from "jsonwebtoken";
import { Secret } from "jsonwebtoken";
import path from "path";
import ejs from "ejs";
import sendMail from "../utils/sendEmail";
import { createActivationToken } from "./user.controller";
import { generateUsername, generateAvatar } from "../utils/userHelpers";

// Interface for password reset token payload
interface IResetTokenPayload {
  userId: string;
}

// Create password reset token
const createResetToken = (userId: string): string => {
  const token = jwt.sign(
    { userId } as IResetTokenPayload,
    process.env.ACTIVATION_SECRET as Secret,
    { expiresIn: "15m" }
  );

  return token;
};

// Google OAuth sign-in (client provides profile info or idToken)
export const googleAuth = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Accept either a firebase idToken or a minimal profile payload
      const { idToken, email, name, avatar, googleId, givenName, familyName } = req.body;

      let profile: {
        email: string;
        name?: string;
        picture?: string;
        uid?: string;
      } | null = null;

      if (idToken) {
        // verify with firebase-admin
        const decoded = await admin.auth().verifyIdToken(idToken);
        profile = {
          email: decoded.email || "",
          name: decoded.name,
          picture: decoded.picture,
          uid: decoded.uid,
        };
      } else if (email && googleId) {
        profile = { email, name, picture: avatar, uid: googleId };
      } else {
        return next(new ErrorHandler("Invalid Google payload", 400));
      }

      let user = await UserModel.findOne({ email: profile.email });
      if (!user) {
        // Prefer explicit givenName/familyName if provided by client
        let firstName = givenName || "";
        let lastName = familyName || "";

        if (!firstName) {
          const fullName = profile.name || profile.email.split("@")[0];
          const nameParts = fullName.split(" ");
          firstName = nameParts[0] || fullName;
          lastName = nameParts.slice(1).join(" ") || "";
        }

        const username = await generateUsername(profile.email);
        const avatar = profile.picture || generateAvatar(`${firstName} ${lastName}`.trim() || profile.email);

        user = await UserModel.create({
          firstName,
          lastName,
          username,
          email: profile.email,
          avatar,
          googleId: profile.uid,
          role: "gamer",
          isVerified: true,
        });
      } else {
        // ensure googleId is stored
        if (!user.googleId && profile.uid) {
          user.googleId = profile.uid;
          await user.save();
        }
      }

      // Mark user as online after successful Google login
      const redis = require("../utils/redis").redis;
      await redis.sadd("users:online", String(user._id));
      await redis.expire("users:online", 300); // 5 minutes expiry
      await redis.set(`user:${user._id}:last_active`, Date.now(), "EX", 300);

      sendToken(user, 200, res);
    } catch (error: any) {
      return next(new ErrorHandler(`Google authentication failed: ${error.message}`, 500));
    }
  }
);

// Gamer email signup (email + password registration)
export const registerGamer = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { firstName, lastName, email, password } = req.body;
      if (!email || !password || !firstName) {
        return next(
          new ErrorHandler(
            "Missing required fields: firstName, email, password",
            400
          )
        );
      }

      const existing = await UserModel.findOne({ email });
      if (existing) return next(new ErrorHandler("This email is already registered. Please use a different email or try logging in.", 409));

      const username = await generateUsername(email);
      const avatar = generateAvatar(`${firstName} ${lastName || ''}`.trim() || email);

      // Create activation token BEFORE creating user
      const activationToken = createActivationToken({
        firstName,
        lastName,
        email,
        password,
        role: "gamer",
      });
      const activationCode = activationToken.activationCode;
      const data = { user: { name: firstName }, activationCode };

      // Try to send email first
      try {
        await ejs.renderFile(
          path.join(__dirname, "../mails/activation-mail.ejs"),
          data
        );
        await sendMail({
          email,
          subject: "Verify your gamer account",
          template: "activation-mail.ejs",
          data,
        });

        // Only create user AFTER email is successfully sent
        const user = await UserModel.create({
          firstName,
          lastName: lastName || "",
          username,
          email,
          password,
          avatar,
          role: "gamer",
          isVerified: false,
        });

        res.status(201).json({
          success: true,
          message: "Registration successful! Please check your email to verify your account.",
          activationToken: activationToken.token,
        });
      } catch (mailErr: any) {
        // If email fails, return error with details
        console.error("Email sending failed:", mailErr);
        return next(
          new ErrorHandler(
            `Registration failed: Unable to send verification email. Please check your email configuration. Error: ${mailErr.message}`,
            500
          )
        );
      }
    } catch (error: any) {
      return next(new ErrorHandler(`Gamer registration failed: ${error.message}`, 500));
    }
  }
);

// Unified user activation (handles both gamer and brand)
export const activateUser = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { activation_token, activation_code } = req.body;
      if (!activation_token || !activation_code)
        return next(new ErrorHandler("Missing activation data", 400));

      const decoded = jwt.verify(
        activation_token,
        process.env.ACTIVATION_SECRET as Secret
      ) as any;
      if (!decoded)
        return next(new ErrorHandler("Invalid activation token", 400));

      if (decoded.activationCode !== activation_code)
        return next(new ErrorHandler("Invalid activation code", 400));

      const { email, password, role } = decoded.user;

      // Check if user already exists
      const existingUser = await UserModel.findOne({ email });
      if (existingUser) {
        if (existingUser.role !== role) {
          return next(
            new ErrorHandler("Email is registered as a different account type", 400)
          );
        }
        // Mark as verified if not already
        if (!existingUser.isVerified) {
          existingUser.isVerified = true;
          await existingUser.save();
        }
        // For brands, ensure brand profile exists
        if (role === "brand") {
          const { companyName } = decoded.user;
          const brandProfile = await BrandModel.findOne({ userId: existingUser._id });
          if (!brandProfile) {
            await BrandModel.create({
              userId: existingUser._id,
              companyEmail: email,
              companyName,
              campaigns: [],
            });
          }
        }
        sendToken(existingUser, 200, res);
        return;
      }

      // Create new user based on role
      let user;
      if (role === "gamer") {
        const { firstName, lastName } = decoded.user;
        const username = await generateUsername(email);
        const avatar = generateAvatar(`${firstName} ${lastName || ''}`.trim() || email);

        user = await UserModel.create({
          firstName,
          lastName: lastName || "",
          username,
          email,
          password,
          avatar,
          role: "gamer",
          isVerified: true,
        });
      } else if (role === "brand") {
        const { name, companyName } = decoded.user;

        user = await UserModel.create({
          name,
          email,
          password,
          role: "brand",
          companyName,
          isVerified: true,
        });

        // Create brand profile
        await BrandModel.create({
          userId: user._id,
          companyEmail: email,
          companyName,
          campaigns: [],
        });
      } else {
        return next(new ErrorHandler("Invalid account type", 400));
      }

      sendToken(user, 201, res);
    } catch (error: any) {
      return next(new ErrorHandler(`Account activation failed: ${error.message}`, 500));
    }
  }
);

// Unified login for both gamers and brands
export const login = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      if (!email || !password)
        return next(new ErrorHandler("Please provide both email and password", 400));

      const user = await UserModel.findOne({ email }).select("+password");
      if (!user)
        return next(new ErrorHandler("Invalid email or password. Please check your credentials and try again.", 401));

      const match = await user.comparePassword!(password);
      if (!match) return next(new ErrorHandler("Invalid email or password. Please check your credentials and try again.", 401));

      // Mark user as online after successful login
      const redis = require("../utils/redis").redis;
      await redis.sadd("users:online", String(user._id));
      await redis.expire("users:online", 300); // 5 minutes expiry
      await redis.set(`user:${user._id}:last_active`, Date.now(), "EX", 300);

      sendToken(user, 200, res);
    } catch (error: any) {
      return next(new ErrorHandler(`Login failed: ${error.message}`, 500));
    }
  }
);

// Brand registration (email/password)
export const registerBrand = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, email, password, companyName } = req.body;
      if (!email || !password || !companyName) {
        return next(new ErrorHandler("Missing required fields: email, password, and companyName are required", 400));
      }

      const existing = await UserModel.findOne({ email });
      if (existing) return next(new ErrorHandler("This email is already registered. Please use a different email or try logging in.", 409));

      // Create activation token BEFORE creating user
      const activationToken = createActivationToken({
        name,
        email,
        password,
        companyName,
        role: "brand",
      });
      const activationCode = activationToken.activationCode;
      const data = { user: { name }, activationCode };

      // Try to send email first
      try {
        await ejs.renderFile(
          path.join(__dirname, "../mails/activation-mail.ejs"),
          data
        );
        await sendMail({
          email,
          subject: "Activate your brand account",
          template: "activation-mail.ejs",
          data,
        });

        // Only create user and brand profile AFTER email is successfully sent
        const user = await UserModel.create({
          name,
          email,
          password,
          role: "brand",
          companyName,
          isVerified: false,
        });

        // create Brand profile
        await BrandModel.create({
          userId: user._id,
          companyEmail: email,
          companyName,
          campaigns: [],
        });

        res.status(201).json({
          success: true,
          message: "Registration successful! Please check your email to verify your account.",
          activationToken: activationToken.token,
        });
      } catch (mailErr: any) {
        // If email fails, return error with details
        console.error("Email sending failed:", mailErr);
        return next(
          new ErrorHandler(
            `Registration failed: Unable to send verification email. Please check your email configuration. Error: ${mailErr.message}`,
            500
          )
        );
      }
    } catch (error: any) {
      return next(new ErrorHandler(`Brand registration failed: ${error.message}`, 500));
    }
  }
);

export const logout = CatchAsyncError(async (req: Request, res: Response) => {
  // Mark user as offline
  const userId = (req as any).user?._id;
  if (userId) {
    const redis = require("../utils/redis").redis;
    await redis.srem("users:online", String(userId));
    await redis.srem("users:currently_playing", String(userId));
    await redis.del(`user:${userId}:last_active`);
    await redis.del(`user:${userId}:playing`);
  }

  res.cookie("access_token", "", { maxAge: 1 });
  res.cookie("refresh_token", "", { maxAge: 1 });
  res.status(200).json({ success: true });
});


// Resend activation email (unified for both gamer and brand)
export const resendActivation = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;

      if (!email) {
        return next(new ErrorHandler("Email is required", 400));
      }

      // Find user
      const user = await UserModel.findOne({ email });
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      if (user.isVerified) {
        return next(new ErrorHandler("Account is already verified", 400));
      }

      // Create activation token based on role
      let activationToken;
      let displayName;

      if (user.role === "gamer") {
        activationToken = createActivationToken({
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          password: user.password,
          role: "gamer",
        });
        displayName = user.firstName;
      } else if (user.role === "brand") {
        activationToken = createActivationToken({
          name: user.name,
          email: user.email,
          password: user.password,
          companyName: user.companyName,
          role: "brand",
        });
        displayName = user.name;
      } else {
        return next(new ErrorHandler("Invalid account type", 400));
      }

      const activationCode = activationToken.activationCode;
      const data = { user: { name: displayName }, activationCode };

      // Send activation email
      await sendMail({
        email: user.email,
        subject: "Verify your account",
        template: "activation-mail.ejs",
        data,
      });

      res.status(200).json({
        success: true,
        message: `Activation email resent to ${email}`,
        activationToken: activationToken.token,
      });
    } catch (error: any) {
      return next(new ErrorHandler(`Failed to resend activation email: ${error.message}`, 500));
    }
  }
);

// Forgot password - send reset link to email
export const forgotPassword = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;

      if (!email) {
        return next(new ErrorHandler("Email is required", 400));
      }

      // Find user by email
      const user = await UserModel.findOne({ email });
      if (!user) {
        // Don't reveal if email exists or not for security
        return res.status(200).json({
          success: true,
          message: "If an account with that email exists, a password reset link has been sent.",
        });
      }

      // Check if user has a password (not just Google OAuth user)
      if (!user.password && user.googleId) {
        return next(
          new ErrorHandler(
            "This account uses Google Sign-In. Please log in with Google instead.",
            400
          )
        );
      }

      // Create reset token
      const resetToken = createResetToken(String(user._id));

      // Build reset link
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

      // Get user display name
      const userName = user.firstName || user.name || user.email.split("@")[0];

      // Send reset email with link
      const data = { user: { name: userName }, resetLink };

      try {
        await sendMail({
          email: user.email,
          subject: "Reset Your Password - Tex Resolve",
          template: "reset-password.ejs",
          data,
        });

        res.status(200).json({
          success: true,
          message: "Password reset link sent to your email.",
        });
      } catch (mailErr: any) {
        console.error("Failed to send reset email:", mailErr);
        console.error("Error details:", {
          message: mailErr.message,
          response: mailErr.response?.body || mailErr.response,
          code: mailErr.code,
        });
        return next(
          new ErrorHandler(
            `Failed to send password reset email: ${mailErr.message}`,
            500
          )
        );
      }
    } catch (error: any) {
      return next(new ErrorHandler(`Forgot password failed: ${error.message}`, 500));
    }
  }
);

// Reset password - verify token and set new password
export const resetPassword = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, new_password } = req.body;

      if (!token || !new_password) {
        return next(
          new ErrorHandler(
            "Missing required fields: token, new_password",
            400
          )
        );
      }

      // Validate password strength
      if (new_password.length < 6) {
        return next(
          new ErrorHandler("Password must be at least 6 characters long", 400)
        );
      }

      // Verify reset token
      let decoded: IResetTokenPayload;
      try {
        decoded = jwt.verify(
          token,
          process.env.ACTIVATION_SECRET as Secret
        ) as IResetTokenPayload;
      } catch (err: any) {
        if (err.name === "TokenExpiredError") {
          return next(
            new ErrorHandler("Reset link has expired. Please request a new one.", 400)
          );
        }
        return next(new ErrorHandler("Invalid reset token", 400));
      }

      // Find user
      const user = await UserModel.findById(decoded.userId);
      if (!user) {
        return next(new ErrorHandler("User not found", 404));
      }

      // Update password
      user.password = new_password;
      await user.save();

      res.status(200).json({
        success: true,
        message: "Password reset successful. You can now log in with your new password.",
      });
    } catch (error: any) {
      return next(new ErrorHandler(`Reset password failed: ${error.message}`, 500));
    }
  }
);
