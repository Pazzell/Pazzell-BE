import GameSessionModel, {
  GameType,
  IGameSession,
} from "../../models/gameSession.model";
import PuzzleCampaignModel from "../../models/puzzleCampaign.model";
import { awardPoints } from "../points/pointsLedger.service";
import { getAntiCheatFloors, getSessionCompletionPoints } from "../config/config.service";
import { evaluateTiming, evaluateVideoWatchTime } from "./antiCheat";
import { mintTicketOnFirstCompletion } from "../raffle.service";
import { getWeekKey } from "../../utils/weekBoundary";

export class SessionError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const ALL_GAME_TYPES: GameType[] = [
  "sliding_puzzle",
  "card_matching",
  "spot_the_difference",
  "word_hunt",
];

async function loadOwnedSession(
  sessionId: string,
  userId: string
): Promise<IGameSession> {
  const session = await GameSessionModel.findById(sessionId);
  if (!session) throw new SessionError("Session not found", 404);
  if (String(session.userId) !== String(userId)) {
    throw new SessionError("You do not own this session", 403);
  }
  return session;
}

function flagSession(session: IGameSession, reason: string, hard: boolean) {
  session.anticheat.flagged = true;
  session.anticheat.flaggedReasons.push(reason);
  if (hard) {
    session.anticheat.voided = true;
    session.anticheat.voidReason = session.anticheat.voidReason || reason;
  }
}

/** Whether this user already has a completed first-completion session for this campaign
 * (v2) — used by the completion-status endpoint to show the "replay is just for fun" warning. */
export async function hasFirstCompletion(
  userId: string,
  campaignId: string
): Promise<boolean> {
  const existing = await GameSessionModel.findOne({
    userId,
    campaignId,
    isFirstCompletionForUser: true,
  }).lean();
  return !!existing;
}

export async function startSession(
  userId: string,
  campaignId: string
): Promise<IGameSession> {
  const campaign = await PuzzleCampaignModel.findById(campaignId);
  if (!campaign) throw new SessionError("Campaign not found", 404);
  if (campaign.status !== "active") {
    throw new SessionError("Campaign is not active", 400);
  }

  const gameTypes = campaign.gameTypes && campaign.gameTypes.length
    ? campaign.gameTypes
    : ALL_GAME_TYPES;

  return GameSessionModel.create({
    userId,
    campaignId,
    status: "in_progress",
    startedAt: new Date(),
    games: gameTypes.map((gameType) => ({ gameType })),
    video: {},
    quiz: { firstAttempt: null, attempts: [] },
    pointsAwarded: 0,
    raffleTicketAwarded: false,
    anticheat: { flagged: false, flaggedReasons: [], voided: false },
  });
}

export async function startGameStage(
  sessionId: string,
  userId: string,
  gameType: GameType
): Promise<IGameSession> {
  const session = await loadOwnedSession(sessionId, userId);
  if (session.status !== "in_progress") {
    throw new SessionError(`Session is ${session.status}, cannot continue`, 400);
  }
  const stage = session.games.find((g) => g.gameType === gameType);
  if (!stage) throw new SessionError(`Unknown game type for this session: ${gameType}`, 400);
  if (!stage.startedAt) stage.startedAt = new Date();
  await session.save();
  return session;
}

export async function completeGameStage(
  sessionId: string,
  userId: string,
  gameType: GameType,
  clientMovesTaken?: number,
  clientTimeTakenMs?: number
): Promise<IGameSession> {
  const session = await loadOwnedSession(sessionId, userId);
  if (session.status !== "in_progress") {
    throw new SessionError(`Session is ${session.status}, cannot continue`, 400);
  }
  const stage = session.games.find((g) => g.gameType === gameType);
  if (!stage) throw new SessionError(`Unknown game type for this session: ${gameType}`, 400);
  if (!stage.startedAt) {
    throw new SessionError(`Game stage ${gameType} was never started`, 400);
  }

  const now = new Date();
  stage.completedAt = now;
  if (clientMovesTaken !== undefined) stage.clientMovesTaken = clientMovesTaken;
  if (clientTimeTakenMs !== undefined) stage.clientTimeTakenMs = clientTimeTakenMs;

  const durationMs = now.getTime() - stage.startedAt.getTime();
  const floors = await getAntiCheatFloors();
  const verdict = evaluateTiming(
    durationMs,
    floors.softFloorMs[gameType] ?? 0,
    floors.hardFloorMs[gameType] ?? 0
  );
  if (verdict !== "ok") {
    flagSession(
      session,
      `${gameType} completed in ${durationMs}ms (implausibly fast)`,
      verdict === "hard"
    );
  }

  await session.save();
  return session;
}

export async function startVideoStage(
  sessionId: string,
  userId: string
): Promise<IGameSession> {
  const session = await loadOwnedSession(sessionId, userId);
  if (session.status !== "in_progress") {
    throw new SessionError(`Session is ${session.status}, cannot continue`, 400);
  }
  const allGamesDone = session.games.every((g) => !!g.completedAt);
  if (!allGamesDone) {
    throw new SessionError("Complete all four games before watching the video", 400);
  }
  if (!session.video.startedAt) session.video.startedAt = new Date();
  await session.save();
  return session;
}

export async function completeVideoStage(
  sessionId: string,
  userId: string
): Promise<IGameSession> {
  const session = await loadOwnedSession(sessionId, userId);
  if (session.status !== "in_progress") {
    throw new SessionError(`Session is ${session.status}, cannot continue`, 400);
  }
  if (!session.video.startedAt) {
    throw new SessionError("Video stage was never started", 400);
  }

  const campaign = await PuzzleCampaignModel.findById(session.campaignId);
  if (!campaign) throw new SessionError("Campaign not found", 404);

  const now = new Date();
  session.video.completedAt = now;
  const durationMs = now.getTime() - session.video.startedAt.getTime();

  if (campaign.videoDurationSeconds) {
    const floors = await getAntiCheatFloors();
    const verdict = evaluateVideoWatchTime(
      durationMs,
      campaign.videoDurationSeconds,
      floors.videoMinWatchFraction,
      floors.videoHardWatchFraction
    );
    if (verdict !== "ok") {
      flagSession(
        session,
        `video watched for ${durationMs}ms of a ${campaign.videoDurationSeconds}s video (implausibly short)`,
        verdict === "hard"
      );
    }
  }

  await session.save();
  return session;
}

export async function submitQuizAttempt(
  sessionId: string,
  userId: string,
  answers: number[]
): Promise<{ session: IGameSession; score: number; allCorrect: boolean }> {
  const session = await loadOwnedSession(sessionId, userId);
  if (session.status !== "in_progress") {
    throw new SessionError(`Session is ${session.status}, cannot continue`, 400);
  }
  if (!session.video.completedAt) {
    throw new SessionError("Watch the video before attempting the quiz", 400);
  }

  const campaign = await PuzzleCampaignModel.findById(session.campaignId);
  if (!campaign) throw new SessionError("Campaign not found", 404);

  const questions = campaign.questions || [];
  let score = 0;
  if (Array.isArray(answers)) {
    for (let i = 0; i < Math.min(answers.length, questions.length); i++) {
      if (answers[i] === questions[i].correctIndex) score++;
    }
  }
  const allCorrect = questions.length > 0 && score === questions.length;

  const now = new Date();
  const priorTransition =
    session.quiz.attempts.length > 0
      ? session.quiz.attempts[session.quiz.attempts.length - 1].submittedAt
      : session.video.completedAt;
  const durationMs = now.getTime() - priorTransition.getTime();

  const floors = await getAntiCheatFloors();
  const verdict = evaluateTiming(
    durationMs,
    floors.softFloorMs.quiz ?? 0,
    floors.hardFloorMs.quiz ?? 0
  );
  if (verdict !== "ok") {
    flagSession(
      session,
      `quiz attempt submitted ${durationMs}ms after previous stage (implausibly fast)`,
      verdict === "hard"
    );
  }

  const attempt = { answers, score, allCorrect, submittedAt: now };
  if (!session.quiz.firstAttempt) {
    session.quiz.firstAttempt = attempt;
  }
  session.quiz.attempts.push(attempt);

  await session.save();
  return { session, score, allCorrect };
}

export interface CompleteSessionResult {
  session: IGameSession;
  isFirstCompletion: boolean;
  pointsAwarded: number;
  totalCompletionTimeMs: number;
  voided: boolean;
  flagged: boolean;
}

export async function completeSession(
  sessionId: string,
  userId: string
): Promise<CompleteSessionResult> {
  const session = await loadOwnedSession(sessionId, userId);

  // Idempotent: calling /complete again on an already-completed session just
  // returns the original result, never re-awards anything.
  if (session.status === "completed") {
    return {
      session,
      isFirstCompletion: !!session.isFirstCompletionForUser,
      pointsAwarded: session.pointsAwarded,
      totalCompletionTimeMs: session.totalCompletionTimeMs || 0,
      voided: session.anticheat.voided,
      flagged: session.anticheat.flagged,
    };
  }
  if (session.status === "voided" || session.status === "abandoned") {
    throw new SessionError(`Session is ${session.status}, cannot be completed`, 400);
  }

  const allGamesDone = session.games.every((g) => !!g.completedAt);
  if (!allGamesDone) {
    throw new SessionError("All four games must be completed first", 400);
  }
  if (!session.video.completedAt) {
    throw new SessionError("The video must be watched first", 400);
  }
  const hasCorrectQuizAttempt = session.quiz.attempts.some((a) => a.allCorrect);
  if (!hasCorrectQuizAttempt) {
    throw new SessionError(
      "All quiz questions must be answered correctly before completing",
      400
    );
  }

  const now = new Date();
  const totalCompletionTimeMs = now.getTime() - session.startedAt.getTime();
  session.completedAt = now;
  session.totalCompletionTimeMs = totalCompletionTimeMs;

  if (session.anticheat.voided) {
    session.status = "voided";
    await session.save();
    return {
      session,
      isFirstCompletion: false,
      pointsAwarded: 0,
      totalCompletionTimeMs,
      voided: true,
      flagged: session.anticheat.flagged,
    };
  }

  session.status = "completed";

  // Race-safe first-completion claim: attempt the write with the flag set to
  // true and let the partial unique index on {userId,campaignId} arbitrate.
  // A concurrent duplicate throws E11000, which we catch and treat as "not first".
  session.isFirstCompletionForUser = true;
  let isFirstCompletion = true;
  try {
    await session.save();
  } catch (err: any) {
    if (err?.code === 11000) {
      session.isFirstCompletionForUser = false;
      isFirstCompletion = false;
      await session.save();
    } else {
      throw err;
    }
  }

  let pointsAwarded = 0;
  if (isFirstCompletion) {
    pointsAwarded = await getSessionCompletionPoints();
    const weekKey = getWeekKey(now);
    const ticket = await mintTicketOnFirstCompletion(
      userId,
      session.campaignId,
      String(session._id),
      weekKey
    );
    session.pointsAwarded = pointsAwarded;
    session.raffleTicketAwarded = !!ticket;
    await session.save();

    await awardPoints({
      userId,
      points: pointsAwarded,
      source: "session_completion",
      sourceRefId: String(session._id),
      campaignId: session.campaignId,
      completionTimeMs: totalCompletionTimeMs,
      at: now,
    });
  }

  return {
    session,
    isFirstCompletion,
    pointsAwarded,
    totalCompletionTimeMs,
    voided: false,
    flagged: session.anticheat.flagged,
  };
}
