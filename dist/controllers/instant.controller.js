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
exports.submitInstantResult = exports.joinInstantEvent = exports.createInstantEvent = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const instantEvent_model_1 = __importDefault(require("../models/instantEvent.model"));
// create instant event (1-hour duration, free to join)
exports.createInstantEvent = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { title, campaignId, startAt } = req.body;
        if (!title || !campaignId || !startAt) {
            return next(new ErrorHandler_1.default("title, campaignId, and startAt are required fields", 400));
        }
        const startDate = new Date(startAt);
        // Automatically set event duration to 1 hour
        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
        const event = yield instantEvent_model_1.default.create({
            title,
            campaignId,
            startAt: startDate,
            endAt: endDate,
            participants: [],
            status: "pending",
        });
        res.status(201).json({ success: true, event });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// join event (free, no payment required)
exports.joinInstantEvent = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { eventId } = req.params;
        const user = req.user;
        const userId = user && user._id ? String(user._id) : undefined;
        if (!userId)
            return next(new ErrorHandler_1.default("Invalid user session", 401));
        const event = yield instantEvent_model_1.default.findById(eventId);
        if (!event)
            return next(new ErrorHandler_1.default("Event not found", 404));
        // Check if event is still open (pending or running status)
        if (event.status === "finished") {
            return next(new ErrorHandler_1.default("Event has ended", 400));
        }
        // Check if user already joined
        const alreadyJoined = event.participants.some((p) => String(p.userId) === userId);
        if (alreadyJoined) {
            return next(new ErrorHandler_1.default("Already joined this event", 400));
        }
        // Add participant (free to join)
        event.participants.push({
            userId: userId,
            joinedAt: new Date(),
            submitted: false,
        });
        yield event.save();
        res.status(200).json({
            success: true,
            message: "Successfully joined the event",
            event,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// submit instant result (user submits time & moves)
exports.submitInstantResult = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { eventId } = req.params;
        const { timeTaken, movesTaken } = req.body;
        const user = req.user;
        const userId = user && user._id ? String(user._id) : undefined;
        if (!userId)
            return next(new ErrorHandler_1.default("Invalid user session", 401));
        if (typeof timeTaken !== "number" ||
            typeof movesTaken !== "number" ||
            timeTaken <= 0 ||
            movesTaken <= 0) {
            return next(new ErrorHandler_1.default("timeTaken and movesTaken must be positive numbers", 400));
        }
        const event = yield instantEvent_model_1.default.findById(eventId);
        if (!event)
            return next(new ErrorHandler_1.default("Event not found", 404));
        if (event.status === "finished") {
            return next(new ErrorHandler_1.default("Event has ended", 400));
        }
        // Find participant
        const p = event.participants.find((pp) => String(pp.userId) === userId);
        if (!p) {
            return next(new ErrorHandler_1.default("You must join the event before submitting", 400));
        }
        if (p.submitted) {
            return next(new ErrorHandler_1.default("You have already submitted your result", 400));
        }
        // Save participant's result
        p.timeTaken = timeTaken;
        p.movesTaken = movesTaken;
        p.submitted = true;
        yield event.save();
        // Format time for display (e.g., "2min:50sec")
        const minutes = Math.floor(timeTaken / 60);
        const seconds = timeTaken % 60;
        const timeFormatted = `${minutes}min:${seconds}sec`;
        res.status(200).json({
            success: true,
            message: `You completed this campaign in ${timeFormatted} with ${movesTaken} moves`,
            result: {
                timeTaken,
                movesTaken,
                timeFormatted,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
