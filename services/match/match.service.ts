import ErrorHandler from "../../utils/ErrorHandler";
import MatchAttemptModel, { IMatchAttempt } from "../../models/matchAttempt.model";
import MatchQuestionModel, { QuestionOutcome } from "../../models/matchQuestion.model";
import MatchProgressModel, { IMatchProgress } from "../../models/matchProgress.model";
import {
  getMatchDefaultTimerSeconds,
  getSubmitGraceMs,
  getTimerRange,
  isValidTimerSeconds,
} from "../config/config.service";
import { deadlineFrom, isPastDeadline, remainingMs, STALE_ATTEMPT_MS } from "../game/timing";
import { getArtifact } from "./artifacts";
import { renderArtifactSvg } from "./artifactSvg";
import { getActiveLevels, LevelDefinition } from "./levels";
import { generateQuestions } from "./questionGenerator";

// --- Progress and unlocking ---------------------------------------------------

async function getProgress(userId: string): Promise<IMatchProgress> {
  const existing = await MatchProgressModel.findOne({ userId });
  if (existing) return existing;
  try {
    return await MatchProgressModel.create({ userId });
  } catch (e: any) {
    if (e.code === 11000) return (await MatchProgressModel.findOne({ userId }))!;
    throw e;
  }
}

const passedLevels = (progress: IMatchProgress): Set<number> =>
  new Set(progress.levels.filter((l) => l.passed).map((l) => l.level));

/**
 * Levels are sequential: the first is always open, and a level opens only when the
 * one before it has been passed (every question answered correctly).
 */
function isUnlocked(levels: LevelDefinition[], index: number, passed: Set<number>): boolean {
  if (index === 0) return true;
  return passed.has(levels[index - 1].level) || passed.has(levels[index].level);
}

export async function listLevels(userId: string) {
  const [levels, progress, timer] = await Promise.all([
    getActiveLevels(),
    getProgress(userId),
    getMatchDefaultTimerSeconds(),
  ]);
  const passed = passedLevels(progress);
  const active = await MatchAttemptModel.find({ userId, active: true }).select("level").lean();
  const activeByLevel = new Map(active.map((a) => [a.level, String(a._id)]));

  return {
    timer: { ...getTimerRange(), defaultSeconds: timer },
    highestUnlockedLevel: progress.highestUnlockedLevel,
    levels: levels.map((level, index) => {
      const stats = progress.levels.find((l) => l.level === level.level);
      return {
        level: level.level,
        name: level.name,
        questionCount: level.questionCount,
        optionCount: level.optionCount,
        categories: level.categories,
        similarity: level.similarity,
        variants: level.variants,
        dotCountTargets: level.dotCountTargets,
        unlocked: isUnlocked(levels, index, passed),
        passed: passed.has(level.level),
        attempts: stats?.attempts || 0,
        best: stats ? { correct: stats.bestCorrect, total: stats.bestTotal } : null,
        activeAttemptId: activeByLevel.get(level.level) || null,
      };
    }),
  };
}

// --- Attempts -------------------------------------------------------------------

const publicAttempt = (attempt: IMatchAttempt) => ({
  id: String(attempt._id),
  level: attempt.level,
  timerSeconds: attempt.timerSeconds,
  status: attempt.status,
  questionCount: attempt.questionCount,
  currentIndex: Math.min(attempt.currentIndex, attempt.questionCount),
  startedAt: attempt.startedAt,
  completedAt: attempt.completedAt || null,
});

async function closeAsAbandoned(attemptId: any): Promise<void> {
  await MatchAttemptModel.updateOne(
    { _id: attemptId, active: true },
    { $set: { status: "abandoned", active: false, completedAt: new Date() } }
  );
}

/**
 * Starts an attempt at a level with the player's chosen per-question timer.
 * If the player already has an attempt in progress at this level it is returned
 * (a refresh never hands out fresh questions), unless `restart` is set, which closes
 * the old attempt as not passed and starts again with new questions and the new timer.
 */
export async function startAttempt(
  userId: string,
  levelNumber: number,
  timerSeconds: any,
  restart = false
) {
  if (!isValidTimerSeconds(timerSeconds)) {
    const { minSeconds, maxSeconds } = getTimerRange();
    throw new ErrorHandler(
      `timerSeconds must be a whole number from ${minSeconds} to ${maxSeconds}`,
      400,
      "INVALID_TIMER",
      { minSeconds, maxSeconds }
    );
  }

  const levels = await getActiveLevels();
  const index = levels.findIndex((l) => l.level === levelNumber);
  if (index === -1) throw new ErrorHandler("Level not found", 404, "LEVEL_NOT_FOUND");

  const progress = await getProgress(userId);
  if (!isUnlocked(levels, index, passedLevels(progress))) {
    throw new ErrorHandler(
      "This level is locked. Answer every question in the previous level correctly to unlock it.",
      403,
      "LEVEL_LOCKED",
      { level: levelNumber, requiredLevel: levels[index - 1].level }
    );
  }

  const existing = await MatchAttemptModel.findOne({ userId, level: levelNumber, active: true });
  if (existing) {
    if (!restart) return { attempt: publicAttempt(existing), resumed: true };
    await closeAsAbandoned(existing._id);
  }

  const level = levels[index];
  const questions = generateQuestions(level);

  let attempt: IMatchAttempt;
  try {
    attempt = await MatchAttemptModel.create({
      userId,
      level: levelNumber,
      timerSeconds,
      questionCount: questions.length,
    });
  } catch (e: any) {
    if (e.code === 11000) {
      // Two starts raced; the unique index let exactly one through.
      const winner = await MatchAttemptModel.findOne({ userId, level: levelNumber, active: true });
      if (winner) return { attempt: publicAttempt(winner), resumed: true };
    }
    throw e;
  }

  await MatchQuestionModel.insertMany(
    questions.map((q, i) => ({ attemptId: String(attempt._id), index: i, ...q }))
  );
  await bumpLevelStats(userId, levelNumber, { attempts: 1 });

  return { attempt: publicAttempt(attempt), resumed: false };
}

async function bumpLevelStats(
  userId: string,
  level: number,
  change: { attempts?: number; result?: { correct: number; total: number; passed: boolean } }
) {
  const progress = await getProgress(userId);
  let entry = progress.levels.find((l) => l.level === level);
  if (!entry) {
    progress.levels.push({ level, attempts: 0, bestCorrect: 0, bestTotal: 0, passed: false });
    entry = progress.levels[progress.levels.length - 1];
  }
  if (change.attempts) entry.attempts += change.attempts;
  if (change.result) {
    const { correct, total, passed } = change.result;
    const better =
      entry.bestTotal === 0 || correct / total > entry.bestCorrect / entry.bestTotal;
    if (better) {
      entry.bestCorrect = correct;
      entry.bestTotal = total;
    }
    entry.passed = entry.passed || passed;
  }
  entry.lastPlayedAt = new Date();
  await progress.save();
}

async function loadOwnedAttempt(userId: string, attemptId: string): Promise<IMatchAttempt> {
  const attempt = await MatchAttemptModel.findOne({ _id: attemptId, userId });
  // 404 (not 403) so attempt ids of other players cannot be probed.
  if (!attempt) throw new ErrorHandler("Attempt not found", 404, "ATTEMPT_NOT_FOUND");
  return attempt;
}

async function buildResult(attempt: IMatchAttempt) {
  const levels = await getActiveLevels();
  const index = levels.findIndex((l) => l.level === attempt.level);
  const next = index >= 0 ? levels[index + 1] : undefined;
  return {
    attemptId: String(attempt._id),
    level: attempt.level,
    correct: attempt.correctCount,
    total: attempt.questionCount,
    passed: attempt.passed,
    nextLevel: next ? next.level : null,
    nextLevelUnlocked: attempt.passed && !!next,
    completedAt: attempt.completedAt,
  };
}

/** Closes a finished attempt and applies the unlock rule. Runs once per attempt. */
async function completeAttempt(attempt: IMatchAttempt): Promise<IMatchAttempt> {
  const passed = attempt.correctCount === attempt.questionCount;
  const closed = await MatchAttemptModel.findOneAndUpdate(
    { _id: attempt._id, active: true },
    {
      $set: {
        status: "completed",
        active: false,
        passed,
        unlockedNextLevel: passed,
        completedAt: new Date(),
      },
    },
    { new: true }
  );
  if (!closed) return (await MatchAttemptModel.findById(attempt._id))!;

  await bumpLevelStats(closed.userId, closed.level, {
    result: { correct: closed.correctCount, total: closed.questionCount, passed },
  });
  if (passed) {
    const levels = await getActiveLevels();
    const index = levels.findIndex((l) => l.level === closed.level);
    const next = index >= 0 ? levels[index + 1] : undefined;
    if (next) {
      await MatchProgressModel.updateOne(
        { userId: closed.userId },
        { $max: { highestUnlockedLevel: next.level } }
      );
    }
  }
  return closed;
}

/** Records an outcome for the current question and moves the attempt forward. */
async function settleQuestion(
  attempt: IMatchAttempt,
  questionIndex: number,
  outcome: QuestionOutcome,
  selectedOptionId?: string
): Promise<IMatchAttempt> {
  const settled = await MatchQuestionModel.findOneAndUpdate(
    { attemptId: String(attempt._id), index: questionIndex, outcome: { $exists: false } },
    { $set: { outcome, answeredAt: new Date(), ...(selectedOptionId ? { selectedOptionId } : {}) } },
    { new: true }
  );
  if (!settled) return (await MatchAttemptModel.findById(attempt._id))!;

  const advanced = await MatchAttemptModel.findOneAndUpdate(
    { _id: attempt._id, active: true, currentIndex: questionIndex },
    { $inc: { currentIndex: 1, correctCount: outcome === "correct" ? 1 : 0 } },
    { new: true }
  );
  if (!advanced) return (await MatchAttemptModel.findById(attempt._id))!;
  return advanced.currentIndex >= advanced.questionCount ? completeAttempt(advanced) : advanced;
}

/**
 * Times out the current question if its deadline (plus grace) has passed without an
 * answer. Keeps going in case the next question is somehow also overdue.
 */
async function expireOverdue(attempt: IMatchAttempt, now: Date): Promise<IMatchAttempt> {
  const graceMs = await getSubmitGraceMs();
  let current = attempt;
  while (current.active && current.currentIndex < current.questionCount) {
    const question = await MatchQuestionModel.findOne({
      attemptId: String(current._id),
      index: current.currentIndex,
    }).lean();
    if (!question || !question.deadlineAt || question.outcome) break;
    if (!isPastDeadline(question.deadlineAt, now, graceMs)) break;
    current = await settleQuestion(current, question.index, "timeout");
  }
  return current;
}

const publicArtifact = (id: string) => {
  const artifact = getArtifact(id)!;
  return { ...artifact, svg: renderArtifactSvg(artifact) };
};

/**
 * Returns the question the player is on. The first call for a question starts its
 * clock; later calls (e.g. after a refresh) return the same question with the time
 * that is left. The correct option is never part of this payload.
 */
export async function getCurrentQuestion(userId: string, attemptId: string) {
  const now = new Date();
  let attempt = await loadOwnedAttempt(userId, attemptId);
  if (attempt.status === "abandoned") {
    throw new ErrorHandler("This attempt was abandoned", 409, "ATTEMPT_ABANDONED");
  }
  attempt = await expireOverdue(attempt, now);
  if (!attempt.active) {
    return { completed: true, attempt: publicAttempt(attempt), result: await buildResult(attempt) };
  }

  const filter = { attemptId: String(attempt._id), index: attempt.currentIndex };
  await MatchQuestionModel.updateOne(
    { ...filter, servedAt: { $exists: false } },
    { $set: { servedAt: now, deadlineAt: deadlineFrom(now, attempt.timerSeconds) } }
  );
  const question = (await MatchQuestionModel.findOne(filter).lean())!;

  return {
    completed: false,
    attempt: publicAttempt(attempt),
    question: {
      index: question.index,
      total: attempt.questionCount,
      target: publicArtifact(question.targetId),
      options: question.optionIds.map(publicArtifact),
      timerSeconds: attempt.timerSeconds,
      servedAt: question.servedAt,
      deadlineAt: question.deadlineAt,
      remainingMs: remainingMs(question.deadlineAt!, now),
      serverTime: now,
    },
  };
}

/**
 * Validates an answer on the server. The outcome depends only on the stored correct
 * option and the stored deadline. Re-sending an answer for a question that is already
 * settled returns the stored outcome and changes nothing.
 */
export async function submitAnswer(
  userId: string,
  attemptId: string,
  questionIndex: any,
  optionId: any
) {
  const now = new Date();
  if (!Number.isInteger(questionIndex) || questionIndex < 0) {
    throw new ErrorHandler("questionIndex must be a non-negative integer", 400);
  }
  let attempt = await loadOwnedAttempt(userId, attemptId);
  const question = await MatchQuestionModel.findOne({
    attemptId: String(attempt._id),
    index: questionIndex,
  }).lean();
  if (!question) throw new ErrorHandler("Question not found", 404, "QUESTION_NOT_FOUND");

  let outcome = question.outcome;
  if (!outcome) {
    if (!attempt.active) {
      throw new ErrorHandler("This attempt is no longer in progress", 409, "ATTEMPT_NOT_ACTIVE");
    }
    if (questionIndex !== attempt.currentIndex) {
      throw new ErrorHandler("That is not the current question", 409, "NOT_CURRENT_QUESTION", {
        currentIndex: attempt.currentIndex,
      });
    }
    if (!question.servedAt || !question.deadlineAt) {
      throw new ErrorHandler("Fetch the question before answering it", 409, "QUESTION_NOT_SERVED");
    }

    if (isPastDeadline(question.deadlineAt, now, await getSubmitGraceMs())) {
      outcome = "timeout";
    } else {
      if (typeof optionId !== "string" || !question.optionIds.includes(optionId)) {
        throw new ErrorHandler("optionId is not one of this question's options", 400, "INVALID_OPTION");
      }
      outcome = optionId === question.correctOptionId ? "correct" : "wrong";
    }
    attempt = await settleQuestion(
      attempt,
      questionIndex,
      outcome,
      outcome === "timeout" ? undefined : optionId
    );
    // A concurrent request may have settled it first; report what was stored.
    const stored = await MatchQuestionModel.findById(question._id).select("outcome").lean();
    outcome = stored?.outcome || outcome;
  } else {
    attempt = (await MatchAttemptModel.findById(attempt._id))!;
  }

  const completed = !attempt.active;
  return {
    questionIndex,
    outcome,
    // Safe to reveal now: the question is settled and can never be answered again.
    correctOptionId: question.correctOptionId,
    completed,
    nextQuestionIndex: completed ? null : attempt.currentIndex,
    result: completed ? await buildResult(attempt) : null,
  };
}

/** Result of a finished attempt. Refuses while questions are still outstanding. */
export async function finishAttempt(userId: string, attemptId: string) {
  let attempt = await loadOwnedAttempt(userId, attemptId);
  if (attempt.status === "abandoned") {
    throw new ErrorHandler("This attempt was abandoned", 409, "ATTEMPT_ABANDONED");
  }
  attempt = await expireOverdue(attempt, new Date());
  if (attempt.active) {
    throw new ErrorHandler(
      "This attempt still has unanswered questions",
      409,
      "ATTEMPT_IN_PROGRESS",
      { currentIndex: attempt.currentIndex, total: attempt.questionCount }
    );
  }
  return buildResult(attempt);
}

export async function getAttempt(userId: string, attemptId: string) {
  const attempt = await loadOwnedAttempt(userId, attemptId);
  return {
    attempt: publicAttempt(attempt),
    result: attempt.status === "completed" ? await buildResult(attempt) : null,
  };
}

export async function getProgressSummary(userId: string) {
  const progress = await getProgress(userId);
  return {
    highestUnlockedLevel: progress.highestUnlockedLevel,
    levels: progress.levels.map((l) => ({
      level: l.level,
      attempts: l.attempts,
      best: { correct: l.bestCorrect, total: l.bestTotal },
      passed: l.passed,
      lastPlayedAt: l.lastPlayedAt || null,
    })),
  };
}

/** Scheduler: closes attempts that were walked away from. */
export async function abandonStaleMatchAttempts(now: Date = new Date()): Promise<number> {
  const result = await MatchAttemptModel.updateMany(
    { active: true, startedAt: { $lt: new Date(now.getTime() - STALE_ATTEMPT_MS) } },
    { $set: { status: "abandoned", active: false, completedAt: now } }
  );
  return result.modifiedCount;
}
