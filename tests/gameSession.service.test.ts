import { connectTestDB, clearTestDB, closeTestDB } from "./setup";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";
import GameSessionModel, { GameType } from "../models/gameSession.model";
import {
  startSession,
  startGameStage,
  completeGameStage,
  startVideoStage,
  completeVideoStage,
  submitQuizAttempt,
  completeSession,
} from "../services/session/gameSession.service";
import { getUserLifetimePoints } from "../services/points/pointsLedger.service";

const ALL_GAME_TYPES: GameType[] = [
  "sliding_puzzle",
  "card_matching",
  "spot_the_difference",
  "word_hunt",
];

async function createV2Campaign(overrides: Partial<any> = {}) {
  const now = new Date();
  return PuzzleCampaignModel.create({
    brandId: "brand-1",
    packageId: "000000000000000000000000",
    schemaVersion: 2,
    gameType: "sliding_puzzle",
    gameTypes: ALL_GAME_TYPES,
    title: "Multi-game campaign",
    description: "A v2 test campaign",
    puzzleImageUrl: "http://example.com/image.png",
    videoUrl: "http://example.com/video.mp4",
    videoDurationSeconds: 120,
    words: ["apple", "banana"],
    questions: [
      { question: "q1", choices: ["a", "b"], correctIndex: 0 },
      { question: "q2", choices: ["a", "b"], correctIndex: 1 },
      { question: "q3", choices: ["a", "b"], correctIndex: 0 },
    ],
    prizeDescription: "A prize",
    prizeUnitsAvailable: 1,
    durationWeeks: 2,
    weeklyPrice: 7000,
    timeLimit: 2 * 7 * 24,
    status: "active",
    paymentStatus: "paid",
    startDate: now,
    endDate: new Date(now.getTime() + 2 * 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  });
}

/** Backdates a just-started game stage so its duration comfortably clears the
 * anti-cheat soft floor, without needing a real sleep in the test. */
async function backdateGameStage(sessionId: string, gameType: GameType, msAgo: number) {
  const doc = await GameSessionModel.findById(sessionId);
  const stage = doc!.games.find((g) => g.gameType === gameType)!;
  stage.startedAt = new Date(Date.now() - msAgo);
  await doc!.save();
}

async function backdateVideoStart(sessionId: string, msAgo: number) {
  const doc = await GameSessionModel.findById(sessionId);
  doc!.video.startedAt = new Date(Date.now() - msAgo);
  await doc!.save();
}

async function backdateVideoCompleted(sessionId: string, msAgo: number) {
  const doc = await GameSessionModel.findById(sessionId);
  doc!.video.completedAt = new Date(Date.now() - msAgo);
  await doc!.save();
}

async function backdateLastQuizAttempt(sessionId: string, msAgo: number) {
  const doc = await GameSessionModel.findById(sessionId);
  const attempts = doc!.quiz.attempts;
  attempts[attempts.length - 1].submittedAt = new Date(Date.now() - msAgo);
  await doc!.save();
}

/** Drives a session through all 4 games + video + a wrong quiz attempt then a
 * correct one, backdating timestamps at each step so nothing trips the
 * anti-cheat floors, and returns the session id ready for completeSession(). */
async function driveToQuizSuccess(userId: string, campaignId: string) {
  const session = await startSession(userId, campaignId);
  const sessionId = String(session._id);

  for (const gameType of ALL_GAME_TYPES) {
    await startGameStage(sessionId, userId, gameType);
    await backdateGameStage(sessionId, gameType, 5000);
    await completeGameStage(sessionId, userId, gameType, 10, 5000);
  }

  await startVideoStage(sessionId, userId);
  await backdateVideoStart(sessionId, 130000); // 130s ago, comfortably over the 120s video's soft floor
  await completeVideoStage(sessionId, userId);
  await backdateVideoCompleted(sessionId, 5000); // so the first quiz attempt isn't flagged as instant

  await submitQuizAttempt(sessionId, userId, [1, 0, 1]); // deliberately wrong
  await backdateLastQuizAttempt(sessionId, 5000);
  const { allCorrect } = await submitQuizAttempt(sessionId, userId, [0, 1, 0]); // correct
  expect(allCorrect).toBe(true);

  return sessionId;
}

describe("GameSession service — full funnel", () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  it("awards a flat 7 points and records total completion time on first completion", async () => {
    const campaign = await createV2Campaign();
    const userId = "user-1";

    const sessionId = await driveToQuizSuccess(userId, String(campaign._id));
    const result = await completeSession(sessionId, userId);

    expect(result.isFirstCompletion).toBe(true);
    expect(result.pointsAwarded).toBe(7);
    expect(result.voided).toBe(false);
    expect(result.totalCompletionTimeMs).toBeGreaterThan(0);

    const lifetimePoints = await getUserLifetimePoints(userId);
    expect(lifetimePoints).toBe(7);
  });

  it("logs the first quiz attempt separately from later retries", async () => {
    const campaign = await createV2Campaign();
    const userId = "user-2";
    const sessionId = await driveToQuizSuccess(userId, String(campaign._id));

    const session = await GameSessionModel.findById(sessionId);
    expect(session!.quiz.attempts.length).toBe(2);
    expect(session!.quiz.firstAttempt).not.toBeNull();
    expect(session!.quiz.firstAttempt!.allCorrect).toBe(false); // first attempt was the deliberate wrong one
    expect(session!.quiz.attempts[1].allCorrect).toBe(true);
  });

  it("rejects completion before all four games are finished", async () => {
    const campaign = await createV2Campaign();
    const userId = "user-3";
    const session = await startSession(userId, String(campaign._id));

    await expect(completeSession(String(session._id), userId)).rejects.toThrow(
      /all four games/i
    );
  });

  describe("first-completion-only guard", () => {
    it("awards nothing on a replay (second completed session for the same user+campaign)", async () => {
      const campaign = await createV2Campaign();
      const userId = "user-4";

      const firstSessionId = await driveToQuizSuccess(userId, String(campaign._id));
      const firstResult = await completeSession(firstSessionId, userId);
      expect(firstResult.isFirstCompletion).toBe(true);
      expect(firstResult.pointsAwarded).toBe(7);

      const secondSessionId = await driveToQuizSuccess(userId, String(campaign._id));
      const secondResult = await completeSession(secondSessionId, userId);
      expect(secondResult.isFirstCompletion).toBe(false);
      expect(secondResult.pointsAwarded).toBe(0);

      const lifetimePoints = await getUserLifetimePoints(userId);
      expect(lifetimePoints).toBe(7); // still just the one award, not 14
    });

    it("is idempotent when /complete is called twice on the same session", async () => {
      const campaign = await createV2Campaign();
      const userId = "user-5";
      const sessionId = await driveToQuizSuccess(userId, String(campaign._id));

      const first = await completeSession(sessionId, userId);
      const second = await completeSession(sessionId, userId);

      expect(first.pointsAwarded).toBe(7);
      expect(second.pointsAwarded).toBe(7); // returns the same recorded result, doesn't re-award
      const lifetimePoints = await getUserLifetimePoints(userId);
      expect(lifetimePoints).toBe(7);
    });

    it("under a concurrent race, exactly one of two simultaneous completions wins first-completion", async () => {
      const campaign = await createV2Campaign();
      const userId = "user-6";

      const sessionIdA = await driveToQuizSuccess(userId, String(campaign._id));
      const sessionIdB = await driveToQuizSuccess(userId, String(campaign._id));

      const [resultA, resultB] = await Promise.all([
        completeSession(sessionIdA, userId),
        completeSession(sessionIdB, userId),
      ]);

      const firstCompletions = [resultA.isFirstCompletion, resultB.isFirstCompletion];
      expect(firstCompletions.filter(Boolean).length).toBe(1);

      const totalPointsAwarded = resultA.pointsAwarded + resultB.pointsAwarded;
      expect(totalPointsAwarded).toBe(7);

      const lifetimePoints = await getUserLifetimePoints(userId);
      expect(lifetimePoints).toBe(7);
    });
  });

  describe("anti-cheat timing", () => {
    it("voids a session when a game stage completes implausibly fast (hard floor)", async () => {
      const campaign = await createV2Campaign();
      const userId = "user-7";
      const session = await startSession(userId, String(campaign._id));
      const sessionId = String(session._id);

      // Backdate startedAt into the future so completedAt - startedAt is
      // negative — deterministically below the hard floor without relying on
      // real elapsed wall-clock time.
      const doc = await GameSessionModel.findById(sessionId);
      const stage = doc!.games.find((g) => g.gameType === ALL_GAME_TYPES[0])!;
      stage.startedAt = new Date(Date.now() + 5000);
      await doc!.save();

      const updated = await completeGameStage(sessionId, userId, ALL_GAME_TYPES[0]);
      expect(updated.anticheat.voided).toBe(true);
      expect(updated.anticheat.flagged).toBe(true);
    });

    it("flags but does not void a session when timing is suspicious but not impossible (soft floor)", async () => {
      const campaign = await createV2Campaign();
      const userId = "user-8";
      const session = await startSession(userId, String(campaign._id));
      const sessionId = String(session._id);

      await backdateGameStage(sessionId, ALL_GAME_TYPES[0], 1000); // 1s: between hard(500ms) and soft(3000ms)
      const updated = await completeGameStage(sessionId, userId, ALL_GAME_TYPES[0]);

      expect(updated.anticheat.flagged).toBe(true);
      expect(updated.anticheat.voided).toBe(false);
    });

    it("awards nothing for a voided session even on first completion", async () => {
      const campaign = await createV2Campaign();
      const userId = "user-9";
      const session = await startSession(userId, String(campaign._id));
      const sessionId = String(session._id);

      // Void via the first game stage (future startedAt trick), then still
      // drive the rest of the funnel to a valid quiz completion.
      const doc = await GameSessionModel.findById(sessionId);
      const firstStage = doc!.games.find((g) => g.gameType === ALL_GAME_TYPES[0])!;
      firstStage.startedAt = new Date(Date.now() + 5000);
      await doc!.save();
      await completeGameStage(sessionId, userId, ALL_GAME_TYPES[0]);

      for (const gameType of ALL_GAME_TYPES.slice(1)) {
        await startGameStage(sessionId, userId, gameType);
        await backdateGameStage(sessionId, gameType, 5000);
        await completeGameStage(sessionId, userId, gameType, 10, 5000);
      }
      await startVideoStage(sessionId, userId);
      await backdateVideoStart(sessionId, 130000);
      await completeVideoStage(sessionId, userId);
      await backdateVideoCompleted(sessionId, 5000);
      await submitQuizAttempt(sessionId, userId, [0, 1, 0]);

      const result = await completeSession(sessionId, userId);
      expect(result.voided).toBe(true);
      expect(result.pointsAwarded).toBe(0);
      expect(result.isFirstCompletion).toBe(false);

      const lifetimePoints = await getUserLifetimePoints(userId);
      expect(lifetimePoints).toBe(0);
    });
  });
});
