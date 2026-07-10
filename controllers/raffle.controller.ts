import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import RaffleTicketModel from "../models/raffleTicket.model";
import RaffleDrawModel from "../models/raffleDraw.model";
import { getWeekBounds } from "../utils/weekBoundary";
import {
  runDraw,
  verifyDraw,
  isEligibleThisWeek,
  getEligibilityFloor,
} from "../services/raffle.service";

// GET /raffles/campaign/:campaignId/current — this week's ticket/draw status for a campaign
export const getCurrentCampaignRaffle = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { campaignId } = req.params;
      const { weekKey } = getWeekBounds();

      const ticketCount = await RaffleTicketModel.countDocuments({ campaignId, weekKey });
      const draw = await RaffleDrawModel.findOne({ campaignId, weekKey }).lean();
      const eligibilityFloor = await getEligibilityFloor();

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
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// GET /raffles/my-tickets
export const getMyTickets = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const tickets = await RaffleTicketModel.find({ userId }).sort({ createdAt: -1 }).lean();

      const { weekKey } = getWeekBounds();
      const eligibleThisWeek = await isEligibleThisWeek(userId, weekKey);

      res.status(200).json({ success: true, tickets, eligibleThisWeek, weekKey });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// POST /raffles/:campaignId/draw  { weekKey? } (admin — also called by the Monday scheduler job)
export const triggerDraw = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { campaignId } = req.params;
      const weekKey = req.body?.weekKey || getWeekBounds().weekKey;

      const draw = await runDraw(campaignId, weekKey);
      if (!draw) {
        return res.status(200).json({
          success: true,
          message: "No tickets were sold for this campaign this week — nothing to draw",
        });
      }

      res.status(200).json({ success: true, draw });
    } catch (error: any) {
      return next(new ErrorHandler(`Failed to run draw: ${error.message}`, 500));
    }
  }
);

// PATCH /raffles/:drawId/fulfillment  { fulfillmentStatus, fulfillmentNotes? } (brand/admin)
export const updateFulfillment = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { drawId } = req.params;
      const { fulfillmentStatus, fulfillmentNotes } = req.body;

      if (!fulfillmentStatus) {
        return next(new ErrorHandler("fulfillmentStatus is required", 400));
      }

      const draw = await RaffleDrawModel.findById(drawId);
      if (!draw) return next(new ErrorHandler("Draw not found", 404));
      if (draw.status !== "drawn" && draw.status !== "fulfilled") {
        return next(new ErrorHandler("This draw has no winner to fulfill yet", 400));
      }

      draw.fulfillmentStatus = fulfillmentStatus;
      if (fulfillmentNotes !== undefined) draw.fulfillmentNotes = fulfillmentNotes;
      draw.status = "fulfilled";
      await draw.save();

      res.status(200).json({ success: true, draw });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// GET /raffles/:drawId/verify — public, provable-randomness audit
export const getDrawVerification = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { drawId } = req.params;
      const draw = await RaffleDrawModel.findById(drawId).lean();
      if (!draw) return next(new ErrorHandler("Draw not found", 404));

      const verification = await verifyDraw(drawId);

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
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);
