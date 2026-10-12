import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "./ErrorHandler";
import jwt, { JwtPayload } from "jsonwebtoken";
import { redis } from "./redis";
import userModel from "../models/user.model";

import 'dotenv/config';

import { IUser } from "../models/user.model";

//using interface for req.user
declare module 'express' {
  interface Request {
    user?: IUser;
  }
}

//Authenticate user
export const isAuthenticated = CatchAsyncError(
    async (req: Request, res: Response, next: NextFunction) => {
      try {
          // Access the authorization header to validate the request
          const authHeader = req.headers.authorization;

          if (!authHeader) {
            return res.status(401).json({ error: "Authentication Failed" });
          }

          // Extract the token from the authorization header
          const token = authHeader.split(" ")[1];

          //Verify token
          const decoded = jwt.verify(token, process.env.ACCESS_TOKEN as string) as JwtPayload;
          if(!decoded){
            return next(new ErrorHandler("Access token not valid", 400));
          }

          // The Redis entry proves the session is still open (logout deletes it)...
          const session = await redis.get(decoded.id);
          if(!session){
            return next(new ErrorHandler("User not found", 400));
          }

          // ...but role, plan and counters are always read fresh from MongoDB, so a
          // cached session can never grant a stale role or an expired Pro plan.
          const user = await userModel.findById(decoded.id).select("-password");
          if(!user){
            return next(new ErrorHandler("User not found", 400));
          }
          // toObject() applies schema defaults (e.g. role "gamer" on old accounts that
          // never stored one). _id stays a plain string, as it was when req.user came
          // from the Redis JSON.
          req.user = { ...user.toObject(), _id: String(user._id) } as unknown as IUser;
          next();

      } catch (error: any) {
        return next(new ErrorHandler(error.message, 400));
      }
    }
  );

//validate user role
export const authorizeRoles = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(req.user?.role || "")) {
      return next(
        new ErrorHandler(
          `Role: ${req.user?.role} is not allowed to access this resource`, 403
        )
      );
    }
    next();
  };
};
