"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const raffleTicketSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, index: true },
    campaignId: { type: String, required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    sourceSessionId: { type: String, required: true },
}, { timestamps: true });
// One ticket ever per player per campaign — minted only on first completion,
// never on replays.
raffleTicketSchema.index({ userId: 1, campaignId: 1 }, { unique: true });
raffleTicketSchema.index({ campaignId: 1, weekKey: 1 });
const RaffleTicketModel = mongoose_1.default.model("RaffleTicket", raffleTicketSchema);
exports.default = RaffleTicketModel;
