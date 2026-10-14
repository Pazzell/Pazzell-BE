import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection, redis } from "../utils/redis";
import {
  api,
  createTopic,
  createUser,
  playSession,
  resetState,
  startTrivia,
  DAY_MS,
  TestUser,
} from "./helpers";
import userModel from "../models/user.model";
import CustomQuizModel from "../models/customQuiz.model";
import CustomQuizCardModel from "../models/customQuizCard.model";
import TriviaTopicModel from "../models/triviaTopic.model";
import TriviaCardModel from "../models/triviaCard.model";
import { setConfigValue } from "../services/config/config.service";
import * as claude from "../services/quizGen/claude";

const base = "/api/v1/ai-trivia";
const adminBase = "/api/v1/admin/trivia/ai";
const PROMPT = "Hard questions about the emperors of the first century";

const candidate = (i: number): claude.TopicCardCandidate => ({
  statement: `Question ${i}?`,
  correctAnswer: `Right ${i}`,
  wrongAnswer: `Wrong ${i}`,
});
/** The option a perfect checker picks for each question. */
const rightOption = (questions: { options: string[] }[]) =>
  questions.map((q) => q.options.findIndex((o) => o.startsWith("Right")));

describe("AI generated trivia", () => {
  let configured: jest.SpyInstance;
  let requestTopicCards: jest.SpyInstance;
  let answerCards: jest.SpyInstance;

  beforeAll(connectTestDB);
  beforeEach(() => {
    configured = jest.spyOn(claude, "isAiConfigured").mockReturnValue(true);
    requestTopicCards = jest
      .spyOn(claude, "requestTopicCards")
      .mockImplementation(async (_topic, _prompt, count) => ({
        title: "Emperors of Rome",
        cards: Array.from({ length: count }, (_, i) => candidate(i)),
      }));
    answerCards = jest
      .spyOn(claude, "answerCards")
      .mockImplementation(async (_topic, questions) => rightOption(questions));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await redis.flushall();
    await resetState();
  });
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  const proUser = () => createUser({ proUntil: new Date(Date.now() + DAY_MS) });
  const generate = (user: TestUser, body: Record<string, any> = {}) =>
    api()
      .post(base)
      .set(user.auth)
      .send({ topicName: "Roman emperors", prompt: PROMPT, count: 5, ...body });
  const expire = (user: TestUser) =>
    userModel.updateOne({ _id: user.id }, { proUntil: new Date(Date.now() - 1000) });

  describe("writing one", () => {
    it("requires login", async () => {
      expect((await api().post(base).send({ topicName: "x", prompt: "y" })).status).toBe(401);
      expect((await api().get(base)).status).toBe(401);
      expect((await api().get(`${base}/options`)).status).toBe(401);
      expect(requestTopicCards).not.toHaveBeenCalled();
    });

    it("is for Pro players only", async () => {
      const free = await createUser();
      const res = await generate(free);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("UPGRADE_REQUIRED");
      expect(res.body.details).toMatchObject({ feature: "ai_trivia", pro: { amount: 1500 } });
      expect(requestTopicCards).not.toHaveBeenCalled();
      expect(await CustomQuizModel.countDocuments()).toBe(0);

      const options = (await api().get(`${base}/options`).set(free.auth)).body.options;
      expect(options).toMatchObject({ enabled: true, isPro: false, pro: { amount: 1500 } });
    });

    it("writes, checks and stores the trivia for a Pro player", async () => {
      const pro = await proUser();
      const res = await generate(pro);
      expect(res.status).toBe(201);
      expect(res.body.requested).toBe(5);
      expect(res.body.trivia).toMatchObject({
        title: "Emperors of Rome",
        topic: { id: null, name: "Roman emperors" },
        prompt: PROMPT,
        reviewStatus: "pending",
        inGeneralTrivia: false,
        cardCount: 5,
        cardCountBounds: { available: 5, min: 5, max: 5 },
      });
      expect(res.body.usage).toMatchObject({ dailyLimit: 10, usedToday: 1, remaining: 9 });
      // The player is about to play it: no card, and so no answer, comes back.
      expect(res.body).not.toHaveProperty("cards");

      // The model was asked for a few spare cards, and every card was answered blind.
      expect(requestTopicCards).toHaveBeenCalledWith("Roman emperors", PROMPT, 7, []);
      expect(answerCards.mock.calls[0][1]).toHaveLength(7);
      expect(answerCards.mock.calls[0][1][0]).toEqual({
        statement: "Question 0?",
        options: expect.arrayContaining(["Right 0", "Wrong 0"]),
      });

      const cards = await CustomQuizCardModel.find({ quizId: res.body.trivia.id }).lean();
      expect(cards).toHaveLength(5);
      for (const card of cards) {
        expect(card.type).toBe("definition");
        expect(card.options[card.correctOptionIndex]).toMatch(/^Right/);
      }
    });

    it("keeps only the cards the blind check agrees with", async () => {
      answerCards.mockImplementation(async (_topic, questions) => {
        const picked: (number | null)[] = rightOption(questions);
        picked[0] = 1 - (picked[0] as number); // the checker picks the other option
        picked[1] = null; // the checker is not sure
        return picked;
      });
      const pro = await proUser();
      const res = await generate(pro);
      expect(res.status).toBe(201);
      const texts = (await CustomQuizCardModel.find({ quizId: res.body.trivia.id }).lean()).map(
        (c) => c.text
      );
      expect(texts.sort()).toEqual(["Question 2?", "Question 3?", "Question 4?", "Question 5?", "Question 6?"]);
    });

    it("drops malformed and repeated cards before the check", async () => {
      requestTopicCards.mockResolvedValue({
        cards: [
          candidate(0),
          { ...candidate(1), statement: "QUESTION 0?" }, // the same question again
          { ...candidate(2), wrongAnswer: "right 2" }, // both options the same
          { ...candidate(3), correctAnswer: "x".repeat(81) }, // option too long
          candidate(4),
        ],
      });
      const pro = await proUser();
      const res = await generate(pro);
      expect(res.status).toBe(201);
      expect(res.body.trivia.cardCount).toBe(2);
      // No title from the model: the topic names the set.
      expect(res.body.trivia.title).toBe("Roman emperors");
      expect(answerCards.mock.calls[0][1]).toHaveLength(2);
    });

    it("uses a selected topic and does not repeat its questions", async () => {
      const topicId = await createTopic(2, "History");
      await TriviaCardModel.create({
        topicId,
        type: "definition",
        text: "Question 0?",
        options: ["A", "B"],
        correctOptionIndex: 0,
      });
      const pro = await proUser();
      const res = await generate(pro, { topicId, topicName: undefined });
      expect(res.status).toBe(201);
      expect(res.body.trivia.topic).toEqual({ id: topicId, name: "History" });
      const avoid = requestTopicCards.mock.calls[0][3];
      expect(avoid).toEqual(expect.arrayContaining(["Question 0?", "Statement number 0"]));
      const texts = (await CustomQuizCardModel.find({ quizId: res.body.trivia.id }).lean()).map(
        (c) => c.text
      );
      expect(texts).not.toContain("Question 0?");
      expect(texts).toHaveLength(5);

      // A typed name that is an existing topic is linked to it, whatever the case.
      const typed = await generate(pro, { topicName: "  history " });
      expect(typed.body.trivia.topic).toEqual({ id: topicId, name: "History" });

      const options = (await api().get(`${base}/options`).set(pro.auth)).body.options;
      expect(options.topics).toEqual([{ id: topicId, name: "History" }]);
      expect(options).toMatchObject({
        isPro: true,
        pro: null,
        topicMaxLength: 60,
        promptMaxLength: 500,
        count: { default: 10, min: 5, max: 30 },
        usedToday: 2,
      });
    });

    it("validates the request before calling the model", async () => {
      const pro = await proUser();
      const noTopic = await generate(pro, { topicName: "  " });
      expect(noTopic.status).toBe(400);
      expect(noTopic.body.code).toBe("TOPIC_REQUIRED");
      expect((await generate(pro, { topicName: "x".repeat(61) })).status).toBe(400);
      const unknown = await generate(pro, { topicId: "64b000000000000000000000" });
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe("TOPIC_NOT_FOUND");
      expect((await generate(pro, { prompt: "" })).body.code).toBe("PROMPT_REQUIRED");
      expect((await generate(pro, { prompt: "y".repeat(501) })).status).toBe(400);
      for (const count of [4, 31, "abc", 7.5]) {
        expect((await generate(pro, { count })).body.code).toBe("INVALID_CARD_COUNT");
      }
      expect(requestTopicCards).not.toHaveBeenCalled();
      const options = (await api().get(`${base}/options`).set(pro.auth)).body.options;
      expect(options.usedToday).toBe(0); // rejected requests cost nothing
    });

    it("answers AI_NOT_CONFIGURED when there is no API key", async () => {
      configured.mockReturnValue(false);
      const pro = await proUser();
      const res = await generate(pro);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("AI_NOT_CONFIGURED");
      expect((await api().get(`${base}/options`).set(pro.auth)).body.options.enabled).toBe(false);

      jest.restoreAllMocks();
      await expect(claude.requestTopicCards("Topic", "Prompt", 3)).rejects.toMatchObject({
        statusCode: 503,
        code: "AI_NOT_CONFIGURED",
      });
    });

    it("has a daily limit that an admin sets", async () => {
      await setConfigValue("aiTrivia.generateDailyLimit", 1);
      const pro = await proUser();
      expect((await generate(pro)).status).toBe(201);
      const second = await generate(pro);
      expect(second.status).toBe(429);
      expect(second.body.code).toBe("GENERATION_LIMIT_REACHED");
      expect(second.body.details).toMatchObject({ dailyLimit: 1 });
      expect(requestTopicCards).toHaveBeenCalledTimes(1);
    });

    it("does not charge the allowance for a failed attempt", async () => {
      const pro = await proUser();
      requestTopicCards.mockResolvedValueOnce({ declined: "Pick a subject, not a person.", cards: [] });
      const declined = await generate(pro);
      expect(declined.status).toBe(422);
      expect(declined.body.code).toBe("PROMPT_REJECTED");
      expect(declined.body.message).toBe("Pick a subject, not a person.");

      answerCards.mockResolvedValueOnce([null, null, null, null, null, null, null]);
      const none = await generate(pro);
      expect(none.status).toBe(422);
      expect(none.body.code).toBe("NO_CARDS_GENERATED");

      requestTopicCards.mockRejectedValueOnce(
        Object.assign(new Error("busy"), { statusCode: 502, code: "AI_UNAVAILABLE" })
      );
      expect((await generate(pro)).status).toBe(502);

      const options = (await api().get(`${base}/options`).set(pro.auth)).body.options;
      expect(options).toMatchObject({ usedToday: 0, remaining: 10 });
      expect(await CustomQuizModel.countDocuments()).toBe(0);
    });
  });

  describe("playing and owning one", () => {
    it("is played through the trivia sessions like any other trivia", async () => {
      const pro = await proUser();
      const id = (await generate(pro, { count: 6 })).body.trivia.id;
      const start = await startTrivia(pro, {
        sourceType: "custom",
        sourceId: id,
        timerSeconds: 10,
        cardCount: 6,
      });
      expect(start.status).toBe(201);
      expect(start.body.session).toMatchObject({
        source: { type: "custom", id, title: "Emperors of Rome" },
        isPreview: false, // a real play, not an owner's test play
        cardCount: 6,
      });
      const result = await playSession(pro, start.body.session.id, (i) => i !== 0);
      expect(result).toMatchObject({ correct: 5, total: 6 });
    });

    it("belongs to its owner alone and cannot be shared", async () => {
      const pro = await proUser();
      const other = await proUser();
      const id = (await generate(pro)).body.trivia.id;

      expect((await api().get(`${base}/${id}`).set(other.auth)).body.code).toBe("AI_TRIVIA_NOT_FOUND");
      expect((await api().delete(`${base}/${id}`).set(other.auth)).status).toBe(404);
      expect((await api().get(base).set(other.auth)).body.trivias).toEqual([]);
      const start = await startTrivia(other, { sourceType: "custom", sourceId: id, timerSeconds: 5, cardCount: 5 });
      expect(start.status).toBe(404);

      const publish = await api().post(`/api/v1/custom-quizzes/${id}/publish`).set(pro.auth);
      expect(publish.status).toBe(409);
      expect(publish.body.code).toBe("AI_TRIVIA_NOT_SHAREABLE");

      const mine = await api().get(base).set(pro.auth);
      expect(mine.body.trivias.map((t: any) => t.id)).toEqual([id]);
      expect((await api().get(`${base}/${id}`).set(pro.auth)).body.trivia.cardCount).toBe(5);
    });

    it("stays outside the custom trivia list and the freemium limit", async () => {
      const free = await createUser();
      await userModel.updateOne({ _id: free.id }, { proUntil: new Date(Date.now() + DAY_MS) });
      await generate(free);
      await generate(free);
      await expire(free);

      const list = await api().get("/api/v1/custom-quizzes").set(free.auth);
      expect(list.body.quizzes).toEqual([]);
      // The one free custom trivia is still theirs to create.
      const created = await api().post("/api/v1/custom-quizzes").set(free.auth).send({ title: "Mine" });
      expect(created.status).toBe(201);
      expect(created.body.quiz.status).toBe("draft");
    });

    it("stays playable after Pro ends, but no new one can be written", async () => {
      const pro = await proUser();
      const first = (await generate(pro)).body.trivia.id;
      const second = (await generate(pro)).body.trivia.id;
      await expire(pro);

      const list = await api().get(base).set(pro.auth);
      expect(list.body.trivias.map((t: any) => t.id)).toEqual([second, first]);
      for (const id of [first, second]) {
        const start = await startTrivia(pro, { sourceType: "custom", sourceId: id, timerSeconds: 5, cardCount: 5 });
        expect(start.status).toBe(201);
        await playSession(pro, start.body.session.id);
      }
      expect((await CustomQuizModel.find({ ownerId: pro.id }).lean()).map((q) => q.status)).toEqual([
        "draft",
        "draft",
      ]);

      const again = await generate(pro);
      expect(again.status).toBe(403);
      expect(again.body.code).toBe("UPGRADE_REQUIRED");
    });

    it("can be deleted by its owner", async () => {
      const pro = await proUser();
      const id = (await generate(pro)).body.trivia.id;
      expect((await api().delete(`${base}/${id}`).set(pro.auth)).status).toBe(200);
      expect((await api().get(base).set(pro.auth)).body.trivias).toEqual([]);
      expect((await api().get(`${base}/${id}`).set(pro.auth)).status).toBe(404);
      const start = await startTrivia(pro, { sourceType: "custom", sourceId: id, timerSeconds: 5, cardCount: 5 });
      expect(start.status).toBe(404);
    });
  });

  describe("admin review (into General Trivia)", () => {
    it("is admin-only", async () => {
      const pro = await proUser();
      const id = (await generate(pro)).body.trivia.id;
      expect((await api().get(adminBase).set(pro.auth)).status).toBe(403);
      expect((await api().get(`${adminBase}/${id}`).set(pro.auth)).status).toBe(403);
      expect((await api().post(`${adminBase}/${id}/approve`).set(pro.auth)).status).toBe(403);
      expect((await api().post(`${adminBase}/${id}/reject`).set(pro.auth)).status).toBe(403);
      expect(await TriviaCardModel.countDocuments()).toBe(0);
    });

    it("lists what is waiting and shows a trivia with its answers", async () => {
      const admin = await createUser({ role: "admin" });
      const pro = await proUser();
      const id = (await generate(pro)).body.trivia.id;

      const list = await api().get(adminBase).set(admin.auth);
      expect(list.status).toBe(200);
      expect(list.body.trivias).toHaveLength(1);
      expect(list.body.trivias[0]).toMatchObject({
        id,
        title: "Emperors of Rome",
        topic: { id: null, name: "Roman emperors" },
        prompt: PROMPT,
        reviewStatus: "pending",
        cardCount: 5,
        owner: { id: pro.id },
      });
      expect(list.body.trivias[0].owner.name).toMatch(/^user/);

      const one = await api().get(`${adminBase}/${id}`).set(admin.auth);
      expect(one.body.cards).toHaveLength(5);
      expect(one.body.cards[0]).toHaveProperty("correctOptionIndex");

      expect((await api().get(`${adminBase}?status=approved`).set(admin.auth)).body.trivias).toEqual([]);
      expect((await api().get(`${adminBase}?status=nope`).set(admin.auth)).body.code).toBe("INVALID_STATUS");
    });

    it("approving copies the cards into the player's chosen topic, once", async () => {
      const admin = await createUser({ role: "admin" });
      const topicId = await createTopic(3, "History");
      const pro = await proUser();
      const id = (await generate(pro, { topicId, topicName: undefined })).body.trivia.id;

      const res = await api().post(`${adminBase}/${id}/approve`).set(admin.auth).send({ note: "Good set" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ added: 5, skipped: 0 });
      expect(res.body.topic).toMatchObject({ id: topicId, cardCount: 8 });
      expect(res.body.trivia).toMatchObject({
        reviewStatus: "approved",
        reviewNote: "Good set",
        publishedTopicId: topicId,
        publishedCardCount: 5,
      });

      const copied = await TriviaCardModel.find({ topicId, source: "ai" }).lean();
      expect(copied).toHaveLength(5);
      const originals = await CustomQuizCardModel.find({ quizId: id }).lean();
      expect(copied.map((c) => c.sourceRef).sort()).toEqual(originals.map((c) => String(c._id)).sort());

      // Free players now meet the questions in General Trivia.
      const free = await createUser();
      const topic = await api().get(`/api/v1/trivia/topics/${topicId}`).set(free.auth);
      expect(topic.body.topic.cardCount).toBe(8);

      // The owner sees it, keeps their own trivia, and it cannot be reviewed twice.
      expect((await api().get(`${base}/${id}`).set(pro.auth)).body.trivia).toMatchObject({
        reviewStatus: "approved",
        inGeneralTrivia: true,
        cardCount: 5,
      });
      const twice = await api().post(`${adminBase}/${id}/approve`).set(admin.auth);
      expect(twice.status).toBe(409);
      expect(twice.body.code).toBe("ALREADY_REVIEWED");
      expect((await api().post(`${adminBase}/${id}/reject`).set(admin.auth)).status).toBe(409);
      expect(await TriviaCardModel.countDocuments({ topicId })).toBe(8);

      // Deleting the player's trivia leaves the approved cards in General Trivia.
      await api().delete(`${base}/${id}`).set(pro.auth);
      expect(await TriviaCardModel.countDocuments({ topicId, source: "ai" })).toBe(5);
    });

    it("creates the topic a player typed, or uses the one the admin names", async () => {
      const admin = await createUser({ role: "admin" });
      const pro = await proUser();
      const typed = (await generate(pro)).body.trivia.id;
      // Written before the topic existed, so it holds the same questions.
      const twin = (await generate(pro)).body.trivia.id;
      const res = await api().post(`${adminBase}/${typed}/approve`).set(admin.auth);
      expect(res.status).toBe(200);
      expect(res.body.topic).toMatchObject({ name: "Roman emperors", slug: "roman-emperors", cardCount: 5 });
      expect(await TriviaTopicModel.countDocuments()).toBe(1);

      // The topic already asks those questions, so none is added twice.
      const second = await api().post(`${adminBase}/${twin}/approve`).set(admin.auth);
      expect(second.body).toMatchObject({ added: 0, skipped: 5 });
      expect(second.body.topic.id).toBe(res.body.topic.id);

      // A trivia written now is linked to the new topic and brings only new questions.
      const later = (await generate(pro)).body.trivia;
      expect(later.topic.id).toBe(res.body.topic.id);
      expect(later.cardCount).toBe(2);

      const elsewhere = await createTopic(1, "Antiquity");
      const third = (await generate(pro, { topicName: "Something else" })).body.trivia.id;
      const moved = await api()
        .post(`${adminBase}/${third}/approve`)
        .set(admin.auth)
        .send({ topicId: elsewhere });
      expect(moved.body.topic.id).toBe(elsewhere);
      expect(moved.body.added).toBe(5);

      const fourth = (await generate(pro, { topicName: "Another" })).body.trivia.id;
      const missing = await api()
        .post(`${adminBase}/${fourth}/approve`)
        .set(admin.auth)
        .send({ topicId: "64b000000000000000000000" });
      expect(missing.body.code).toBe("TOPIC_NOT_FOUND");
    });

    it("can approve only some of the cards", async () => {
      const admin = await createUser({ role: "admin" });
      const pro = await proUser();
      const id = (await generate(pro)).body.trivia.id;
      const cards = (await api().get(`${adminBase}/${id}`).set(admin.auth)).body.cards;

      const empty = await api().post(`${adminBase}/${id}/approve`).set(admin.auth).send({ cardIds: [] });
      expect(empty.body.code).toBe("INVALID_CARD");
      const none = await api()
        .post(`${adminBase}/${id}/approve`)
        .set(admin.auth)
        .send({ cardIds: ["64b000000000000000000000"] });
      expect(none.body.code).toBe("NO_CARDS");

      const res = await api()
        .post(`${adminBase}/${id}/approve`)
        .set(admin.auth)
        .send({ cardIds: [cards[0].id, cards[1].id] });
      expect(res.body.added).toBe(2);
      const copied = await TriviaCardModel.find({ source: "ai" }).lean();
      expect(copied.map((c) => c.text).sort()).toEqual([cards[0].text, cards[1].text].sort());
    });

    it("rejecting keeps the cards out of General Trivia and the trivia with its owner", async () => {
      const admin = await createUser({ role: "admin" });
      const pro = await proUser();
      const id = (await generate(pro)).body.trivia.id;
      const res = await api().post(`${adminBase}/${id}/reject`).set(admin.auth).send({ note: "Too niche" });
      expect(res.status).toBe(200);
      expect(res.body.trivia).toMatchObject({ reviewStatus: "rejected", reviewNote: "Too niche" });
      expect(await TriviaCardModel.countDocuments()).toBe(0);
      expect((await api().get(adminBase).set(admin.auth)).body.trivias).toEqual([]);

      const mine = (await api().get(`${base}/${id}`).set(pro.auth)).body.trivia;
      expect(mine).toMatchObject({ reviewStatus: "rejected", inGeneralTrivia: false, cardCount: 5 });
      const start = await startTrivia(pro, { sourceType: "custom", sourceId: id, timerSeconds: 5, cardCount: 5 });
      expect(start.status).toBe(201);
    });
  });
});
