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
const begin = (u: TestUser, id: string) => api().post(`${base}/${id}/quiz/begin`).set(u.auth);
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
      expect(res.body.settings.timer).toEqual({ minSeconds: 1, maxSeconds: 7, matchDefaultSeconds: 5 });
      expect(res.body.settings.trivia).toEqual({ minCards: 5, maxCards: 30 });
      expect(res.body.settings.pro).toEqual({ amount: 1330.21, currency: "NGN", durationDays: 30 });
      expect(res.body.settings.campaign).toMatchObject({ amount: 13302.07, durationDays: 30, interruptionThreshold: 10 });
    });

    it.each([0, 8, 3.5, "5"])("rejects timerSeconds=%p", async (timerSeconds) => {
      const res = await startDefault({ timerSeconds });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_TIMER");
    });

    it.each([1, 7])("accepts timerSeconds=%p", async (timerSeconds) => {
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

  describe("study phase", () => {
    it("returns the selected cards in a stable order with the correct option marked", async () => {
      const started = await startDefault();
      const id = started.body.session.id;
      const first = await api().get(`${base}/${id}/study`).set(user.auth);
      const second = await api().get(`${base}/${id}/study`).set(user.auth);

      expect(first.body.cards).toHaveLength(5);
      expect(first.body.cards.map((c: any) => c.position)).toEqual([1, 2, 3, 4, 5]);
      expect(second.body.cards).toEqual(first.body.cards);
      for (const card of first.body.cards) {
        expect(card.options).toHaveLength(2);
        expect(card.options.filter((o: any) => o.isCorrect)).toHaveLength(1);
      }
    });

    it("stops serving study cards once the quiz has begun", async () => {
      const started = await startDefault();
      const id = started.body.session.id;
      expect((await question(user, id)).body.code).toBe("QUIZ_NOT_STARTED");
      await begin(user, id);
      const study = await api().get(`${base}/${id}/study`).set(user.auth);
      expect(study.status).toBe(409);
      expect(study.body.code).toBe("STUDY_PHASE_OVER");
    });
  });

  describe("quiz phase", () => {
    it("never leaks the answer in any quiz-phase response before it is settled", async () => {
      const started = await startDefault();
      const id = started.body.session.id;
      const begun = await begin(user, id);
      const q = await question(user, id);
      const state = await api().get(`${base}/${id}`).set(user.auth);

      for (const body of [started.body, begun.body, q.body, state.body]) {
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
      await begin(user, id);
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

    it("resumes after a refresh at the same question with the remaining time", async () => {
      const started = await startDefault();
      const id = started.body.session.id;
      await begin(user, id);
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
      await begin(user, id);

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
      expect((await api().get(`${base}/${id}/study`).set(other.auth)).status).toBe(404);
      expect((await begin(other, id)).status).toBe(404);
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
});
