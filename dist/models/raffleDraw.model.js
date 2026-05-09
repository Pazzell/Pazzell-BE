"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const raffleDrawSchema = new mongoose_1.default.Schema({
    monthKey: { type: String, required: true, index: true },
    candidates: { type: [String], default: [] },
    winner: { type: String },
    amount: { type: Number, required: true },
    drawnAt: { type: Date },
}, { timestamps: true });
raffleDrawSchema.index({ monthKey: 1 });
const RaffleDrawModel = mongoose_1.default.model("RaffleDraw", raffleDrawSchema);
exports.default = RaffleDrawModel;
