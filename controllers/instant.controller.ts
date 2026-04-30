import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import InstantEventModel from "../models/instantEvent.model";
import LeaderboardModel from "../models/leaderboard.model";

// create instant event (1-hour duration, free to join)
export const createInstantEvent = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { title, campaignId, startAt } = req.body;

      if (!title || !campaignId || !startAt) {
        return next(
          new ErrorHandler(
            "title, campaignId, and startAt are required fields",
            400
          )
        );
      }

      const startDate = new Date(startAt);
      // Automatically set event duration to 1 hour
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

      const event = await InstantEventModel.create({
        title,
        campaignId,
        startAt: startDate,
        endAt: endDate,
        participants: [],
        status: "pending",
      });

      res.status(201).json({ success: true, event });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// join event (free, no payment required)
export const joinInstantEvent = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { eventId } = req.params;
      const user = req.user as any;
      const userId = user && user._id ? String(user._id) : undefined;

      if (!userId) return next(new ErrorHandler("Invalid user session", 401));

      const event = await InstantEventModel.findById(eventId);
      if (!event) return next(new ErrorHandler("Event not found", 404));

      // Check if event is still open (pending or running status)
      if (event.status === "finished") {
        return next(new ErrorHandler("Event has ended", 400));
      }

      // Check if user already joined
      const alreadyJoined = event.participants.some(
        (p) => String(p.userId) === userId
      );
      if (alreadyJoined) {
        return next(new ErrorHandler("Already joined this event", 400));
      }

      // Add participant (free to join)
      event.participants.push({
        userId: userId,
        joinedAt: new Date(),
        submitted: false,
      });
      await event.save();

      res.status(200).json({
        success: true,
        message: "Successfully joined the event",
        event,
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// submit instant result (user submits time & moves)
export const submitInstantResult = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { eventId } = req.params;
      const { timeTaken, movesTaken } = req.body;
      const user = req.user as any;
      const userId = user && user._id ? String(user._id) : undefined;

      if (!userId) return next(new ErrorHandler("Invalid user session", 401));

      if (
        typeof timeTaken !== "number" ||
        typeof movesTaken !== "number" ||
        timeTaken <= 0 ||
        movesTaken <= 0
      ) {
        return next(
          new ErrorHandler(
            "timeTaken and movesTaken must be positive numbers",
            400
          )
        );
      }

      const event = await InstantEventModel.findById(eventId);
      if (!event) return next(new ErrorHandler("Event not found", 404));

      if (event.status === "finished") {
        return next(new ErrorHandler("Event has ended", 400));
      }

      // Find participant
      const p = event.participants.find((pp) => String(pp.userId) === userId);
      if (!p) {
        return next(
          new ErrorHandler("You must join the event before submitting", 400)
        );
      }

      if (p.submitted) {
        return next(
          new ErrorHandler("You have already submitted your result", 400)
        );
      }

      // Save participant's result
      p.timeTaken = timeTaken;
      p.movesTaken = movesTaken;
      p.submitted = true;
      await event.save();

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
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);
