import { Request, Response } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import {
  deleteAiTrivia,
  generateAiTrivia,
  getAiTrivia,
  getAiTriviaOptions,
  listAiTrivias,
} from "../services/aiTrivia/aiTrivia.service";

// AI generated trivia for players. Playing one goes through POST /trivia/sessions with
// { sourceType: "custom", sourceId: <trivia id> }, like any other trivia.

// GET /ai-trivia/options — topics, limits and today's allowance
export const getOptions = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, options: await getAiTriviaOptions(req.user!) });
});

// POST /ai-trivia  { topicId | topicName, prompt, count? } — Pro only
export const createAiTrivia = CatchAsyncError(async (req: Request, res: Response) => {
  const body = req.body || {};
  const result = await generateAiTrivia(req.user!, {
    topicId: body.topicId,
    topicName: body.topicName,
    prompt: body.prompt,
    count: body.count,
  });
  res.status(201).json({ success: true, ...result });
});

// GET /ai-trivia — the caller's AI generated trivias
export const listMine = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, trivias: await listAiTrivias(String(req.user!._id)) });
});

// GET /ai-trivia/:id
export const getMine = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    trivia: await getAiTrivia(String(req.user!._id), req.params.id),
  });
});

// DELETE /ai-trivia/:id
export const deleteMine = CatchAsyncError(async (req: Request, res: Response) => {
  await deleteAiTrivia(String(req.user!._id), req.params.id);
  res.status(200).json({ success: true });
});
