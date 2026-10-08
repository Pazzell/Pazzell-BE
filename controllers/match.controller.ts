import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import MatchLevelConfigModel from "../models/matchLevelConfig.model";
import { assertObjectId } from "../utils/validators";
import { getArtifact, listArtifacts } from "../services/match/artifacts";
import { renderArtifactSvg } from "../services/match/artifactSvg";
import { ensureLevelsStored, validateLevelInput } from "../services/match/levels";
import {
  finishAttempt,
  getAttempt,
  getCurrentQuestion,
  getProgressSummary,
  listLevels,
  startAttempt,
  submitAnswer,
} from "../services/match/match.service";

// GET /match/artifacts?svg=1 — public registry of every base artifact
export const getArtifacts = CatchAsyncError(async (req: Request, res: Response) => {
  const withSvg = req.query.svg === "1" || req.query.svg === "true";
  const artifacts = listArtifacts().map((artifact) =>
    withSvg ? { ...artifact, svg: renderArtifactSvg(artifact) } : artifact
  );
  res.set("Cache-Control", "public, max-age=3600");
  res.status(200).json({ success: true, count: artifacts.length, artifacts });
});

// GET /match/artifacts/svg?id=shape:triangle:red@r90 — one artifact (variants included) as SVG
export const getArtifactSvg = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const artifact = getArtifact(String(req.query.id || ""));
    if (!artifact) return next(new ErrorHandler("Artifact not found", 404, "ARTIFACT_NOT_FOUND"));
    res.set("Cache-Control", "public, max-age=86400");
    res.set("X-Content-Type-Options", "nosniff");
    res.type("image/svg+xml").send(renderArtifactSvg(artifact));
  }
);

// GET /match/levels
export const getLevels = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, ...(await listLevels(String(req.user!._id))) });
});

// GET /match/progress
export const getProgress = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, progress: await getProgressSummary(String(req.user!._id)) });
});

// POST /match/levels/:level/attempts  { timerSeconds, restart? }
export const postStartAttempt = CatchAsyncError(async (req: Request, res: Response) => {
  const level = Number(req.params.level);
  if (!Number.isInteger(level)) throw new ErrorHandler("Level not found", 404, "LEVEL_NOT_FOUND");
  const result = await startAttempt(
    String(req.user!._id),
    level,
    req.body?.timerSeconds,
    req.body?.restart === true
  );
  res.status(result.resumed ? 200 : 201).json({ success: true, ...result });
});

// GET /match/attempts/:id
export const getAttemptState = CatchAsyncError(async (req: Request, res: Response) => {
  const id = assertObjectId(req.params.id, "attempt id");
  res.status(200).json({ success: true, ...(await getAttempt(String(req.user!._id), id)) });
});

// GET /match/attempts/:id/question
export const getQuestion = CatchAsyncError(async (req: Request, res: Response) => {
  const id = assertObjectId(req.params.id, "attempt id");
  res.set("Cache-Control", "no-store");
  res.status(200).json({ success: true, ...(await getCurrentQuestion(String(req.user!._id), id)) });
});

// POST /match/attempts/:id/answer  { questionIndex, optionId }
export const postAnswer = CatchAsyncError(async (req: Request, res: Response) => {
  const id = assertObjectId(req.params.id, "attempt id");
  const result = await submitAnswer(
    String(req.user!._id),
    id,
    req.body?.questionIndex,
    req.body?.optionId
  );
  res.status(200).json({ success: true, ...result });
});

// POST /match/attempts/:id/finish
export const postFinish = CatchAsyncError(async (req: Request, res: Response) => {
  const id = assertObjectId(req.params.id, "attempt id");
  res.status(200).json({ success: true, result: await finishAttempt(String(req.user!._id), id) });
});

// --- Admin: level configs -----------------------------------------------------

const adminLevel = (level: any) => ({
  level: level.level,
  order: level.order,
  name: level.name || null,
  questionCount: level.questionCount,
  optionCount: level.optionCount,
  categories: level.categories,
  similarity: level.similarity,
  variants: level.variants,
  dotCountTargets: level.dotCountTargets,
  isActive: level.isActive,
  updatedAt: level.updatedAt,
});

// GET /admin/match/levels
export const adminListLevels = CatchAsyncError(async (req: Request, res: Response) => {
  await ensureLevelsStored();
  const levels = await MatchLevelConfigModel.find({}).sort({ order: 1, level: 1 }).lean();
  res.status(200).json({ success: true, levels: levels.map(adminLevel) });
});

// PUT /admin/match/levels/:level — create or replace one level's config
export const adminUpsertLevel = CatchAsyncError(async (req: Request, res: Response) => {
  const definition = validateLevelInput(req.body, Number(req.params.level));
  await ensureLevelsStored();
  const level = await MatchLevelConfigModel.findOneAndUpdate(
    { level: definition.level },
    { $set: definition },
    { new: true, upsert: true, runValidators: true }
  ).lean();
  res.status(200).json({ success: true, level: adminLevel(level) });
});

// DELETE /admin/match/levels/:level
export const adminDeleteLevel = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    await ensureLevelsStored();
    const total = await MatchLevelConfigModel.countDocuments({});
    if (total <= 1) return next(new ErrorHandler("At least one level must remain", 400));
    const result = await MatchLevelConfigModel.deleteOne({ level: Number(req.params.level) });
    if (result.deletedCount === 0) {
      return next(new ErrorHandler("Level not found", 404, "LEVEL_NOT_FOUND"));
    }
    res.status(200).json({ success: true });
  }
);
