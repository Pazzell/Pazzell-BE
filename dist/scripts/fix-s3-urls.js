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
require("dotenv/config");
const mongoose_1 = __importDefault(require("mongoose"));
const OLD = "pazzell-backend-storage-644724502006-eu-north-1-an.amazonaws.com";
const NEW = "pazzell-backend-storage-644724502006-eu-north-1-an.s3.eu-north-1.amazonaws.com";
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        const uri = process.env.DB_URI;
        if (!uri)
            throw new Error("DB_URI is not set in .env");
        console.log("Connecting to MongoDB...");
        yield mongoose_1.default.connect(uri);
        console.log("Connected.\n");
        const db = mongoose_1.default.connection.db;
        // --- puzzlecampaigns ---
        const campResult = yield db.collection("puzzlecampaigns").updateMany({
            $or: [
                { puzzleImageUrl: { $regex: OLD } },
                { originalImageUrl: { $regex: OLD } },
            ],
        }, [
            {
                $set: {
                    puzzleImageUrl: {
                        $replaceOne: { input: "$puzzleImageUrl", find: OLD, replacement: NEW },
                    },
                    originalImageUrl: {
                        $replaceOne: { input: "$originalImageUrl", find: OLD, replacement: NEW },
                    },
                },
            },
        ]);
        console.log(`puzzlecampaigns — matched: ${campResult.matchedCount}, updated: ${campResult.modifiedCount}`);
        // --- users (avatars) ---
        const userResult = yield db.collection("users").updateMany({ avatar: { $regex: OLD } }, [
            {
                $set: {
                    avatar: {
                        $replaceOne: { input: "$avatar", find: OLD, replacement: NEW },
                    },
                },
            },
        ]);
        console.log(`users          — matched: ${userResult.matchedCount}, updated: ${userResult.modifiedCount}`);
        yield mongoose_1.default.disconnect();
        console.log("\nDone. Connection closed.");
    });
}
run().catch((err) => {
    console.error("Migration failed:", err.message);
    process.exit(1);
});
