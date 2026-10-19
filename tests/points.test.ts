import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import { api, createUser, createTopic, resetState, startTrivia, playSession, TestUser } from "./helpers";
import userModel from "../models/user.model";
import TriviaAttemptModel from "../models/triviaAttempt.model";
import {
  awardQuizPoint,
  cardSetKey,
  dayKey,
  monthKey,
  pointsAt,
  rollOverMonthlyPoints,
} from "../services/points/points.service";
import { runMonthlyPointsRollover } from "../services/scheduler";

const storedPoints = async (id: string) => (await userModel.findById(id).lean())!.points;

describe("Player points", () => {
  let user: TestUser;
  let admin: TestUser;
  let topicId: string;

  beforeAll(connectTestDB);
  beforeEach(async () => {
    user = await createUser();
    admin = await createUser({ role: "admin" });
    topicId = await createTopic(30);
  });
  afterEach(resetState);
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  const setRule = (key: string, value: any) =>
    api().put(`/api/v1/admin/config/points.${key}`).set(admin.auth).send({ value });

  const start = async (overrides: Record<string, any> = {}) => {
    const res = await startTrivia(user, {
      sourceType: "topic",
      sourceId: topicId,
      timerSeconds: 5,
      cardCount: 20,
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body.session.id as string;
  };
  const play = async (overrides: Record<string, any> = {}, pick?: (i: number) => boolean) =>
    playSession(user, await start(overrides), pick);

  describe("earning with the default rules", () => {
    it("gives 1 point for a quiz of 20 cards with every question right", async () => {
      const result = await play();
      expect(result).toMatchObject({ pointEarned: true, noPointReason: null });
      expect(result.points).toEqual({ month: monthKey(), monthly: 1, lifetime: 1, today: 1, dailyCap: 5 });

      await play();
      expect(await storedPoints(user.id)).toMatchObject({ monthly: 2, lifetime: 2, today: 2 });
    });

    it("gives nothing when a question is wrong", async () => {
      const result = await play({}, (i) => i !== 3);
      expect(result).toMatchObject({ pointEarned: false, noPointReason: "score_too_low" });
      expect(result.points.monthly).toBe(0);
    });

    it("gives nothing for fewer than 20 cards", async () => {
      const result = await play({ cardCount: 19 });
      expect(result).toMatchObject({ pointEarned: false, noPointReason: "too_few_cards" });
    });

    it("gives nothing for a practice session, which shows the answers", async () => {
      const result = await play({ practice: true });
      expect(result).toMatchObject({ pointEarned: false, noPointReason: "practice" });
    });

    it("rewards recalling a practised set with Play Now, but not playing it again", async () => {
      const practiceId = await start({ practice: true });
      await playSession(user, practiceId);

      // Play Now: the practised cards again, in a new order, all recalled
      const playNowId = await start({ replayOf: practiceId });
      expect(await playSession(user, playNowId)).toMatchObject({ pointEarned: true, noPointReason: null });

      // Play again: the same set has already earned
      const againId = await start({ replayOf: playNowId });
      expect(await playSession(user, againId)).toMatchObject({
        pointEarned: false,
        noPointReason: "set_already_earned",
      });

      // A plain quiz draws a different set, which can earn
      expect((await play()).pointEarned).toBe(true);
      expect((await storedPoints(user.id)).monthly).toBe(2);
    });

    it("lets a practised set earn after a missed run", async () => {
      const practiceId = await start({ practice: true });
      await playSession(user, practiceId);

      const missedId = await start({ replayOf: practiceId });
      expect(await playSession(user, missedId, (i) => i !== 0)).toMatchObject({ noPointReason: "score_too_low" });

      const retryId = await start({ replayOf: missedId });
      expect((await playSession(user, retryId)).pointEarned).toBe(true);
    });

    it("recognises a set in any order", () => {
      expect(cardSetKey("topic:t", ["a", "b", "c"])).toBe(cardSetKey("topic:t", ["c", "a", "b"]));
      expect(cardSetKey("topic:t", ["a", "b", "c"])).not.toBe(cardSetKey("topic:t", ["a", "b", "d"]));
    });

    it("stops at 5 points a day", async () => {
      await userModel.updateOne({ _id: user.id }, { points: { month: monthKey(), monthly: 7, lifetime: 9, day: dayKey(), today: 5 } });
      const result = await play();
      expect(result).toMatchObject({ pointEarned: false, noPointReason: "daily_cap" });
      expect(result.points).toMatchObject({ monthly: 7, lifetime: 9, today: 5 });
    });

    it("counts a completed session once, however often its result is read", async () => {
      const result = await play();
      for (let i = 0; i < 3; i++) {
        const res = await api().get(`/api/v1/trivia/sessions/${result.sessionId}/result`).set(user.auth);
        expect(res.body.result).toMatchObject({ pointEarned: true, points: { monthly: 1 } });
      }
      expect((await storedPoints(user.id)).monthly).toBe(1);
      expect((await TriviaAttemptModel.findById(result.sessionId).lean())!.pointAwarded).toBe(true);
    });

    it("shows the points on /me and the gamer profile", async () => {
      await play();
      const expected = { month: monthKey(), monthly: 1, lifetime: 1, today: 1, dailyCap: 5 };
      expect((await api().get("/api/v1/me").set(user.auth)).body.points).toEqual(expected);
      expect((await api().get("/api/v1/profile/gamer").set(user.auth)).body.profile.points).toEqual(expected);
    });
  });

  describe("rules set by an admin", () => {
    it("publishes the rules in the game settings", async () => {
      const res = await api().get("/api/v1/settings/game");
      expect(res.body.settings.points).toEqual({
        minCards: 20, minScorePercent: 100, dailyCap: 5, practiceEarns: false, setEarnsOnce: true,
      });
      expect((await setRule("minCards", 10)).status).toBe(200);
      expect((await api().get("/api/v1/settings/game")).body.settings.points.minCards).toBe(10);
    });

    it("rejects invalid values and non-admins", async () => {
      expect((await setRule("minCards", 0)).status).toBe(400);
      expect((await setRule("minScorePercent", 101)).status).toBe(400);
      expect((await setRule("dailyCap", 2.5)).status).toBe(400);
      expect((await setRule("practiceEarns", "yes")).status).toBe(400);
      const asPlayer = await api().put("/api/v1/admin/config/points.dailyCap").set(user.auth).send({ value: 50 });
      expect(asPlayer.status).toBe(403);
    });

    it("uses the minimum card count", async () => {
      await setRule("minCards", 5);
      expect((await play({ cardCount: 5 })).pointEarned).toBe(true);
    });

    it("uses the minimum score", async () => {
      await setRule("minScorePercent", 90);
      // 18 of 20 is 90%
      expect((await play({}, (i) => i >= 2)).pointEarned).toBe(true);
      expect((await play({}, (i) => i >= 3)).noPointReason).toBe("score_too_low");
    });

    it("uses the daily cap", async () => {
      await setRule("dailyCap", 1);
      expect((await play()).pointEarned).toBe(true);
      const second = await play();
      expect(second).toMatchObject({ noPointReason: "daily_cap", points: { today: 1, dailyCap: 1 } });
    });

    it("can let practice sessions earn", async () => {
      await setRule("practiceEarns", true);
      expect((await play({ practice: true })).pointEarned).toBe(true);
    });

    it("can let a set earn every time", async () => {
      await setRule("setEarnsOnce", false);
      const firstId = await start({ practice: true });
      await playSession(user, firstId);
      const playNowId = await start({ replayOf: firstId });
      expect((await playSession(user, playNowId)).pointEarned).toBe(true);
      const againId = await start({ replayOf: playNowId });
      expect((await playSession(user, againId)).pointEarned).toBe(true);
    });
  });

  describe("days and months (Lagos time)", () => {
    // 23:30 UTC on 31 October is already 00:30 on 1 November in Lagos.
    const lateOctober = new Date("2026-10-31T22:30:00Z");
    const novemberInLagos = new Date("2026-10-31T23:30:00Z");

    it("uses Lagos dates", () => {
      expect(dayKey(lateOctober)).toBe("2026-10-31");
      expect(dayKey(novemberInLagos)).toBe("2026-11-01");
      expect(monthKey(novemberInLagos)).toBe("2026-11");
    });

    it("caps points a day and starts a new day's count at midnight", async () => {
      const awarded = [];
      for (let i = 0; i < 6; i++) awarded.push(await awardQuizPoint(user.id, 5, lateOctober));
      expect(awarded).toEqual([true, true, true, true, true, false]);
      expect(await awardQuizPoint(user.id, 5, novemberInLagos)).toBe(true);
      expect(await storedPoints(user.id)).toEqual({
        month: "2026-11", monthly: 1, lifetime: 6, day: "2026-11-01", today: 1,
      });
    });

    it("starts the monthly score again from 0 and keeps it in the lifetime score", async () => {
      await userModel.updateOne({ _id: user.id }, { points: { month: "2026-10", monthly: 4, lifetime: 14, day: "2026-10-31", today: 2 } });
      const other = await createUser();
      await userModel.updateOne({ _id: other.id }, { points: { month: "2026-11", monthly: 2, lifetime: 2, day: "2026-11-01", today: 2 } });

      expect(await rollOverMonthlyPoints(novemberInLagos)).toBe(1);
      expect(await storedPoints(user.id)).toMatchObject({ month: "2026-11", monthly: 0, lifetime: 14 });
      expect(await storedPoints(other.id)).toMatchObject({ month: "2026-11", monthly: 2, lifetime: 2 });

      // A second run in the same month changes nothing.
      expect(await rollOverMonthlyPoints(novemberInLagos)).toBe(0);
    });

    it("reads an ended month or day as 0", () => {
      const stored = { points: { month: "2026-10", monthly: 3, lifetime: 8, day: "2026-10-31", today: 2 } };
      expect(pointsAt(stored, 5, lateOctober)).toEqual({ month: "2026-10", monthly: 3, lifetime: 8, today: 2, dailyCap: 5 });
      expect(pointsAt(stored, 5, novemberInLagos)).toEqual({ month: "2026-11", monthly: 0, lifetime: 8, today: 0, dailyCap: 5 });
      expect(pointsAt({}, 5, novemberInLagos)).toEqual({ month: "2026-11", monthly: 0, lifetime: 0, today: 0, dailyCap: 5 });
    });

    it("runs from the scheduler", async () => {
      await userModel.updateOne({ _id: user.id }, { points: { month: "2000-01", monthly: 3, lifetime: 4 } });
      await runMonthlyPointsRollover();
      expect(await storedPoints(user.id)).toMatchObject({ month: monthKey(), monthly: 0, lifetime: 4 });
    });
  });
});
