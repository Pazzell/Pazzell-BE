import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";
import PuzzleAttemptModel from "../models/puzzleAttempt.model";
import UserModel from "../models/user.model";

// List available puzzles (can filter by gameType)
export const listPuzzles = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { gameType } = req.query;

      // Build filter
      const filter: any = {};
      if (gameType === "puzzle" || gameType === "wordHunt") {
        filter.gameType = gameType;
      }

      const campaigns = await PuzzleCampaignModel.find(filter).select(
        "_id brandId gameType title description puzzleImageUrl timeLimit questions words createdAt"
      );

      res.status(200).json({ success: true, campaigns });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Get puzzle by id (return images, questions, id, timeLimit)
export const getPuzzle = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const campaign = await PuzzleCampaignModel.findById(id).lean();
      if (!campaign) return next(new ErrorHandler("Puzzle not found", 404));

      res.status(200).json({
        success: true,
        puzzle: {
          puzzleId: campaign._id,
          puzzleImageUrl: campaign.puzzleImageUrl,
          originalImageUrl: campaign.originalImageUrl,
          questions: campaign.questions.map((q: any) => ({
            question: q.question,
            choices: q.choices,
          })),
        },
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);

// Submit puzzle result along with quiz answers
interface ISubmitBody {
  timeTaken: number; // ms
  movesTaken: number;
  solved: boolean;
  answers: number[]; // indexes selected for 3 questions
}

export const submitPuzzle = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params; // campaign id
      const user = req.user as any;
      const userId = user && user._id ? String(user._id) : undefined;
      const body = req.body as ISubmitBody;

      const campaign = await PuzzleCampaignModel.findById(id);
      if (!campaign)
        return next(new ErrorHandler("Puzzle campaign not found", 404));

      // compute quiz score
      let quizScore = 0;
      if (Array.isArray(body.answers)) {
        for (
          let i = 0;
          i < Math.min(body.answers.length, campaign.questions.length);
          i++
        ) {
          if (body.answers[i] === campaign.questions[i].correctIndex)
            quizScore++;
        }
      }

      // determine if first-time solved
      let firstTime = false;
      if (body.solved) {
        const prev = await PuzzleAttemptModel.findOne({
          userId: userId,
          puzzleId: id,
          solved: true,
        });
        if (!prev) firstTime = true;
      }

      const pointsEarned = firstTime ? 1 : 0;

      const attempt = await PuzzleAttemptModel.create({
        userId: userId,
        puzzleId: id,
        campaignId: id,
        timeTaken: body.timeTaken,
        movesTaken: body.movesTaken,
        solved: body.solved,
        firstTimeSolved: firstTime,
        quizScore,
        answers: Array.isArray(body.answers) ? body.answers : [],
        pointsEarned,
      });

      // update user analytics
      const userDoc = userId ? await UserModel.findById(userId) : null;
      if (userDoc) {
        userDoc.analytics.lifetime.attempts =
          (userDoc.analytics.lifetime.attempts || 0) + 1;
        userDoc.analytics.lifetime.totalMoves =
          (userDoc.analytics.lifetime.totalMoves || 0) + body.movesTaken;
        userDoc.analytics.lifetime.totalTime =
          (userDoc.analytics.lifetime.totalTime || 0) + body.timeTaken;
        if (body.solved) {
          userDoc.analytics.lifetime.puzzlesSolved =
            (userDoc.analytics.lifetime.puzzlesSolved || 0) +
            (firstTime ? 1 : 0);
          userDoc.analytics.lifetime.totalPoints =
            (userDoc.analytics.lifetime.totalPoints || 0) + pointsEarned;
        }
        // successRate = puzzlesSolved / attempts
        if (userDoc.analytics.lifetime.attempts > 0) {
          userDoc.analytics.lifetime.successRate =
            (userDoc.analytics.lifetime.puzzlesSolved || 0) /
            userDoc.analytics.lifetime.attempts;
        }
        if (firstTime) {
          userDoc.puzzlesSolved = userDoc.puzzlesSolved || [];
          userDoc.puzzlesSolved.push(id);
        }
        await userDoc.save();
      }

      res.status(201).json({
        success: true,
        attempt,
        gameType: campaign.gameType,
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 400));
    }
  }
);
