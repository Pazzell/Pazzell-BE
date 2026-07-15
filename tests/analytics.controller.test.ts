import request from "supertest";
import { app } from "../app";
import { connectTestDB, clearTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import GameSessionModel from "../models/gameSession.model";

/** Minimal GameSession doc — only the fields getAppAnalytics cares about
 * (status, startedAt, completedAt) need to be meaningful. */
function makeSession(overrides: Partial<any> = {}) {
  return GameSessionModel.create({
    userId: "user-1",
    campaignId: "campaign-1",
    status: "in_progress",
    startedAt: new Date(),
    games: [],
    video: {},
    quiz: { firstAttempt: null, attempts: [] },
    pointsAwarded: 0,
    raffleTicketAwarded: false,
    anticheat: { flagged: false, flaggedReasons: [], voided: false },
    ...overrides,
  });
}

describe("GET /api/v1/analytics/app — live stats", () => {
  beforeAll(async () => {
    await connectTestDB();
  });
  afterEach(async () => {
    await clearTestDB();
  });
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  it("does not count a session the instant it's started (no completedAt yet)", async () => {
    await makeSession({ status: "in_progress", startedAt: new Date() });

    const res = await request(app).get("/api/v1/analytics/app");
    expect(res.status).toBe(200);
    expect(res.body.analytics.totalGamesPlayed).toBe(0);
    expect(res.body.analytics.gamesPlayedToday).toBe(0);
  });

  it("counts a session only once it's been submitted (status completed, completedAt set)", async () => {
    const now = new Date();
    await makeSession({ status: "completed", startedAt: now, completedAt: now });

    const res = await request(app).get("/api/v1/analytics/app");
    expect(res.body.analytics.totalGamesPlayed).toBe(1);
    expect(res.body.analytics.gamesPlayedToday).toBe(1);
  });

  it("excludes abandoned and voided sessions from both counters", async () => {
    const now = new Date();
    await makeSession({ status: "abandoned", startedAt: now });
    await makeSession({ status: "voided", startedAt: now, completedAt: now });

    const res = await request(app).get("/api/v1/analytics/app");
    expect(res.body.analytics.totalGamesPlayed).toBe(0);
    expect(res.body.analytics.gamesPlayedToday).toBe(0);
  });

  it("excludes a session completed on a previous day from 'today', but still counts it in the total", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await makeSession({ status: "completed", startedAt: yesterday, completedAt: yesterday });

    const res = await request(app).get("/api/v1/analytics/app");
    expect(res.body.analytics.totalGamesPlayed).toBe(1);
    expect(res.body.analytics.gamesPlayedToday).toBe(0);
  });
});
