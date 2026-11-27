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
exports.getDrawVerification = exports.updateFulfillment = exports.triggerDraw = exports.getMyTickets = exports.getCurrentCampaignRaffle = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const raffleTicket_model_1 = __importDefault(require("../models/raffleTicket.model"));
const raffleDraw_model_1 = __importDefault(require("../models/raffleDraw.model"));
const weekBoundary_1 = require("../utils/weekBoundary");
const raffle_service_1 = require("../services/raffle.service");
// GET /raffles/campaign/:campaignId/current — this week's ticket/draw status for a campaign
exports.getCurrentCampaignRaffle = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { campaignId } = req.params;
        const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
        const ticketCount = yield raffleTicket_model_1.default.countDocuments({ campaignId, weekKey });
        const draw = yield raffleDraw_model_1.default.findOne({ campaignId, weekKey }).lean();
        const eligibilityFloor = yield (0, raffle_service_1.getEligibilityFloor)();
        res.status(200).json({
            success: true,
            raffle: {
                campaignId,
                weekKey,
                ticketCount,
                eligibilityFloor,
                draw: draw
                    ? {
                        status: draw.status,
                        winnerUserId: draw.winnerUserId,
                        eligibleTicketCount: draw.eligibleTicketUserIds.length,
                        drawnAt: draw.drawnAt,
                        fulfillmentStatus: draw.fulfillmentStatus,
                    }
                    : null,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// GET /raffles/my-tickets
exports.getMyTickets = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const tickets = yield raffleTicket_model_1.default.find({ userId }).sort({ createdAt: -1 }).lean();
        const { weekKey } = (0, weekBoundary_1.getWeekBounds)();
        const eligibleThisWeek = yield (0, raffle_service_1.isEligibleThisWeek)(userId, weekKey);
        res.status(200).json({ success: true, tickets, eligibleThisWeek, weekKey });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// POST /raffles/:campaignId/draw  { weekKey? } (admin — also called by the Monday scheduler job)
exports.triggerDraw = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { campaignId } = req.params;
        const weekKey = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.weekKey) || (0, weekBoundary_1.getWeekBounds)().weekKey;
        const draw = yield (0, raffle_service_1.runDraw)(campaignId, weekKey);
        if (!draw) {
            return res.status(200).json({
                success: true,
                message: "No tickets were sold for this campaign this week — nothing to draw",
            });
        }
        res.status(200).json({ success: true, draw });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to run draw: ${error.message}`, 500));
    }
}));
// PATCH /raffles/:drawId/fulfillment  { fulfillmentStatus, fulfillmentNotes? } (brand/admin)
exports.updateFulfillment = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { drawId } = req.params;
        const { fulfillmentStatus, fulfillmentNotes } = req.body;
        if (!fulfillmentStatus) {
            return next(new ErrorHandler_1.default("fulfillmentStatus is required", 400));
        }
        const draw = yield raffleDraw_model_1.default.findById(drawId);
        if (!draw)
            return next(new ErrorHandler_1.default("Draw not found", 404));
        if (draw.status !== "drawn" && draw.status !== "fulfilled") {
            return next(new ErrorHandler_1.default("This draw has no winner to fulfill yet", 400));
        }
        draw.fulfillmentStatus = fulfillmentStatus;
        if (fulfillmentNotes !== undefined)
            draw.fulfillmentNotes = fulfillmentNotes;
        draw.status = "fulfilled";
        yield draw.save();
        res.status(200).json({ success: true, draw });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// GET /raffles/:drawId/verify — public, provable-randomness audit
exports.getDrawVerification = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { drawId } = req.params;
        const draw = yield raffleDraw_model_1.default.findById(drawId).lean();
        if (!draw)
            return next(new ErrorHandler_1.default("Draw not found", 404));
        const verification = yield (0, raffle_service_1.verifyDraw)(drawId);
        res.status(200).json({
            success: true,
            draw: {
                campaignId: draw.campaignId,
                weekKey: draw.weekKey,
                seed: draw.seed,
                eligibleTicketUserIds: draw.eligibleTicketUserIds,
                winnerUserId: draw.winnerUserId,
                winnerIndex: draw.winnerIndex,
            },
            verification,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
