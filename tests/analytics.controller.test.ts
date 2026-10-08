import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import { api, resetState } from "./helpers";
import MatchAttemptModel from "../models/matchAttempt.model";
import TriviaAttemptModel from "../models/triviaAttempt.model";

const trivia = (overrides: Record<string, any> = {}) =>
  TriviaAttemptModel.create({
    userId: `user-${Math.random()}`,
    sourceType: "topic",
    sourceId: "t1",
    sourceKey: "topic:t1",
    timerSeconds: 5,
    cardCount: 5,
    ...overrides,
  });
const done = (at: Date) => ({ status: "completed", active: false, completedAt: at });

describe("GET /api/v1/analytics/app — live stats", () => {
  beforeAll(connectTestDB);
  afterEach(resetState);
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  it("does not count a game that is only started or was abandoned", async () => {
    await trivia();
    await trivia({ status: "abandoned", active: false, completedAt: new Date() });
    await MatchAttemptModel.create({ userId: "u1", level: 1, timerSeconds: 5, questionCount: 3 });

    const res = await api().get("/api/v1/analytics/app");
    expect(res.status).toBe(200);
    expect(res.body.analytics).toMatchObject({ totalGamesPlayed: 0, gamesPlayedToday: 0 });
  });

  it("counts finished Match attempts and trivia sessions, but not owner test plays", async () => {
    const now = new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await trivia(done(now));
    await trivia(done(yesterday));
    await trivia({ ...done(now), isPreview: true });
    await MatchAttemptModel.create({ userId: "u1", level: 1, timerSeconds: 5, questionCount: 3, ...done(now) });

    const res = await api().get("/api/v1/analytics/app");
    expect(res.body.analytics.totalGamesPlayed).toBe(3);
    expect(res.body.analytics.gamesPlayedToday).toBe(2);
  });
});
