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
const user_model_1 = __importDefault(require("../models/user.model"));
const userHelpers_1 = require("../utils/userHelpers");
require("dotenv/config");
/**
 * This script finds all users with base64-encoded avatars
 * and replaces them with generated UI Avatars URLs
 */
const cleanupBase64Avatars = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        // Connect to MongoDB
        const DB_URI = process.env.DB_URI;
        if (!DB_URI) {
            console.error("❌ DB_URI not found in environment variables");
            process.exit(1);
        }
        console.log("🔌 Connecting to MongoDB...");
        yield mongoose_1.default.connect(DB_URI);
        console.log("✅ Connected to MongoDB");
        // Find all users with base64 avatars
        const usersWithBase64 = yield user_model_1.default.find({
            avatar: { $regex: /^data:image\// }
        });
        console.log(`\n📊 Found ${usersWithBase64.length} users with base64 avatars`);
        if (usersWithBase64.length === 0) {
            console.log("✨ No cleanup needed!");
            yield mongoose_1.default.disconnect();
            process.exit(0);
        }
        let updatedCount = 0;
        // Update each user
        for (const user of usersWithBase64) {
            // Generate a new avatar URL based on user's name
            const displayName = user.firstName
                ? `${user.firstName} ${user.lastName || ''}`.trim()
                : user.name || user.email;
            const newAvatar = (0, userHelpers_1.generateAvatar)(displayName);
            // Update the user
            yield user_model_1.default.findByIdAndUpdate(user._id, {
                avatar: newAvatar
            });
            updatedCount++;
            console.log(`✅ Updated ${displayName} (${user.email})`);
            console.log(`   Old: data:image/... (${((_a = user.avatar) === null || _a === void 0 ? void 0 : _a.length) || 0} characters)`);
            console.log(`   New: ${newAvatar}\n`);
        }
        console.log(`\n🎉 Successfully updated ${updatedCount} users!`);
        console.log(`💾 Database space saved: ~${Math.round(usersWithBase64.reduce((acc, u) => { var _a; return acc + (((_a = u.avatar) === null || _a === void 0 ? void 0 : _a.length) || 0); }, 0) / 1024)}KB`);
        yield mongoose_1.default.disconnect();
        console.log("\n👋 Disconnected from MongoDB");
        process.exit(0);
    }
    catch (error) {
        console.error("❌ Error during cleanup:", error);
        yield mongoose_1.default.disconnect();
        process.exit(1);
    }
});
cleanupBase64Avatars();
