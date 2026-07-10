import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import { GameType } from "../models/gameSession.model";
import {
  startSession,
  startGameStage,
  completeGameStage,
  startVideoStage,
  completeVideoStage,
  submitQuizAttempt,
  completeSession,
  SessionError,
} from "../services/session/gameSession.service";

function handleSessionError(error: any, next: NextFunction) {
  if (error instanceof SessionError) {
    return next(new ErrorHandler(error.message, error.statusCode));
  }
  return next(new ErrorHandler(error.message || "Session operation failed", 500));
}

// POST /sessions/start  { campaignId }
export const postStartSession = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { campaignId } = req.body;
      if (!campaignId) {
        return next(new ErrorHandler("campaignId is required", 400));
      }
      const session = await startSession(userId, campaignId);
      res.status(201).json({ success: true, session });
    } catch (error: any) {
      handleSessionError(error, next);
    }
  }
);

// POST /sessions/:id/games/:gameType/start
export const postStartGameStage = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { id, gameType } = req.params;
      const session = await startGameStage(id, userId, gameType as GameType);
      res.status(200).json({ success: true, session });
    } catch (error: any) {
      handleSessionError(error, next);
    }
  }
);

// POST /sessions/:id/games/:gameType/complete  { movesTaken?, timeTakenMs? }
export const postCompleteGameStage = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { id, gameType } = req.params;
      const { movesTaken, timeTakenMs } = req.body;
      const session = await completeGameStage(
        id,
        userId,
        gameType as GameType,
        movesTaken !== undefined ? Number(movesTaken) : undefined,
        timeTakenMs !== undefined ? Number(timeTakenMs) : undefined
      );
      res.status(200).json({ success: true, session });
    } catch (error: any) {
      handleSessionError(error, next);
    }
  }
);

// POST /sessions/:id/video/start
export const postStartVideoStage = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { id } = req.params;
      const session = await startVideoStage(id, userId);
      res.status(200).json({ success: true, session });
    } catch (error: any) {
      handleSessionError(error, next);
    }
  }
);

// POST /sessions/:id/video/complete
export const postCompleteVideoStage = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { id } = req.params;
      const session = await completeVideoStage(id, userId);
      res.status(200).json({ success: true, session });
    } catch (error: any) {
      handleSessionError(error, next);
    }
  }
);

// POST /sessions/:id/quiz/attempt  { answers: number[] }
export const postQuizAttempt = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { id } = req.params;
      const { answers } = req.body;
      if (!Array.isArray(answers)) {
        return next(new ErrorHandler("answers must be an array", 400));
      }
      const { session, score, allCorrect } = await submitQuizAttempt(
        id,
        userId,
        answers
      );
      res.status(200).json({
        success: true,
        score,
        allCorrect,
        attemptsSoFar: session.quiz.attempts.length,
        firstAttemptScore: session.quiz.firstAttempt?.score,
      });
    } catch (error: any) {
      handleSessionError(error, next);
    }
  }
);

// POST /sessions/:id/complete
export const postCompleteSession = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { id } = req.params;
      const result = await completeSession(id, userId);
      res.status(200).json({
        success: true,
        isFirstCompletion: result.isFirstCompletion,
        pointsAwarded: result.pointsAwarded,
        totalCompletionTimeMs: result.totalCompletionTimeMs,
        voided: result.voided,
        flagged: result.flagged,
      });
    } catch (error: any) {
      handleSessionError(error, next);
    }
  }
);
