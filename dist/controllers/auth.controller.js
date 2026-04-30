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
exports.resetPassword = exports.forgotPassword = exports.resendActivation = exports.logout = exports.registerBrand = exports.login = exports.activateUser = exports.registerGamer = exports.googleAuth = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const user_model_1 = __importDefault(require("../models/user.model"));
const brand_model_1 = __importDefault(require("../models/brand.model"));
const jwt_1 = require("../utils/jwt");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
// ensure firebase admin is initialized (firebaseConfig reads env and calls initializeApp)
require("../firebaseConfig");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const path_1 = __importDefault(require("path"));
const ejs_1 = __importDefault(require("ejs"));
const sendEmail_1 = __importDefault(require("../utils/sendEmail"));
const user_controller_1 = require("./user.controller");
const userHelpers_1 = require("../utils/userHelpers");
// Create password reset token
const createResetToken = (userId) => {
    const token = jsonwebtoken_1.default.sign({ userId }, process.env.ACTIVATION_SECRET, { expiresIn: "15m" });
    return token;
};
// Google OAuth sign-in (client provides profile info or idToken)
exports.googleAuth = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Accept either a firebase idToken or a minimal profile payload
        const { idToken, email, name, avatar, googleId, givenName, familyName } = req.body;
        let profile = null;
        if (idToken) {
            // verify with firebase-admin
            const decoded = yield firebase_admin_1.default.auth().verifyIdToken(idToken);
            profile = {
                email: decoded.email || "",
                name: decoded.name,
                picture: decoded.picture,
                uid: decoded.uid,
            };
        }
        else if (email && googleId) {
            profile = { email, name, picture: avatar, uid: googleId };
        }
        else {
            return next(new ErrorHandler_1.default("Invalid Google payload", 400));
        }
        let user = yield user_model_1.default.findOne({ email: profile.email });
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
            const username = yield (0, userHelpers_1.generateUsername)(profile.email);
            const avatar = profile.picture || (0, userHelpers_1.generateAvatar)(`${firstName} ${lastName}`.trim() || profile.email);
            user = yield user_model_1.default.create({
                firstName,
                lastName,
                username,
                email: profile.email,
                avatar,
                googleId: profile.uid,
                role: "gamer",
                isVerified: true,
            });
        }
        else {
            // ensure googleId is stored
            if (!user.googleId && profile.uid) {
                user.googleId = profile.uid;
                yield user.save();
            }
        }
        // Mark user as online after successful Google login
        const redis = require("../utils/redis").redis;
        yield redis.sadd("users:online", String(user._id));
        yield redis.expire("users:online", 300); // 5 minutes expiry
        yield redis.set(`user:${user._id}:last_active`, Date.now(), "EX", 300);
        (0, jwt_1.sendToken)(user, 200, res);
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Google authentication failed: ${error.message}`, 500));
    }
}));
// Gamer email signup (email + password registration)
exports.registerGamer = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { firstName, lastName, email, password } = req.body;
        if (!email || !password || !firstName) {
            return next(new ErrorHandler_1.default("Missing required fields: firstName, email, password", 400));
        }
        const existing = yield user_model_1.default.findOne({ email });
        if (existing)
            return next(new ErrorHandler_1.default("This email is already registered. Please use a different email or try logging in.", 409));
        const username = yield (0, userHelpers_1.generateUsername)(email);
        const avatar = (0, userHelpers_1.generateAvatar)(`${firstName} ${lastName || ''}`.trim() || email);
        // Create activation token BEFORE creating user
        const activationToken = (0, user_controller_1.createActivationToken)({
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
            yield ejs_1.default.renderFile(path_1.default.join(__dirname, "../mails/activation-mail.ejs"), data);
            yield (0, sendEmail_1.default)({
                email,
                subject: "Verify your gamer account",
                template: "activation-mail.ejs",
                data,
            });
            // Only create user AFTER email is successfully sent
            const user = yield user_model_1.default.create({
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
        }
        catch (mailErr) {
            // If email fails, return error with details
            console.error("Email sending failed:", mailErr);
            return next(new ErrorHandler_1.default(`Registration failed: Unable to send verification email. Please check your email configuration. Error: ${mailErr.message}`, 500));
        }
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Gamer registration failed: ${error.message}`, 500));
    }
}));
// Unified user activation (handles both gamer and brand)
exports.activateUser = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { activation_token, activation_code } = req.body;
        if (!activation_token || !activation_code)
            return next(new ErrorHandler_1.default("Missing activation data", 400));
        const decoded = jsonwebtoken_1.default.verify(activation_token, process.env.ACTIVATION_SECRET);
        if (!decoded)
            return next(new ErrorHandler_1.default("Invalid activation token", 400));
        if (decoded.activationCode !== activation_code)
            return next(new ErrorHandler_1.default("Invalid activation code", 400));
        const { email, password, role } = decoded.user;
        // Check if user already exists
        const existingUser = yield user_model_1.default.findOne({ email });
        if (existingUser) {
            if (existingUser.role !== role) {
                return next(new ErrorHandler_1.default("Email is registered as a different account type", 400));
            }
            // Mark as verified if not already
            if (!existingUser.isVerified) {
                existingUser.isVerified = true;
                yield existingUser.save();
            }
            // For brands, ensure brand profile exists
            if (role === "brand") {
                const { companyName } = decoded.user;
                const brandProfile = yield brand_model_1.default.findOne({ userId: existingUser._id });
                if (!brandProfile) {
                    yield brand_model_1.default.create({
                        userId: existingUser._id,
                        companyEmail: email,
                        companyName,
                        campaigns: [],
                    });
                }
            }
            (0, jwt_1.sendToken)(existingUser, 200, res);
            return;
        }
        // Create new user based on role
        let user;
        if (role === "gamer") {
            const { firstName, lastName } = decoded.user;
            const username = yield (0, userHelpers_1.generateUsername)(email);
            const avatar = (0, userHelpers_1.generateAvatar)(`${firstName} ${lastName || ''}`.trim() || email);
            user = yield user_model_1.default.create({
                firstName,
                lastName: lastName || "",
                username,
                email,
                password,
                avatar,
                role: "gamer",
                isVerified: true,
            });
        }
        else if (role === "brand") {
            const { name, companyName } = decoded.user;
            user = yield user_model_1.default.create({
                name,
                email,
                password,
                role: "brand",
                companyName,
                isVerified: true,
            });
            // Create brand profile
            yield brand_model_1.default.create({
                userId: user._id,
                companyEmail: email,
                companyName,
                campaigns: [],
            });
        }
        else {
            return next(new ErrorHandler_1.default("Invalid account type", 400));
        }
        (0, jwt_1.sendToken)(user, 201, res);
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Account activation failed: ${error.message}`, 500));
    }
}));
// Unified login for both gamers and brands
exports.login = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return next(new ErrorHandler_1.default("Please provide both email and password", 400));
        const user = yield user_model_1.default.findOne({ email }).select("+password");
        if (!user)
            return next(new ErrorHandler_1.default("Invalid email or password. Please check your credentials and try again.", 401));
        const match = yield user.comparePassword(password);
        if (!match)
            return next(new ErrorHandler_1.default("Invalid email or password. Please check your credentials and try again.", 401));
        // Mark user as online after successful login
        const redis = require("../utils/redis").redis;
        yield redis.sadd("users:online", String(user._id));
        yield redis.expire("users:online", 300); // 5 minutes expiry
        yield redis.set(`user:${user._id}:last_active`, Date.now(), "EX", 300);
        (0, jwt_1.sendToken)(user, 200, res);
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Login failed: ${error.message}`, 500));
    }
}));
// Brand registration (email/password)
exports.registerBrand = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, email, password, companyName } = req.body;
        if (!email || !password || !companyName) {
            return next(new ErrorHandler_1.default("Missing required fields: email, password, and companyName are required", 400));
        }
        const existing = yield user_model_1.default.findOne({ email });
        if (existing)
            return next(new ErrorHandler_1.default("This email is already registered. Please use a different email or try logging in.", 409));
        // Create activation token BEFORE creating user
        const activationToken = (0, user_controller_1.createActivationToken)({
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
            yield ejs_1.default.renderFile(path_1.default.join(__dirname, "../mails/activation-mail.ejs"), data);
            yield (0, sendEmail_1.default)({
                email,
                subject: "Activate your brand account",
                template: "activation-mail.ejs",
                data,
            });
            // Only create user and brand profile AFTER email is successfully sent
            const user = yield user_model_1.default.create({
                name,
                email,
                password,
                role: "brand",
                companyName,
                isVerified: false,
            });
            // create Brand profile
            yield brand_model_1.default.create({
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
        }
        catch (mailErr) {
            // If email fails, return error with details
            console.error("Email sending failed:", mailErr);
            return next(new ErrorHandler_1.default(`Registration failed: Unable to send verification email. Please check your email configuration. Error: ${mailErr.message}`, 500));
        }
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Brand registration failed: ${error.message}`, 500));
    }
}));
exports.logout = (0, catchAsyncError_1.CatchAsyncError)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // Mark user as offline
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id;
    if (userId) {
        const redis = require("../utils/redis").redis;
        yield redis.srem("users:online", String(userId));
        yield redis.srem("users:currently_playing", String(userId));
        yield redis.del(`user:${userId}:last_active`);
        yield redis.del(`user:${userId}:playing`);
    }
    res.cookie("access_token", "", { maxAge: 1 });
    res.cookie("refresh_token", "", { maxAge: 1 });
    res.status(200).json({ success: true });
}));
// Resend activation email (unified for both gamer and brand)
exports.resendActivation = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email } = req.body;
        if (!email) {
            return next(new ErrorHandler_1.default("Email is required", 400));
        }
        // Find user
        const user = yield user_model_1.default.findOne({ email });
        if (!user) {
            return next(new ErrorHandler_1.default("User not found", 404));
        }
        if (user.isVerified) {
            return next(new ErrorHandler_1.default("Account is already verified", 400));
        }
        // Create activation token based on role
        let activationToken;
        let displayName;
        if (user.role === "gamer") {
            activationToken = (0, user_controller_1.createActivationToken)({
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                password: user.password,
                role: "gamer",
            });
            displayName = user.firstName;
        }
        else if (user.role === "brand") {
            activationToken = (0, user_controller_1.createActivationToken)({
                name: user.name,
                email: user.email,
                password: user.password,
                companyName: user.companyName,
                role: "brand",
            });
            displayName = user.name;
        }
        else {
            return next(new ErrorHandler_1.default("Invalid account type", 400));
        }
        const activationCode = activationToken.activationCode;
        const data = { user: { name: displayName }, activationCode };
        // Send activation email
        yield (0, sendEmail_1.default)({
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
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to resend activation email: ${error.message}`, 500));
    }
}));
// Forgot password - send reset link to email
exports.forgotPassword = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { email } = req.body;
        if (!email) {
            return next(new ErrorHandler_1.default("Email is required", 400));
        }
        // Find user by email
        const user = yield user_model_1.default.findOne({ email });
        if (!user) {
            // Don't reveal if email exists or not for security
            return res.status(200).json({
                success: true,
                message: "If an account with that email exists, a password reset link has been sent.",
            });
        }
        // Check if user has a password (not just Google OAuth user)
        if (!user.password && user.googleId) {
            return next(new ErrorHandler_1.default("This account uses Google Sign-In. Please log in with Google instead.", 400));
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
            yield (0, sendEmail_1.default)({
                email: user.email,
                subject: "Reset Your Password - Tex Resolve",
                template: "reset-password.ejs",
                data,
            });
            res.status(200).json({
                success: true,
                message: "Password reset link sent to your email.",
            });
        }
        catch (mailErr) {
            console.error("Failed to send reset email:", mailErr);
            console.error("Error details:", {
                message: mailErr.message,
                response: ((_a = mailErr.response) === null || _a === void 0 ? void 0 : _a.body) || mailErr.response,
                code: mailErr.code,
            });
            return next(new ErrorHandler_1.default(`Failed to send password reset email: ${mailErr.message}`, 500));
        }
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Forgot password failed: ${error.message}`, 500));
    }
}));
// Reset password - verify token and set new password
exports.resetPassword = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { token, new_password } = req.body;
        if (!token || !new_password) {
            return next(new ErrorHandler_1.default("Missing required fields: token, new_password", 400));
        }
        // Validate password strength
        if (new_password.length < 6) {
            return next(new ErrorHandler_1.default("Password must be at least 6 characters long", 400));
        }
        // Verify reset token
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(token, process.env.ACTIVATION_SECRET);
        }
        catch (err) {
            if (err.name === "TokenExpiredError") {
                return next(new ErrorHandler_1.default("Reset link has expired. Please request a new one.", 400));
            }
            return next(new ErrorHandler_1.default("Invalid reset token", 400));
        }
        // Find user
        const user = yield user_model_1.default.findById(decoded.userId);
        if (!user) {
            return next(new ErrorHandler_1.default("User not found", 404));
        }
        // Update password
        user.password = new_password;
        yield user.save();
        res.status(200).json({
            success: true,
            message: "Password reset successful. You can now log in with your new password.",
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Reset password failed: ${error.message}`, 500));
    }
}));
