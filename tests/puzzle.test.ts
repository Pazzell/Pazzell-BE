import request from "supertest";
import { app } from "../app";
import { connectTestDB, clearTestDB, closeTestDB } from "./setup";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";
import GameSessionModel, { GameType } from "../models/gameSession.model";

const ALL_GAME_TYPES: GameType[] = [
  "sliding_puzzle",
  "card_matching",
  "spot_the_difference",
  "word_hunt",
];

async function createV2Campaign() {
  const now = new Date();
  return PuzzleCampaignModel.create({
    brandId: "brand-1",
    packageId: "000000000000000000000000",
    gameTypes: ALL_GAME_TYPES,
    title: "Test multi-game campaign",
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
    durationWeeks: 1,
    timeLimit: 168,
    status: "active",
    paymentStatus: "paid",
    startDate: now,
    endDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
  });
}

async function getAuthToken(email: string, googleId: string) {
  const authRes = await request(app).post("/api/v1/auth/google").send({
    email,
    name: "Player",
    googleId,
  });
  return authRes.body.accessToken as string;
}

/** Backdates a stage's start timestamp so its duration clears the anti-cheat
 * soft floor, avoiding real sleeps in the test. */
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

describe("Session-based gameplay flow (v2 multi-game campaigns)", () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  it("drives a full session (4 games -> video -> quiz) to completion via the live HTTP endpoints and awards 7 points", async () => {
    const campaign = await createV2Campaign();
    const token = await getAuthToken("player@test.local", "gid-1");
    const authHeader = `Bearer ${token}`;

    const startRes = await request(app)
      .post("/api/v1/sessions/start")
      .set("Authorization", authHeader)
      .send({ campaignId: String(campaign._id) });
    expect(startRes.status).toBe(201);
    const sessionId = startRes.body.session._id;

    for (const gameType of ALL_GAME_TYPES) {
      const startStage = await request(app)
        .post(`/api/v1/sessions/${sessionId}/games/${gameType}/start`)
        .set("Authorization", authHeader);
      expect(startStage.status).toBe(200);

      await backdateGameStage(sessionId, gameType, 5000);

      const completeStage = await request(app)
        .post(`/api/v1/sessions/${sessionId}/games/${gameType}/complete`)
        .set("Authorization", authHeader)
        .send({ movesTaken: 10, timeTakenMs: 5000 });
      expect(completeStage.status).toBe(200);
    }

    const videoStart = await request(app)
      .post(`/api/v1/sessions/${sessionId}/video/start`)
      .set("Authorization", authHeader);
    expect(videoStart.status).toBe(200);
    await backdateVideoStart(sessionId, 130000);

    const videoComplete = await request(app)
      .post(`/api/v1/sessions/${sessionId}/video/complete`)
      .set("Authorization", authHeader);
    expect(videoComplete.status).toBe(200);
    await backdateVideoCompleted(sessionId, 5000);

    const wrongAttempt = await request(app)
      .post(`/api/v1/sessions/${sessionId}/quiz/attempt`)
      .set("Authorization", authHeader)
      .send({ answers: [1, 0, 1] });
    expect(wrongAttempt.status).toBe(200);
    expect(wrongAttempt.body.allCorrect).toBe(false);
    await backdateLastQuizAttempt(sessionId, 5000);

    const correctAttempt = await request(app)
      .post(`/api/v1/sessions/${sessionId}/quiz/attempt`)
      .set("Authorization", authHeader)
      .send({ answers: [0, 1, 0] });
    expect(correctAttempt.status).toBe(200);
    expect(correctAttempt.body.allCorrect).toBe(true);
    expect(correctAttempt.body.firstAttemptScore).toBeLessThan(3); // first (wrong) attempt logged separately

    const completeRes = await request(app)
      .post(`/api/v1/sessions/${sessionId}/complete`)
      .set("Authorization", authHeader);

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.isFirstCompletion).toBe(true);
    expect(completeRes.body.pointsAwarded).toBe(7);
    expect(completeRes.body.voided).toBe(false);
  });

  it("exposes completion status so the client can show the replay warning, and rejects a duplicate completion server-side", async () => {
    const campaign = await createV2Campaign();
    const token = await getAuthToken("player2@test.local", "gid-2");
    const authHeader = `Bearer ${token}`;

    const before = await request(app)
      .get(`/api/v1/campaigns/${campaign._id}/completion`)
      .set("Authorization", authHeader);
    expect(before.body.hasCompletedByCurrentUser).toBe(false);

    // First full completion
    const startRes = await request(app)
      .post("/api/v1/sessions/start")
      .set("Authorization", authHeader)
      .send({ campaignId: String(campaign._id) });
    const sessionId = startRes.body.session._id;

    for (const gameType of ALL_GAME_TYPES) {
      await request(app)
        .post(`/api/v1/sessions/${sessionId}/games/${gameType}/start`)
        .set("Authorization", authHeader);
      await backdateGameStage(sessionId, gameType, 5000);
      await request(app)
        .post(`/api/v1/sessions/${sessionId}/games/${gameType}/complete`)
        .set("Authorization", authHeader);
    }
    await request(app).post(`/api/v1/sessions/${sessionId}/video/start`).set("Authorization", authHeader);
    await backdateVideoStart(sessionId, 130000);
    await request(app).post(`/api/v1/sessions/${sessionId}/video/complete`).set("Authorization", authHeader);
    await backdateVideoCompleted(sessionId, 5000);
    await request(app)
      .post(`/api/v1/sessions/${sessionId}/quiz/attempt`)
      .set("Authorization", authHeader)
      .send({ answers: [0, 1, 0] });
    await backdateLastQuizAttempt(sessionId, 5000);

    await request(app).post(`/api/v1/sessions/${sessionId}/complete`).set("Authorization", authHeader);

    const after = await request(app)
      .get(`/api/v1/campaigns/${campaign._id}/completion`)
      .set("Authorization", authHeader);
    expect(after.body.hasCompletedByCurrentUser).toBe(true);

    // Replay: a second session for the same campaign completes but earns nothing
    const replayStart = await request(app)
      .post("/api/v1/sessions/start")
      .set("Authorization", authHeader)
      .send({ campaignId: String(campaign._id) });
    const replaySessionId = replayStart.body.session._id;

    for (const gameType of ALL_GAME_TYPES) {
      await request(app)
        .post(`/api/v1/sessions/${replaySessionId}/games/${gameType}/start`)
        .set("Authorization", authHeader);
      await backdateGameStage(replaySessionId, gameType, 5000);
      await request(app)
        .post(`/api/v1/sessions/${replaySessionId}/games/${gameType}/complete`)
        .set("Authorization", authHeader);
    }
    await request(app).post(`/api/v1/sessions/${replaySessionId}/video/start`).set("Authorization", authHeader);
    await backdateVideoStart(replaySessionId, 130000);
    await request(app).post(`/api/v1/sessions/${replaySessionId}/video/complete`).set("Authorization", authHeader);
    await backdateVideoCompleted(replaySessionId, 5000);
    await request(app)
      .post(`/api/v1/sessions/${replaySessionId}/quiz/attempt`)
      .set("Authorization", authHeader)
      .send({ answers: [0, 1, 0] });

    const replayComplete = await request(app)
      .post(`/api/v1/sessions/${replaySessionId}/complete`)
      .set("Authorization", authHeader);

    expect(replayComplete.status).toBe(200);
    expect(replayComplete.body.isFirstCompletion).toBe(false);
    expect(replayComplete.body.pointsAwarded).toBe(0);
  });
});
