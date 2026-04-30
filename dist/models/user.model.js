"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
require("dotenv/config");
const userSchema = new mongoose_1.default.Schema({
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
}, { timestamps: true });
userSchema.methods.SignAccessToken = function () {
    // Normalize ACCESS_TOKEN_EXPIRE: allow numeric (hours) or string like '1d'/'24h'
    const raw = process.env.ACCESS_TOKEN_EXPIRE || "24h";
    const expiresIn = isNaN(Number(raw)) ? raw : `${Number(raw)}h`;
    return jsonwebtoken_1.default.sign({ id: this._id }, process.env.ACCESS_TOKEN || "", {
        expiresIn,
    });
};
userSchema.methods.SignRefreshToken = function () {
    const raw = process.env.REFRESH_TOKEN_EXPIRE || "3d";
    const expiresIn = isNaN(Number(raw)) ? raw : `${Number(raw)}d`;
    return jsonwebtoken_1.default.sign({ id: this._id }, process.env.REFRESH_TOKEN || "", {
        expiresIn,
    });
};
userSchema.pre("save", function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!this.isModified("password") || !this.password)
            return next();
        this.password = yield bcryptjs_1.default.hash(this.password, 10);
        next();
    });
});
userSchema.methods.comparePassword = function (enteredPassword) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!this.password)
            return false;
        return yield bcryptjs_1.default.compare(enteredPassword, this.password);
    });
};
const userModel = mongoose_1.default.model("User", userSchema);
exports.default = userModel;
