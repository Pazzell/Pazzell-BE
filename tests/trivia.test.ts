import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import {
  api,
  createUser,
  createTopic,
  resetState,
  startTrivia,
  playSession,
  allKeys,
  TestUser,
} from "./helpers";
import TriviaAttemptQuestionModel from "../models/triviaAttemptQuestion.model";
import TriviaAttemptModel from "../models/triviaAttempt.model";
import TriviaCardModel from "../models/triviaCard.model";

const base = "/api/v1/trivia/sessions";
const question = (u: TestUser, id: string) => api().get(`${base}/${id}/question`).set(u.auth);
const answer = (u: TestUser, id: string, questionIndex: number, optionIndex: number) =>
  api().post(`${base}/${id}/answer`).set(u.auth).send({ questionIndex, optionIndex });
const correctPosition = async (id: string, quizIndex: number) => {
  const q = await TriviaAttemptQuestionModel.findOne({ attemptId: id, quizIndex }).lean();
  return q!.optionOrder.indexOf(q!.card.correctOptionIndex);
};

describe("Trivia (admin topics)", () => {
  let user: TestUser;
  let topicId: string;

  beforeAll(connectTestDB);
  beforeEach(async () => {
    user = await createUser();
    topicId = await createTopic(12);
  });
  afterEach(resetState);
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  const startDefault = (overrides: Record<string, any> = {}) =>
    startTrivia(user, { sourceType: "topic", sourceId: topicId, timerSeconds: 5, cardCount: 5, ...overrides });

  describe("settings", () => {
    it("exposes the single global timer range and card bounds", async () => {
      const res = await api().get("/api/v1/settings/game");
      expect(res.status).toBe(200);
      expect(res.body.settings.timer).toEqual({ minSeconds: 0, maxSeconds: 15, defaultSeconds: 5 });
      expect(res.body.settings.trivia).toEqual({ minCards: 5, maxCards: 30 });
      expect(res.body.settings.pro).toEqual({ amount: 1500, currency: "NGN", durationDays: 30 });
      expect(res.body.settings.campaign).toMatchObject({ amount: 15000, durationDays: 30, interruptionThreshold: 10 });
    });

    it.each([-1, 16, 3.5, "5"])("rejects timerSeconds=%p", async (timerSeconds) => {
      const res = await startDefault({ timerSeconds });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_TIMER");
    });

    it.each([0, 1, 15])("accepts timerSeconds=%p", async (timerSeconds) => {
      const res = await startDefault({ timerSeconds });
      expect(res.status).toBe(201);
      expect(res.body.session.timerSeconds).toBe(timerSeconds);
    });

    it("bounds the card count: minimum 5, maximum the cards available", async () => {
      expect((await startDefault({ cardCount: 4 })).body.code).toBe("INVALID_CARD_COUNT");
      expect((await startDefault({ cardCount: 13 })).body.code).toBe("INVALID_CARD_COUNT");
      const ok = await startDefault({ cardCount: 12 });
      expect(ok.status).toBe(201);
      expect(ok.body.session.cardCount).toBe(12);
    });

    it("allows all cards when a topic has fewer than 5", async () => {
      const small = await createTopic(3, "Small");
      const tooFew = await startTrivia(user, { sourceType: "topic", sourceId: small, timerSeconds: 5, cardCount: 2 });
      expect(tooFew.body.details).toMatchObject({ min: 3, max: 3 });
      const ok = await startTrivia(user, { sourceType: "topic", sourceId: small, timerSeconds: 5, cardCount: 3 });
      expect(ok.status).toBe(201);
    });
  });

  describe("replaying a practice", () => {
    const cardIds = async (id: string) =>
      (await TriviaAttemptQuestionModel.find({ attemptId: id }).sort({ quizIndex: 1 }).lean()).map((q) => q.cardId);
    const practise = async () => {
      const id = (await startDefault({ practice: true })).body.session.id;
      await playSession(user, id);
      return id;
    };

    it("Play Now brings back the practised cards, without the pointer", async () => {
      const practiceId = await practise();
      const real = await startDefault({ practice: false, replayOf: practiceId, cardCount: 12 });
      expect(real.status).toBe(201);
      expect(real.body.session).toMatchObject({ practice: false, replayOf: practiceId, cardCount: 5 });

      const realId = real.body.session.id;
      expect((await cardIds(realId)).sort()).toEqual((await cardIds(practiceId)).sort());
      expect((await question(user, realId)).body.question).not.toHaveProperty("correctOptionIndex");
    });

    it("keeps the practised set through Retry and Practise Again", async () => {
      const practiceId = await practise();
      const practised = (await cardIds(practiceId)).sort();

      const realId = (await startDefault({ replayOf: practiceId })).body.session.id;
      await playSession(user, realId);
      const retryId = (await startDefault({ replayOf: realId })).body.session.id;
      expect((await cardIds(retryId)).sort()).toEqual(practised);
      await playSession(user, retryId);

      const againId = (await startDefault({ practice: true, replayOf: retryId })).body.session.id;
      expect((await cardIds(againId)).sort()).toEqual(practised);
    });

    it("draws a fresh set when retrying a quiz that was not practised", async () => {
      const plainId = (await startDefault()).body.session.id;
      await playSession(user, plainId);
      const retry = await startDefault({ replayOf: plainId, cardCount: 12 });
      expect(retry.status).toBe(201);
      expect(retry.body.session).toMatchObject({ cardCount: 12, replayOf: null });
    });

    it("leaves out practised cards that were deleted since", async () => {
      const practiceId = await practise();
      const [gone, ...kept] = await cardIds(practiceId);
      await TriviaCardModel.deleteOne({ _id: gone });
      const real = await startDefault({ replayOf: practiceId });
      expect(real.body.session.cardCount).toBe(4);
      expect((await cardIds(real.body.session.id)).sort()).toEqual(kept.sort());
    });

    it("only replays the player's own session of the same trivia", async () => {
      const practiceId = await practise();
      const other = await createUser();
      const stranger = await startTrivia(other, {
        sourceType: "topic", sourceId: topicId, timerSeconds: 5, cardCount: 5, replayOf: practiceId,
      });
      expect(stranger.status).toBe(404);

      const elsewhere = await createTopic(12, "Elsewhere");
      const wrongTopic = await startTrivia(user, {
        sourceType: "topic", sourceId: elsewhere, timerSeconds: 5, cardCount: 5, replayOf: practiceId,
      });
      expect(wrongTopic.status).toBe(404);
      expect((await startDefault({ replayOf: "nope" })).body.code).toBe("INVALID_REPLAY");
    });
  });

  describe("practice mode", () => {
    it("starts straight in the quiz, with no study step", async () => {
      const started = await startDefault();
      const id = started.body.session.id;
      expect(started.body.session).toMatchObject({ status: "quiz", practice: false, currentIndex: 0 });
      expect((await question(user, id)).body.question.index).toBe(0);
      expect((await api().get(`${base}/${id}/study`).set(user.auth)).status).toBe(404);
      expect((await api().post(`${base}/${id}/quiz/begin`).set(user.auth)).status).toBe(404);
    });

    it("marks the correct option on every question when practice is on", async () => {
      const started = await startDefault({ practice: true });
      const id = started.body.session.id;
      expect(started.body.session.practice).toBe(true);

      for (let index = 0; index < 5; index++) {
        const q = await question(user, id);
        expect(q.body.question.correctOptionIndex).toBe(await correctPosition(id, index));
        // The options themselves are the same as without practice.
        expect(Object.keys(q.body.question.options[0]).sort()).toEqual(["index", "text"]);
        const res = await answer(user, id, index, q.body.question.correctOptionIndex);
        expect(res.body.outcome).toBe("correct");
      }
      const result = await api().get(`${base}/${id}/result`).set(user.auth);
      expect(result.body.result).toMatchObject({ correct: 5, total: 5 });
    });

    it("still scores a wrong pick or a timeout in practice", async () => {
      const started = await startDefault({ practice: true });
      const id = started.body.session.id;
      const first = await question(user, id);
      const wrong = await answer(user, id, 0, 1 - first.body.question.correctOptionIndex);
      expect(wrong.body.outcome).toBe("wrong");

      await question(user, id);
      await TriviaAttemptQuestionModel.updateOne({ attemptId: id, quizIndex: 1 }, { deadlineAt: new Date(Date.now() - 5000) });
      const late = await answer(user, id, 1, await correctPosition(id, 1));
      expect(late.body.outcome).toBe("timeout");
    });

    it("keeps the practice setting of a session that is resumed", async () => {
      const started = await startDefault({ practice: true });
      const resumed = await startDefault({ practice: false });
      expect(resumed.body.resumed).toBe(true);
      expect(resumed.body.session.id).toBe(started.body.session.id);
      expect(resumed.body.session.practice).toBe(true);
    });

    it("rejects a practice value that is not a boolean", async () => {
      const res = await startDefault({ practice: "yes" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_PRACTICE");
    });

    it("carries on a session that was left in the old study step", async () => {
      const started = await startDefault();
      const id = started.body.session.id;
      await TriviaAttemptModel.updateOne({ _id: id }, { status: "studying" });
      const q = await question(user, id);
      expect(q.status).toBe(200);
      expect((await TriviaAttemptModel.findById(id).lean())!.status).toBe("quiz");
    });
  });

  describe("quiz phase", () => {
    it("never leaks the answer before it is settled when practice is off", async () => {
      const started = await startDefault();
      const id = started.body.session.id;
      const q = await question(user, id);
      const state = await api().get(`${base}/${id}`).set(user.auth);

      for (const body of [started.body, q.body, state.body]) {
        const keys = allKeys(body);
        for (const leaked of ["correctOptionIndex", "isCorrect", "correct", "optionOrder", "cardId", "card"]) {
          expect(keys.has(leaked)).toBe(false);
        }
      }
      expect(q.body.question.options.map((o: any) => o.index)).toEqual([0, 1]);
      expect(Object.keys(q.body.question.options[0]).sort()).toEqual(["index", "text"]);
      expect(q.headers["cache-control"]).toBe("no-store");
    });

    it("does not reveal the answer through option order", async () => {
      // Across many sessions the correct option must land in both positions.
      const positions = new Set<number>();
      for (let i = 0; i < 6 && positions.size < 2; i++) {
        const player = await createUser();
        const s = await startTrivia(player, { sourceType: "topic", sourceId: topicId, timerSeconds: 5, cardCount: 12 });
        const rows = await TriviaAttemptQuestionModel.find({ attemptId: s.body.session.id }).lean();
        rows.forEach((r) => positions.add(r.optionOrder.indexOf(r.card.correctOptionIndex)));
      }
      expect(positions.size).toBe(2);
    });

    it("scores correct and wrong answers on the server and reports the total", async () => {
      const started = await startDefault();
      const id = started.body.session.id;
      const result = await playSession(user, id, (index) => index !== 2);
      expect(result).toMatchObject({ correct: 4, total: 5 });

      const fetched = await api().get(`${base}/${id}/result`).set(user.auth);
      expect(fetched.body.result).toMatchObject({ correct: 4, total: 5, source: { type: "topic", id: topicId } });
    });

    it("fails a question whose time ran out, exactly like a wrong answer", async () => {
      const started = await startDefault();
      const id = started.body.session.id;
      await question(user, id);
      await TriviaAttemptQuestionModel.updateOne({ attemptId: id, quizIndex: 0 }, { deadlineAt: new Date(Date.now() - 5000) });

      const late = await answer(user, id, 0, await correctPosition(id, 0));
      expect(late.body.outcome).toBe("timeout");
      expect(late.body.nextQuestionIndex).toBe(1);

      // No submission at all: the next read times the question out and moves on.
      await question(user, id);
      await TriviaAttemptQuestionModel.updateOne({ attemptId: id, quizIndex: 1 }, { deadlineAt: new Date(Date.now() - 5000) });
      const next = await question(user, id);
      expect(next.body.question.index).toBe(2);
      const attempt = await TriviaAttemptModel.findById(id).lean();
      expect(attempt!.correctCount).toBe(0);
    });

    it("has no clock when the timer is 0: a question waits for its answer", async () => {
      const started = await startDefault({ timerSeconds: 0 });
      const id = started.body.session.id;
      const served = await question(user, id);
      expect(served.body.question).toMatchObject({ timerSeconds: 0, deadlineAt: null, remainingMs: null });

      // Long after it was served, the question is still current and an answer still counts.
      await TriviaAttemptQuestionModel.updateOne({ attemptId: id, quizIndex: 0 }, { servedAt: new Date(Date.now() - 60 * 60 * 1000) });
      expect((await question(user, id)).body.question.index).toBe(0);
      const late = await answer(user, id, 0, await correctPosition(id, 0));
      expect(late.body.outcome).toBe("correct");
      expect(late.body.nextQuestionIndex).toBe(1);
    });

    it("ends a quiz early: the session is cancelled with no result", async () => {
      const started = await startDefault();
      const id = started.body.session.id;
      await question(user, id);
      await answer(user, id, 0, await correctPosition(id, 0));

      const ended = await api().post(`${base}/${id}/abandon`).set(user.auth);
      expect(ended.status).toBe(200);
      expect(ended.body.session.status).toBe("abandoned");
      expect((await question(user, id)).body.code).toBe("SESSION_ABANDONED");
      expect((await api().get(`${base}/${id}/result`).set(user.auth)).body.code).toBe("SESSION_ABANDONED");

      // The next start is a new session, not the ended one.
      const next = await startDefault();
      expect(next.status).toBe(201);
      expect(next.body.session.id).not.toBe(id);
    });

    it("resumes after a refresh at the same question with the remaining time", async () => {
      const started = await startDefault();
      const id = started.body.session.id;
      const first = await question(user, id);
      await new Promise((r) => setTimeout(r, 400));

      // "Refresh": start again, then ask for the current question again.
      const restarted = await startDefault({ cardCount: 12, timerSeconds: 7 });
      expect(restarted.status).toBe(200);
      expect(restarted.body.resumed).toBe(true);
      expect(restarted.body.session.id).toBe(id);
      expect(restarted.body.session.status).toBe("quiz");
      expect(restarted.body.session.timerSeconds).toBe(5);

      const again = await question(user, id);
      expect(again.body.question.index).toBe(first.body.question.index);
      expect(again.body.question.text).toBe(first.body.question.text);
      expect(again.body.question.deadlineAt).toBe(first.body.question.deadlineAt);
      expect(again.body.question.remainingMs).toBeLessThan(first.body.question.remainingMs);
      expect(await TriviaAttemptModel.countDocuments({ userId: user.id })).toBe(1);
    });

    it("is forward-only: no skipping ahead, no changing a submitted answer", async () => {
      const started = await startDefault();
      const id = started.body.session.id;

      const unserved = await answer(user, id, 0, 0);
      expect(unserved.body.code).toBe("QUESTION_NOT_SERVED");

      await question(user, id);
      const skip = await answer(user, id, 3, 0);
      expect(skip.status).toBe(409);
      expect(skip.body.code).toBe("NOT_CURRENT_QUESTION");

      const right = await correctPosition(id, 0);
      const first = await answer(user, id, 0, 1 - right);
      expect(first.body.outcome).toBe("wrong");
      const retry = await answer(user, id, 0, right);
      expect(retry.body.outcome).toBe("wrong"); // idempotent: the stored outcome stands
      const attempt = await TriviaAttemptModel.findById(id).lean();
      expect(attempt).toMatchObject({ currentIndex: 1, correctCount: 0 });

      const bad = await question(user, id).then(() => answer(user, id, 1, 5));
      expect(bad.body.code).toBe("INVALID_OPTION");
    });

    it("keeps an attempt intact when a card is edited or deleted mid-session", async () => {
      const started = await startDefault({ cardCount: 12 });
      const id = started.body.session.id;
      await TriviaCardModel.updateMany({ topicId }, { $set: { text: "Edited", correctOptionIndex: 1 } });
      await TriviaCardModel.deleteOne({ topicId });

      const result = await playSession(user, id);
      expect(result).toMatchObject({ correct: 12, total: 12 });
    });

    it("gives a new random card set on retry once the session is finished", async () => {
      const first = await startDefault();
      await playSession(user, first.body.session.id);
      const second = await startDefault();
      expect(second.status).toBe(201);
      expect(second.body.session.id).not.toBe(first.body.session.id);
    });
  });

  describe("authorization", () => {
    it("requires login and hides other players' sessions", async () => {
      const other = await createUser();
      const started = await startDefault();
      const id = started.body.session.id;

      expect((await api().post(base).send({ sourceType: "topic", sourceId: topicId })).status).toBe(401);
      expect((await api().get("/api/v1/trivia/topics")).status).toBe(401);
      expect((await api().get(`${base}/${id}`).set(other.auth)).status).toBe(404);
      expect((await api().get(`${base}/${id}/question`).set(other.auth)).status).toBe(404);
      expect((await api().get(`${base}/${id}/result`).set(other.auth)).status).toBe(404);
    });

    it("lets only admins manage topics and cards", async () => {
      const admin = await createUser({ role: "admin" });
      const brand = await createUser({ role: "brand" });
      const topicBody = { name: "Music", description: "Songs and artists" };

      for (const actor of [user, brand]) {
        expect((await api().post("/api/v1/admin/trivia/topics").set(actor.auth).send(topicBody)).status).toBe(403);
        expect((await api().get("/api/v1/admin/trivia/topics").set(actor.auth)).status).toBe(403);
      }

      const created = await api().post("/api/v1/admin/trivia/topics").set(admin.auth).send(topicBody);
      expect(created.status).toBe(201);
      const id = created.body.topic.id;

      const bulk = await api()
        .post(`/api/v1/admin/trivia/topics/${id}/cards/bulk`)
        .set(admin.auth)
        .send({
          cards: Array.from({ length: 6 }, (_, i) => ({
            type: "definition",
            text: `Fact ${i}`,
            options: ["Yes", "No"],
            correctOptionIndex: i % 2,
          })),
        });
      expect(bulk.status).toBe(201);
      expect(bulk.body.created).toBe(6);

      const invalid = await api()
        .post(`/api/v1/admin/trivia/topics/${id}/cards`)
        .set(admin.auth)
        .send({ type: "definition", text: "Three options", options: ["a", "b", "c"], correctOptionIndex: 0 });
      expect(invalid.status).toBe(400);
      expect(invalid.body.code).toBe("INVALID_CARD");

      const noCorrect = await api()
        .post(`/api/v1/admin/trivia/topics/${id}/cards`)
        .set(admin.auth)
        .send({ type: "definition", text: "No answer", options: ["a", "b"] });
      expect(noCorrect.status).toBe(400);

      const preview = await api().get(`/api/v1/admin/trivia/topics/${id}`).set(admin.auth);
      expect(preview.body.cards).toHaveLength(6);
      expect(preview.body.cards[0]).toHaveProperty("correctOptionIndex");

      const listed = await api().get("/api/v1/trivia/topics").set(user.auth);
      const music = listed.body.topics.find((t: any) => t.id === id);
      expect(music).toMatchObject({ name: "Music", cardCount: 6, cardCountBounds: { min: 5, max: 6 } });
      expect(allKeys(listed.body).has("correctOptionIndex")).toBe(false);
    });
  });

  describe("a topic's own picture share", () => {
    const adminTopics = "/api/v1/admin/trivia/topics";
    const typesServed = async (player: TestUser, id: string) => {
      const started = await startTrivia(player, { sourceType: "topic", sourceId: id, timerSeconds: 5, cardCount: 10 });
      const rows = await TriviaAttemptQuestionModel.find({ attemptId: started.body.session.id }).lean();
      await api().post(`${base}/${started.body.session.id}/abandon`).set(player.auth);
      return rows.map((r) => r.card.type);
    };

    it("replaces the global mix for that topic, and can be handed back to it", async () => {
      const admin = await createUser({ role: "admin" });
      const id = await createTopic(12, "Tech");
      await TriviaCardModel.insertMany(
        Array.from({ length: 12 }, (_, n) => ({
          topicId: id,
          type: "image",
          imageUrl: `https://storage.pazzell.test/pazzell/cards/${n}.webp`,
          text: "What is this?",
          options: [`Right ${n}`, `Wrong ${n}`],
          correctOptionIndex: 0,
        }))
      );
      const patch = (imagePercent: any) =>
        api().patch(`${adminTopics}/${id}`).set(admin.auth).send({ imagePercent });
      const images = (types: string[]) => types.filter((t) => t === "image").length;

      // Global setting: 70% of 10.
      expect(images(await typesServed(user, id))).toBe(7);

      expect((await patch(0)).body.topic.imagePercent).toBe(0);
      expect(images(await typesServed(user, id))).toBe(0);
      expect((await patch("100")).body.topic.imagePercent).toBe(100);
      expect(images(await typesServed(user, id))).toBe(10);
      expect((await patch(30)).body.topic.imagePercent).toBe(30);
      expect(images(await typesServed(user, id))).toBe(3);

      // Another edit leaves it alone; an empty value returns the topic to the default.
      const renamed = await api().patch(`${adminTopics}/${id}`).set(admin.auth).send({ description: "Logos" });
      expect(renamed.body.topic.imagePercent).toBe(30);
      expect((await patch("")).body.topic.imagePercent).toBeNull();
      expect(images(await typesServed(user, id))).toBe(7);

      for (const bad of [-1, 101, 2.5, "lots"]) {
        const res = await patch(bad);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("INVALID_IMAGE_PERCENT");
      }
    });

    it("lets the player choose the share, over the topic's and the global one", async () => {
      const admin = await createUser({ role: "admin" });
      const id = await createTopic(12, "Mixed");
      await TriviaCardModel.insertMany(
        Array.from({ length: 8 }, (_, n) => ({
          topicId: id,
          type: "image",
          imageUrl: `https://storage.pazzell.test/pazzell/cards/m${n}.webp`,
          text: "What is this?",
          options: [`Right ${n}`, `Wrong ${n}`],
          correctOptionIndex: 0,
        }))
      );
      const start = (imagePercent?: any) =>
        startTrivia(user, { sourceType: "topic", sourceId: id, timerSeconds: 5, cardCount: 10, imagePercent });
      const imagesServed = async (sessionId: string) => {
        const rows = await TriviaAttemptQuestionModel.find({ attemptId: sessionId }).lean();
        await api().post(`${base}/${sessionId}/abandon`).set(user.auth);
        return rows.filter((r) => r.card.type === "image").length;
      };

      // What the setup screen needs to offer the choice.
      const listed = await api().get("/api/v1/trivia/topics").set(user.auth);
      expect(listed.body.topics.find((t: any) => t.id === id).cardMix).toEqual({
        imageCards: 8,
        definitionCards: 12,
        defaultImagePercent: 70,
      });
      await api().patch(`${adminTopics}/${id}`).set(admin.auth).send({ imagePercent: 20 });
      const one = await api().get(`/api/v1/trivia/topics/${id}`).set(user.auth);
      expect(one.body.topic.cardMix.defaultImagePercent).toBe(20);

      const none = await start(0);
      expect(none.body.session.imagePercent).toBe(0);
      expect(await imagesServed(none.body.session.id)).toBe(0);
      const half = await start(50);
      expect(await imagesServed(half.body.session.id)).toBe(5);
      // 100% of 10 is more pictures than the topic has: definitions fill the gap.
      const all = await start(100);
      expect(await imagesServed(all.body.session.id)).toBe(8);
      // Nothing chosen: the topic's own 20%.
      const unset = await start();
      expect(unset.body.session.imagePercent).toBeNull();
      expect(await imagesServed(unset.body.session.id)).toBe(2);

      for (const bad of [-10, 101, 33.3, "50"]) {
        const res = await start(bad);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("INVALID_IMAGE_PERCENT");
      }
    });

    it("can be set when the topic is created", async () => {
      const admin = await createUser({ role: "admin" });
      const made = await api().post(adminTopics).set(admin.auth).send({ name: "Coding", imagePercent: 20 });
      expect(made.body.topic.imagePercent).toBe(20);
      const plain = await api().post(adminTopics).set(admin.auth).send({ name: "History" });
      expect(plain.body.topic.imagePercent).toBeNull();
    });
  });

  describe("topic lists", () => {
    it("lists topics alphabetically, ignoring case", async () => {
      const admin = await createUser({ role: "admin" });
      await createTopic(3, "Zoology");
      await createTopic(3, "biology");
      await createTopic(3, "Art");
      const expected = ["Art", "biology", "General", "Zoology"];

      const listed = await api().get("/api/v1/trivia/topics").set(user.auth);
      expect(listed.body.topics.map((t: any) => t.name)).toEqual(expected);
      const managed = await api().get("/api/v1/admin/trivia/topics").set(admin.auth);
      expect(managed.body.topics.map((t: any) => t.name)).toEqual(expected);
    });
  });
});
