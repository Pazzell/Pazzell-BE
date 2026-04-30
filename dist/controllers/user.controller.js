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
exports.clearAllGamerData = exports.getAllGamers = exports.updateBrandProfile = exports.updateGamerProfile = exports.getBrandProfile = exports.getGamerProfile = exports.getUserInfo = exports.updateAccessToken = exports.logoutUser = exports.loginUser = exports.activateUser = exports.createActivationToken = exports.registerUser = void 0;
const user_model_1 = __importDefault(require("../models/user.model"));
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const puzzleAttempt_model_1 = __importDefault(require("../models/puzzleAttempt.model"));
const leaderboard_model_1 = __importDefault(require("../models/leaderboard.model"));
const firebaseConfig_1 = require("../firebaseConfig");
const ejs_1 = __importDefault(require("ejs"));
const path_1 = __importDefault(require("path"));
const sendEmail_1 = __importDefault(require("../utils/sendEmail"));
const redis_1 = require("../utils/redis");
require("dotenv/config");
const jwt_1 = require("../utils/jwt");
//Register user
exports.registerUser = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, email, password } = req.body;
        //Check if email already exists
        const isEmailExist = yield user_model_1.default.findOne({ email });
        if (isEmailExist) {
            return next(new ErrorHandler_1.default("Email already exists", 400));
        }
        const user = {
            name,
            email,
            password,
        };
        const activationToken = (0, exports.createActivationToken)(user);
        const activationCode = activationToken.activationCode;
        const data = { user: { name: user.name }, activationCode };
        yield ejs_1.default.renderFile(path_1.default.join(__dirname, "../mails/activation-mail.ejs"), data);
        //send email to user
        try {
            yield (0, sendEmail_1.default)({
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
        }
        catch (error) {
            console.log(error);
            return next(new ErrorHandler_1.default(error.message, 400));
        }
    }
    catch (error) {
        console.log(error);
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
const createActivationToken = (user) => {
    const activationCode = Math.floor(1000 + Math.random() * 9000).toString();
    const token = jsonwebtoken_1.default.sign({
        user,
        activationCode,
    }, process.env.ACTIVATION_SECRET, {
        expiresIn: "5m",
    });
    return { token, activationCode };
};
exports.createActivationToken = createActivationToken;
exports.activateUser = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { activation_token, activation_code } = req.body;
        const newUser = jsonwebtoken_1.default.verify(activation_token, process.env.ACTIVATION_SECRET);
        if (newUser.activationCode !== activation_code) {
            return next(new ErrorHandler_1.default("Invalid activation code", 400));
        }
        const { name, email, password } = newUser.user;
        const existUser = yield user_model_1.default.findOne({ email });
        if (existUser) {
            return next(new ErrorHandler_1.default("Email already exist", 400));
        }
        //store user data in database
        yield user_model_1.default.create({
            name,
            email,
            password,
        });
        res.status(201).json({
            success: true,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
exports.loginUser = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            res.status(400).json({
                message: "Invalid credentials",
            });
        }
        const user = yield user_model_1.default.findOne({ email }).select("+password");
        if (!user) {
            return next(new ErrorHandler_1.default("Invalid email or password. Please check your credentials and try again.", 401));
        }
        //check password
        const isPasswordMatch = yield ((_a = user.comparePassword) === null || _a === void 0 ? void 0 : _a.call(user, password));
        if (!isPasswordMatch) {
            return next(new ErrorHandler_1.default("Invalid email or password. Please check your credentials and try again.", 401));
        }
        (0, jwt_1.sendToken)(user, 200, res);
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Login failed: ${error.message}`, 500));
    }
}));
//logout user
exports.logoutUser = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        res.cookie("access_token", "", { maxAge: 1 });
        res.cookie("refresh_token", "", { maxAge: 1 });
        // delete cache from redis
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id;
        redis_1.redis.del(userId);
        res.status(200).json({
            success: true,
            message: "logged out successfully",
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// update access token
exports.updateAccessToken = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const refresh_token = req.cookies.refresh_token;
        //Verify refresh token
        const decoded = jsonwebtoken_1.default.verify(refresh_token, process.env.REFRESH_TOKEN);
        if (!decoded) {
            return next(new ErrorHandler_1.default("Could not refresh access token", 400));
        }
        //Get user id
        const session = yield redis_1.redis.get(decoded.id);
        if (!session) {
            return next(new ErrorHandler_1.default("Could not refresh access token", 400));
        }
        const user = JSON.parse(session);
        //create access and refresh token
        const accessToken = jsonwebtoken_1.default.sign({ id: user._id }, process.env.ACCESS_TOKEN, {
            expiresIn: "5m",
        });
        const refreshToken = jsonwebtoken_1.default.sign({ id: user._id }, process.env.REFRESH_TOKEN, {
            expiresIn: "3d",
        });
        req.user = user;
        res.cookie("access_token", accessToken, jwt_1.accessTokenOptions);
        res.cookie("refresh_token", refreshToken, jwt_1.refreshTokenOptions);
        res.status(200).json({
            success: true,
            accessToken,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// get user
exports.getUserInfo = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id;
        const userJson = yield redis_1.redis.get(userId);
        if (userJson) {
            const user = JSON.parse(userJson);
            res.status(200).json({
                success: true,
                user,
            });
        }
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// Get gamer profile with full analytics
exports.getGamerProfile = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id;
        if (!req.user || req.user.role !== "gamer") {
            return next(new ErrorHandler_1.default("Access denied. Gamer profile only.", 403));
        }
        const user = yield user_model_1.default.findById(userId).select("-password").lean();
        if (!user) {
            return next(new ErrorHandler_1.default("User not found", 404));
        }
        // Calculate current week's leaderboard position
        const now = new Date();
        const dayOfWeek = now.getDay();
        const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysFromMonday);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        // Get current week's leaderboard for position
        const weeklyLeaderboard = yield puzzleAttempt_model_1.default.aggregate([
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
        const weeklyUserIndex = weeklyLeaderboard.findIndex((entry) => entry._id.toString() === userId.toString());
        if (weeklyUserIndex !== -1) {
            weeklyLeaderboardPosition = weeklyUserIndex + 1;
        }
        // Get all-time leaderboard for position
        const allTimeLeaderboard = yield puzzleAttempt_model_1.default.aggregate([
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
        const allTimeUserIndex = allTimeLeaderboard.findIndex((entry) => entry._id.toString() === userId.toString());
        if (allTimeUserIndex !== -1) {
            allTimeLeaderboardPosition = allTimeUserIndex + 1;
        }
        // Calculate weekly analytics from puzzle attempts
        const weeklyAttempts = yield puzzleAttempt_model_1.default.find({
            userId: userId,
            timestamp: { $gte: weekStart, $lte: weekEnd },
        }).lean();
        const weeklyStats = weeklyAttempts.reduce((acc, attempt) => {
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
        }, {
            puzzlesSolved: 0,
            totalPoints: 0,
            totalEarnings: 0,
            totalTime: 0,
            totalMoves: 0,
            attempts: 0,
            successfulAttempts: 0,
            successRate: 0,
        });
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
                        puzzlesSolved: ((_c = (_b = user.analytics) === null || _b === void 0 ? void 0 : _b.lifetime) === null || _c === void 0 ? void 0 : _c.puzzlesSolved) || 0,
                        totalPoints: ((_e = (_d = user.analytics) === null || _d === void 0 ? void 0 : _d.lifetime) === null || _e === void 0 ? void 0 : _e.totalPoints) || 0,
                        totalEarnings: ((_g = (_f = user.analytics) === null || _f === void 0 ? void 0 : _f.lifetime) === null || _g === void 0 ? void 0 : _g.totalEarnings) || 0,
                        totalTime: ((_j = (_h = user.analytics) === null || _h === void 0 ? void 0 : _h.lifetime) === null || _j === void 0 ? void 0 : _j.totalTime) || 0,
                        totalMoves: ((_l = (_k = user.analytics) === null || _k === void 0 ? void 0 : _k.lifetime) === null || _l === void 0 ? void 0 : _l.totalMoves) || 0,
                        attempts: ((_o = (_m = user.analytics) === null || _m === void 0 ? void 0 : _m.lifetime) === null || _o === void 0 ? void 0 : _o.attempts) || 0,
                        successRate: ((_q = (_p = user.analytics) === null || _p === void 0 ? void 0 : _p.lifetime) === null || _q === void 0 ? void 0 : _q.successRate) || 0,
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
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch gamer profile: ${error.message}`, 500));
    }
}));
// Get brand profile with brand details and campaigns
exports.getBrandProfile = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id;
        if (!req.user || req.user.role !== "brand") {
            return next(new ErrorHandler_1.default("Access denied. Brand profile only.", 403));
        }
        const user = yield user_model_1.default.findById(userId).select("-password").lean();
        if (!user) {
            return next(new ErrorHandler_1.default("User not found", 404));
        }
        // Get brand details
        const BrandModel = require("../models/brand.model").default;
        const brandProfile = yield BrandModel.findOne({ userId }).lean();
        // Get campaign count only (not the full list for better performance)
        const PuzzleCampaignModel = require("../models/puzzleCampaign.model").default;
        const totalCampaigns = yield PuzzleCampaignModel.countDocuments({
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
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
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
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// Update gamer profile
exports.updateGamerProfile = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id;
        if (!req.user || req.user.role !== "gamer") {
            return next(new ErrorHandler_1.default("Access denied. Gamer profile only.", 403));
        }
        const { firstName, lastName, username, avatar } = req.body;
        // Build update object with only provided fields
        const updateData = {};
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
            const existingUser = yield user_model_1.default.findOne({
                username: trimmedUsername,
                _id: { $ne: userId } // Exclude current user
            });
            if (existingUser) {
                return next(new ErrorHandler_1.default("Username is already taken. Please choose a different username.", 400));
            }
            updateData.username = trimmedUsername;
        }
        // Handle avatar upload (file or URL)
        const uploadedFile = req.file;
        if (uploadedFile) {
            // File was uploaded - upload to Firebase Storage
            const now = Date.now();
            const avatarName = `avatars/${userId}-${now}-${uploadedFile.originalname}`;
            const fileRef = firebaseConfig_1.bucket.file(avatarName);
            yield fileRef.save(uploadedFile.buffer, {
                resumable: false,
                contentType: uploadedFile.mimetype,
            });
            yield fileRef.makePublic();
            updateData.avatar = `https://storage.googleapis.com/${firebaseConfig_1.bucket.name}/${avatarName}`;
        }
        else if (avatar && typeof avatar === "string") {
            // URL was provided as string
            updateData.avatar = avatar;
        }
        // Check if there's anything to update
        if (Object.keys(updateData).length === 0) {
            return next(new ErrorHandler_1.default("No valid fields provided for update", 400));
        }
        const updatedUser = yield user_model_1.default
            .findByIdAndUpdate(userId, updateData, { new: true })
            .select("-password");
        if (!updatedUser) {
            return next(new ErrorHandler_1.default("User not found", 404));
        }
        // Update redis cache if exists
        try {
            yield redis_1.redis.set(userId, JSON.stringify(updatedUser));
        }
        catch (redisErr) {
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
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// Update brand profile
exports.updateBrandProfile = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id;
        if (!req.user || req.user.role !== "brand") {
            return next(new ErrorHandler_1.default("Access denied. Brand profile only.", 403));
        }
        const { name, avatar, companyName } = req.body;
        // Build update object for user model with only provided fields
        const userUpdateData = {};
        if (name && typeof name === "string" && name.trim() !== "") {
            userUpdateData.name = name.trim();
        }
        if (companyName && typeof companyName === "string" && companyName.trim() !== "") {
            userUpdateData.companyName = companyName.trim();
        }
        // Handle avatar upload (file or URL)
        const uploadedFile = req.file;
        if (uploadedFile) {
            // File was uploaded - upload to Firebase Storage
            const now = Date.now();
            const avatarName = `avatars/${userId}-${now}-${uploadedFile.originalname}`;
            const fileRef = firebaseConfig_1.bucket.file(avatarName);
            yield fileRef.save(uploadedFile.buffer, {
                resumable: false,
                contentType: uploadedFile.mimetype,
            });
            yield fileRef.makePublic();
            userUpdateData.avatar = `https://storage.googleapis.com/${firebaseConfig_1.bucket.name}/${avatarName}`;
        }
        else if (avatar && typeof avatar === "string") {
            // URL was provided as string
            userUpdateData.avatar = avatar;
        }
        // Check if there's anything to update
        if (Object.keys(userUpdateData).length === 0) {
            return next(new ErrorHandler_1.default("No valid fields provided for update", 400));
        }
        // Update user model
        const updatedUser = yield user_model_1.default
            .findByIdAndUpdate(userId, userUpdateData, { new: true })
            .select("-password");
        if (!updatedUser) {
            return next(new ErrorHandler_1.default("User not found", 404));
        }
        // If companyName is updated, also update brand profile
        if (companyName) {
            const BrandModel = require("../models/brand.model").default;
            yield BrandModel.findOneAndUpdate({ userId }, { companyName: companyName.trim() });
        }
        // Update redis cache if exists
        try {
            yield redis_1.redis.set(userId, JSON.stringify(updatedUser));
        }
        catch (redisErr) {
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
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// Get all gamers
exports.getAllGamers = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Find all users who are NOT brands or admins (includes users with role 'gamer' or no role set)
        const gamerUsers = yield user_model_1.default.find({
            role: { $nin: ["brand", "admin"] }
        })
            .select("_id firstName lastName username email avatar isVerified analytics puzzlesSolved createdAt")
            .lean();
        const gamers = gamerUsers.map((gamer) => {
            var _a;
            return ({
                _id: gamer._id,
                firstName: gamer.firstName,
                lastName: gamer.lastName,
                username: gamer.username,
                email: gamer.email,
                avatar: gamer.avatar,
                isVerified: gamer.isVerified,
                analytics: gamer.analytics,
                totalPuzzlesSolved: ((_a = gamer.puzzlesSolved) === null || _a === void 0 ? void 0 : _a.length) || 0,
                createdAt: gamer.createdAt,
            });
        });
        res.status(200).json({ success: true, gamers });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// Clear all gamer data (Admin only)
exports.clearAllGamerData = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { confirm } = req.body;
        if (!confirm || confirm !== true) {
            return next(new ErrorHandler_1.default("Please confirm this action by sending { confirm: true } in the request body", 400));
        }
        // Delete all puzzle attempts
        const puzzleAttemptsDeleted = yield puzzleAttempt_model_1.default.deleteMany({});
        // Reset all gamer analytics to zero
        const usersUpdateResult = yield user_model_1.default.updateMany({ role: { $nin: ["brand", "admin"] } }, {
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
        });
        // Clear all leaderboard records
        const leaderboardsDeleted = yield leaderboard_model_1.default.deleteMany({});
        res.status(200).json({
            success: true,
            message: "All gamer data cleared successfully",
            summary: {
                puzzleAttemptsDeleted: puzzleAttemptsDeleted.deletedCount,
                usersReset: usersUpdateResult.modifiedCount,
                leaderboardsCleared: leaderboardsDeleted.deletedCount,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to clear gamer data: ${error.message}`, 500));
    }
}));
