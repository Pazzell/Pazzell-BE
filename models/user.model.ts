import mongoose, { Document, Model, Schema } from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import "dotenv/config";

export interface IUserNotifications {
  emailNotifications: boolean;
  newCampaignAlerts: boolean;
  weeklyDigest: boolean;
}

export interface IUser extends Document {
  name?: string; // deprecated, kept for brand users
  firstName?: string; // for gamer users
  lastName?: string; // for gamer users
  username?: string; // for gamer users
  email: string;
  password?: string;
  avatar?: string;
  // "gamer" is the player role (the product's "user" role)
  role: "gamer" | "brand" | "admin";
  googleId?: string;
  companyName?: string; // for brand users
  isVerified: boolean;
  notifications: IUserNotifications;
  // Pro is active while proUntil > now (UTC). Never set from client input —
  // only services/plan/plan.service.ts writes it after a verified payment.
  proUntil?: Date | null;
  // The plan state (isPro) the owner's custom-quiz locks were last applied for.
  // When it differs from the live plan the locks are re-applied
  // (see services/customQuiz/quizLock.service.ts).
  quizLocksSyncedAsPro: boolean;
  // Non-campaign trivias completed since the last completed campaign trivia.
  nonCampaignPlaysSinceCampaign: number;
  // Perfect-quiz points (see services/points/points.service.ts). `monthly` belongs to
  // `month` ("YYYY-MM") and `today` to `day` ("YYYY-MM-DD"), both Lagos time;
  // `lifetime` counts every point ever earned.
  points: {
    month: string | null;
    monthly: number;
    lifetime: number;
    day: string | null;
    today: number;
  };
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
    notifications: {
      emailNotifications: { type: Boolean, default: true },
      newCampaignAlerts: { type: Boolean, default: true },
      weeklyDigest: { type: Boolean, default: true },
    },
    proUntil: { type: Date, default: null },
    quizLocksSyncedAsPro: { type: Boolean, default: false },
    nonCampaignPlaysSinceCampaign: { type: Number, default: 0, min: 0 },
    points: {
      month: { type: String, default: null },
      monthly: { type: Number, default: 0, min: 0 },
      lifetime: { type: Number, default: 0, min: 0 },
      day: { type: String, default: null },
      today: { type: Number, default: 0, min: 0 },
    },
  },
  { timestamps: true }
);

// Pro-expiry sweep: users whose plan lapsed but whose quizzes are still unlocked
userSchema.index({ quizLocksSyncedAsPro: 1, proUntil: 1 });
// Month-end points sweep: players whose monthly score belongs to an ended month
userSchema.index({ "points.month": 1 });

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
