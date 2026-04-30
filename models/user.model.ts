import mongoose, { Document, Model, Schema } from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import "dotenv/config";

export interface IUserAnalytics {
  lifetime: {
    puzzlesSolved: number;
    totalPoints: number;
    totalEarnings: number;
    totalTime: number; // in ms
    totalMoves: number;
    attempts: number;
    successRate: number; // ratio
  };
  daily?: {
    date: string;
    puzzlesSolved: number;
  };
}

export interface IUser extends Document {
  name?: string; // deprecated, kept for brand users
  firstName?: string; // for gamer users
  lastName?: string; // for gamer users
  username?: string; // for gamer users
  email: string;
  password?: string;
  avatar?: string;
  role: "gamer" | "brand" | "admin";
  googleId?: string;
  companyName?: string; // for brand users
  isVerified: boolean;
  analytics: IUserAnalytics;
  puzzlesSolved: string[]; // puzzle ids
  comparePassword?: (password: string) => Promise<boolean>;
  SignAccessToken: () => string;
  SignRefreshToken: () => string;
}

const userSchema: Schema<IUser> = new mongoose.Schema(
  {
    name: { type: String },
    firstName: { type: String },
    lastName: { type: String },
    username: { type: String, unique: true, sparse: true },
    email: { type: String, required: true, index: true, unique: true },
    password: { type: String },
    avatar: { type: String },
    role: { type: String, enum: ["gamer", "brand", "admin"], default: "gamer" },
    googleId: { type: String },
    companyName: { type: String },
    isVerified: { type: Boolean, default: false },
    analytics: {
      lifetime: {
        puzzlesSolved: { type: Number, default: 0 },
        totalPoints: { type: Number, default: 0 },
        totalEarnings: { type: Number, default: 0 },
        totalTime: { type: Number, default: 0 },
        totalMoves: { type: Number, default: 0 },
        attempts: { type: Number, default: 0 },
        successRate: { type: Number, default: 0 },
      },
      daily: {
        date: { type: String },
        puzzlesSolved: { type: Number, default: 0 },
      },
    },
    puzzlesSolved: [{ type: String }],
  },
  { timestamps: true }
);

userSchema.methods.SignAccessToken = function () {
  // Normalize ACCESS_TOKEN_EXPIRE: allow numeric (hours) or string like '1d'/'24h'
  const raw = process.env.ACCESS_TOKEN_EXPIRE || "24h";
  const expiresIn = isNaN(Number(raw)) ? raw : `${Number(raw)}h`;
  return jwt.sign({ id: this._id }, process.env.ACCESS_TOKEN || "", {
    expiresIn,
  });
};

userSchema.methods.SignRefreshToken = function () {
  const raw = process.env.REFRESH_TOKEN_EXPIRE || "3d";
  const expiresIn = isNaN(Number(raw)) ? raw : `${Number(raw)}d`;
  return jwt.sign({ id: this._id }, process.env.REFRESH_TOKEN || "", {
    expiresIn,
  });
};

userSchema.pre<IUser>("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (
  enteredPassword: string
): Promise<boolean> {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

const userModel: Model<IUser> = mongoose.model("User", userSchema);
export default userModel;
