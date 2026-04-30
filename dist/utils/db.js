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
require("dotenv/config");
const dbUrl = process.env.DB_URI || "";
// Add connection event listeners
mongoose_1.default.connection.on("connected", () => {
    console.log("MongoDB connection established");
});
mongoose_1.default.connection.on("error", (err) => {
    console.error("MongoDB connection error:", err);
});
mongoose_1.default.connection.on("disconnected", () => {
    console.log("MongoDB disconnected");
});
//connect database
const connectDB = () => __awaiter(void 0, void 0, void 0, function* () {
    if (!dbUrl) {
        // in test mode we skip connecting; otherwise warn and skip
        if (process.env.NODE_ENV === "test")
            return;
        console.warn("DB_URI not set, skipping database connection");
        return;
    }
    try {
        const data = yield mongoose_1.default.connect(dbUrl, {
            serverSelectionTimeoutMS: 30000, // 30 seconds timeout for initial connection
            socketTimeoutMS: 45000, // 45 seconds for socket operations
        });
        console.log(`Database connected with ${data.connection.host}`);
    }
    catch (error) {
        console.error("Database connection error:", error.message);
        // retry after 5s
        setTimeout(connectDB, 5000).unref();
    }
});
exports.default = connectDB;
