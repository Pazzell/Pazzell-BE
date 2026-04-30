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
exports.generateAvatar = exports.generateUsername = void 0;
const user_model_1 = __importDefault(require("../models/user.model"));
const generateUsername = (email) => __awaiter(void 0, void 0, void 0, function* () {
    const baseUsername = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    let username = baseUsername;
    let counter = 1;
    while (yield user_model_1.default.findOne({ username })) {
        username = `${baseUsername}${counter}`;
        counter++;
    }
    return username;
});
exports.generateUsername = generateUsername;
const generateAvatar = (nameOrEmail) => {
    // Generate unique avatar using UI Avatars with user's name/email
    const colors = ["FF6B6B", "4ECDC4", "45B7D1", "FFA07A", "98D8C8", "F7DC6F", "BB8FCE", "85C1E2"];
    // Use a simple hash to consistently pick a color based on the input
    let hash = 0;
    for (let i = 0; i < nameOrEmail.length; i++) {
        hash = nameOrEmail.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorIndex = Math.abs(hash) % colors.length;
    const backgroundColor = colors[colorIndex];
    // Extract name for initials - if it's an email, use the part before @
    const displayName = nameOrEmail.includes('@')
        ? nameOrEmail.split('@')[0]
        : nameOrEmail;
    // Encode the name for URL safety
    const encodedName = encodeURIComponent(displayName);
    return `https://ui-avatars.com/api/?background=${backgroundColor}&color=fff&bold=true&size=200&name=${encodedName}`;
};
exports.generateAvatar = generateAvatar;
