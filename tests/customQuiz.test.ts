import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import {
  api,
  createUser,
  resetState,
  addQuizCards,
  startTrivia,
  playSession,
  allKeys,
  DAY_MS,
  TestUser,
} from "./helpers";
import userModel from "../models/user.model";
import CustomQuizModel from "../models/customQuiz.model";
import TriviaAttemptModel from "../models/triviaAttempt.model";
import { lockQuizzesForExpiredPro, syncQuizLocks } from "../services/customQuiz/quizLock.service";

const base = "/api/v1/custom-quizzes";
const create = (user: TestUser, title = "My quiz", extra: Record<string, any> = {}) =>
  api().post(base).set(user.auth).send({ title, ...extra });
const publish = (user: TestUser, id: string) => api().post(`${base}/${id}/publish`).set(user.auth);
const resolve = (slug: string) => api().get(`${base}/link/${slug}`);

async function liveQuiz(owner: TestUser, title = "Live quiz") {
  const created = await create(owner, title);
  const id = created.body.quiz.id as string;
  await addQuizCards(id, 6);
  const published = await publish(owner, id);
  return { id, slug: published.body.quiz.shareSlug as string };
}

// A quiz card has four options.
const FOUR = ["a", "b", "c", "d"];

describe("Custom trivia", () => {
  beforeAll(connectTestDB);
  afterEach(resetState);
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  describe("freemium limit", () => {
    it("lets a freemium user create only 1 quiz and returns UPGRADE_REQUIRED after that", async () => {
      const user = await createUser();
      expect((await create(user, "First")).status).toBe(201);

      const second = await create(user, "Second");
      expect(second.status).toBe(403);
      expect(second.body.code).toBe("UPGRADE_REQUIRED");
      expect(second.body.details).toMatchObject({
        feature: "custom_quiz",
        limit: 1,
        current: 1,
        pro: { amount: 1500, currency: "NGN", durationDays: 30 },
      });
      expect(await CustomQuizModel.countDocuments({ ownerId: user.id })).toBe(1);
    });

    it("counts only non-deleted quizzes toward the limit", async () => {
      const user = await createUser();
      const first = await create(user, "First");
      await api().delete(`${base}/${first.body.quiz.id}`).set(user.auth);
      expect((await create(user, "Replacement")).status).toBe(201);
    });

    it("lets a Pro user create as many as they like", async () => {
      const pro = await createUser({ proUntil: new Date(Date.now() + DAY_MS) });
      for (let i = 0; i < 4; i++) expect((await create(pro, `Quiz ${i}`)).status).toBe(201);
      const list = await api().get(base).set(pro.auth);
      expect(list.body.quizzes).toHaveLength(4);
      expect(list.body.limit).toBeNull();
    });

    it("validates the default timer against the global 0 to 15 range (0 is no timer)", async () => {
      const user = await createUser();
      expect((await create(user, "Bad", { defaultTimerSeconds: 16 })).body.code).toBe("INVALID_TIMER");
      expect((await create(user, "Bad", { defaultTimerSeconds: -1 })).body.code).toBe("INVALID_TIMER");
      const ok = await create(user, "Good", { defaultTimerSeconds: 15, defaultCardCount: 6 });
      expect(ok.body.quiz).toMatchObject({ defaultTimerSeconds: 15, defaultCardCount: 6, status: "draft" });
    });
  });

  describe("publishing and the share link", () => {
    it("needs the minimum number of valid cards to go live", async () => {
      const user = await createUser();
      const id = (await create(user)).body.quiz.id;
      await addQuizCards(id, 4);

      const tooFew = await publish(user, id);
      expect(tooFew.status).toBe(400);
      expect(tooFew.body.code).toBe("MIN_CARDS_REQUIRED");
      expect(tooFew.body.details).toEqual({ minCards: 5, cardCount: 4 });

      const added = await api()
        .post(`${base}/${id}/cards`)
        .set(user.auth)
        .send({ type: "definition", text: "The fifth card", options: ["Yes", "No", "Maybe", "Never"], correctOptionIndex: 0 });
      expect(added.status).toBe(201);

      const live = await publish(user, id);
      expect(live.status).toBe(200);
      expect(live.body.quiz.status).toBe("live");
      expect(live.body.quiz.shareSlug).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(live.body.quiz.shareUrl).toBe(`https://app.pazzell.test/q/${live.body.quiz.shareSlug}`);
    });

    it("rejects cards that do not have exactly 4 options and a marked answer", async () => {
      const user = await createUser();
      const id = (await create(user)).body.quiz.id;
      const send = (card: any) => api().post(`${base}/${id}/cards`).set(user.auth).send(card);
      expect((await send({ type: "definition", text: "x", options: ["a", "b"], correctOptionIndex: 0 })).status).toBe(400);
      expect((await send({ type: "definition", text: "x", options: ["a", "b", "c"], correctOptionIndex: 0 })).status).toBe(400);
      expect((await send({ type: "definition", text: "x", options: ["a", "b", "c", "d", "e"], correctOptionIndex: 0 })).status).toBe(400);
      expect((await send({ type: "definition", text: "x", options: FOUR, correctOptionIndex: 4 })).status).toBe(400);
      expect((await send({ type: "definition", text: "x", options: ["a", "b", "c", "A"], correctOptionIndex: 0 })).status).toBe(400);
      expect((await send({ type: "definition", options: FOUR, correctOptionIndex: 0 })).status).toBe(400);
      expect((await send({ type: "image", options: FOUR, correctOptionIndex: 0 })).status).toBe(400);

      const ok = await send({ type: "definition", text: "x", options: FOUR, correctOptionIndex: 3 });
      expect(ok.status).toBe(201);
      expect(ok.body.card).toMatchObject({ options: FOUR, correctOptionIndex: 3 });
    });

    it("plays four-option cards with all four shuffled and any of them answerable", async () => {
      const user = await createUser();
      const id = (await create(user)).body.quiz.id;
      const cards = Array.from({ length: 5 }, (_, i) => ({
        type: "definition",
        text: `Question ${i}`,
        options: [`Right ${i}`, `Wrong ${i}`, `Other ${i}`, `Last ${i}`],
        correctOptionIndex: 0,
      }));
      expect((await api().post(`${base}/${id}/cards/bulk`).set(user.auth).send({ cards })).status).toBe(201);

      const started = await startTrivia(user, {
        sourceType: "custom",
        sourceId: id,
        timerSeconds: 0,
        cardCount: 5,
        practice: true,
      });
      const sessionId = started.body.session.id;
      const q = (await api().get(`/api/v1/trivia/sessions/${sessionId}/question`).set(user.auth)).body.question;
      expect(q.options.map((o: any) => o.index)).toEqual([0, 1, 2, 3]);
      expect(q.options[q.correctOptionIndex].text).toMatch(/^Right/);

      const bad = await api()
        .post(`/api/v1/trivia/sessions/${sessionId}/answer`)
        .set(user.auth)
        .send({ questionIndex: 0, optionIndex: 4 });
      expect(bad.body.code).toBe("INVALID_OPTION");

      const result = await playSession(user, sessionId, (i) => i % 2 === 0);
      expect(result).toMatchObject({ correct: 3, total: 5 });
    });

    it("keeps an older 2-option card playable until its options are edited", async () => {
      const user = await createUser();
      const id = (await create(user)).body.quiz.id;
      const [cardId] = await addQuizCards(id, 1); // stored with two options, as before
      const card = `${base}/${id}/cards/${cardId}`;

      const renamed = await api().patch(card).set(user.auth).send({ text: "Renamed" });
      expect(renamed.status).toBe(200);
      expect(renamed.body.card.options).toHaveLength(2);

      const two = await api().patch(card).set(user.auth).send({ options: ["a", "b"], correctOptionIndex: 0 });
      expect(two.body.code).toBe("INVALID_CARD");
      const four = await api().patch(card).set(user.auth).send({ options: FOUR, correctOptionIndex: 2 });
      expect(four.body.card).toMatchObject({ options: FOUR, correctOptionIndex: 2 });
    });

    it("shows logged-out visitors a minimal landing only, never the cards", async () => {
      const owner = await createUser();
      const { slug } = await liveQuiz(owner, "Capital cities");

      const res = await resolve(slug);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        quiz: {
          title: "Capital cities",
          description: null,
          coverImageUrl: null,
          creator: { name: expect.any(String), avatar: null },
        },
        requiresAuth: true,
      });
      const keys = allKeys(res.body);
      for (const hidden of ["cards", "options", "correctOptionIndex", "id", "ownerId"]) {
        expect(keys.has(hidden)).toBe(false);
      }
    });

    it("only resolves a link while the quiz is live", async () => {
      const owner = await createUser();
      const { id, slug } = await liveQuiz(owner);

      expect((await resolve("nope-nope-nope-nope-nope")).status).toBe(404);
      await api().post(`${base}/${id}/unpublish`).set(owner.auth);
      expect((await resolve(slug)).status).toBe(404);

      await publish(owner, id); // the same link works again
      expect((await resolve(slug)).status).toBe(200);

      const regenerated = await api().post(`${base}/${id}/share-link/regenerate`).set(owner.auth);
      const newSlug = regenerated.body.quiz.shareSlug;
      expect(newSlug).not.toBe(slug);
      expect((await resolve(slug)).status).toBe(404);
      expect((await resolve(newSlug)).status).toBe(200);

      const revoked = await api().delete(`${base}/${id}/share-link`).set(owner.auth);
      expect(revoked.body.quiz).toMatchObject({ status: "unpublished", shareSlug: null, shareUrl: null });
      expect((await resolve(newSlug)).status).toBe(404);
    });

    it("requires an account to play, and the link to reach someone else's quiz", async () => {
      const owner = await createUser();
      const player = await createUser();
      const { id, slug } = await liveQuiz(owner);

      const anonymous = await api()
        .post("/api/v1/trivia/sessions")
        .send({ sourceType: "custom", slug, timerSeconds: 5, cardCount: 5 });
      expect(anonymous.status).toBe(401);

      const byId = await startTrivia(player, { sourceType: "custom", sourceId: id, timerSeconds: 5, cardCount: 5 });
      expect(byId.status).toBe(404);

      const info = await api().get(`${base}/link/${slug}/play-info`).set(player.auth);
      expect(info.body.quiz).toMatchObject({ isOwner: false, cardCountBounds: { min: 5, max: 6 } });

      const viaLink = await startTrivia(player, { sourceType: "custom", slug, timerSeconds: 5, cardCount: 5 });
      expect(viaLink.status).toBe(201);
      expect(viaLink.body.session.source).toMatchObject({ type: "custom", id });
      const result = await playSession(player, viaLink.body.session.id);
      expect(result).toMatchObject({ correct: 5, total: 5 });
    });

    it("uses the creator's default timer and card count when the player sends none", async () => {
      const owner = await createUser();
      const player = await createUser();
      const created = await create(owner, "Defaults", { defaultTimerSeconds: 3, defaultCardCount: 6 });
      await addQuizCards(created.body.quiz.id, 8);
      const slug = (await publish(owner, created.body.quiz.id)).body.quiz.shareSlug;

      const started = await startTrivia(player, { sourceType: "custom", slug });
      expect(started.status).toBe(201);
      expect(started.body.session).toMatchObject({ timerSeconds: 3, cardCount: 6 });
    });
  });

  describe("broadcast and team quizzes", () => {
    it("is a broadcast quiz unless the creator picks team", async () => {
      const owner = await createUser({ proUntil: new Date(Date.now() + DAY_MS) });
      expect((await create(owner)).body.quiz.mode).toBe("broadcast");
      expect((await create(owner, "Teams", { mode: "team" })).body.quiz.mode).toBe("team");
      const bad = await create(owner, "Odd", { mode: "relay" });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe("INVALID_QUIZ_MODE");
    });

    it("publishes a team quiz with a card for each cell and no share link", async () => {
      const owner = await createUser();
      const id = (await create(owner, "Teams", { mode: "team" })).body.quiz.id;
      await addQuizCards(id, 8);
      const short = await publish(owner, id);
      expect(short.body).toMatchObject({ code: "MIN_CARDS_REQUIRED", details: { minCards: 9, cardCount: 8 } });

      await addQuizCards(id, 1);
      const live = await publish(owner, id);
      expect(live.status).toBe(200);
      expect(live.body.quiz).toMatchObject({ status: "live", mode: "team", shareSlug: null, shareUrl: null });
      expect((await api().get(`${base}/${id}`).set(owner.auth)).body.minCardsToPublish).toBe(9);
      expect((await api().post(`${base}/${id}/share-link/regenerate`).set(owner.auth)).body.code).toBe(
        "TEAM_QUIZ_NO_SHARE_LINK"
      );
    });

    it("stops an old link working once the quiz is played in teams", async () => {
      const owner = await createUser();
      const player = await createUser();
      const { id, slug } = await liveQuiz(owner);
      const live = await api().patch(`${base}/${id}`).set(owner.auth).send({ mode: "team" });
      expect(live.body.code).toBe("QUIZ_LIVE");

      await api().post(`${base}/${id}/unpublish`).set(owner.auth);
      await api().patch(`${base}/${id}`).set(owner.auth).send({ mode: "team" });
      await addQuizCards(id, 3);
      expect((await publish(owner, id)).status).toBe(200);

      expect((await resolve(slug)).status).toBe(404);
      expect((await api().get(`${base}/link/${slug}/play-info`).set(player.auth)).status).toBe(404);
      expect((await startTrivia(player, { sourceType: "custom", slug })).status).toBe(404);
      // The owner can still try their own quiz.
      expect((await startTrivia(owner, { sourceType: "custom", sourceId: id, cardCount: 5 })).status).toBe(201);
    });
  });

  describe("personal trivia", () => {
    const personal = (user: TestUser, title = "Just for me", extra: Record<string, any> = {}) =>
      create(user, title, { origin: "personal", ...extra });

    it("is free and kept apart from the quizzes a player shares", async () => {
      const user = await createUser(); // freemium: one shared quiz allowed
      expect((await create(user)).status).toBe(201);
      expect((await create(user, "Second")).body.code).toBe("UPGRADE_REQUIRED");

      const mine = await personal(user);
      expect(mine.status).toBe(201);
      expect(mine.body.quiz).toMatchObject({ origin: "personal", mode: "broadcast", shareUrl: null });
      expect((await personal(user, "And another")).status).toBe(201);

      const shared = (await api().get(base).set(user.auth)).body.quizzes;
      expect(shared.map((q: any) => q.title)).toEqual(["My quiz"]);
      const own = (await api().get(`${base}?origin=personal`).set(user.auth)).body.quizzes;
      expect(own.map((q: any) => q.title)).toEqual(["Just for me", "And another"]);

      expect((await create(user, "x", { origin: "ai" })).body.code).toBe("INVALID_QUIZ_ORIGIN");
      expect((await personal(user, "Team", { mode: "team" })).body.code).toBe("INVALID_QUIZ_MODE");
    });

    it("cannot be published or hosted, and only its owner can play it", async () => {
      const owner = await createUser();
      const id = (await personal(owner)).body.quiz.id;
      const cards = Array.from({ length: 5 }, (_, i) => ({
        type: "definition",
        text: `Question ${i}`,
        options: [`Right ${i}`, `Wrong ${i}`, `Other ${i}`, `Last ${i}`],
        correctOptionIndex: 0,
      }));
      expect((await api().post(`${base}/${id}/cards/bulk`).set(owner.auth).send({ cards })).status).toBe(201);

      expect((await publish(owner, id)).body.code).toBe("PERSONAL_TRIVIA_NOT_SHAREABLE");
      expect((await api().patch(`${base}/${id}`).set(owner.auth).send({ mode: "team" })).body.code).toBe(
        "INVALID_QUIZ_MODE"
      );

      const stranger = await createUser();
      const theirs = await startTrivia(stranger, { sourceType: "custom", sourceId: id, timerSeconds: 5, cardCount: 5 });
      expect(theirs.status).toBe(404);

      const started = await startTrivia(owner, { sourceType: "custom", sourceId: id, timerSeconds: 5, cardCount: 5 });
      expect(started.status).toBe(201);
      expect(started.body.session.isPreview).toBe(false); // the owner's plays are real plays
      await playSession(owner, started.body.session.id);
      const stats = (await api().get(`${base}/${id}/stats`).set(owner.auth)).body.stats;
      expect(stats).toMatchObject({ plays: 1 });
    });
  });

  describe("ownership and stats", () => {
    it("lets only the owner read, edit, publish or delete a quiz", async () => {
      const owner = await createUser();
      const other = await createUser();
      const { id } = await liveQuiz(owner);
      const cardId = (await api().get(`${base}/${id}`).set(owner.auth)).body.cards[0].id;

      const attempts = [
        api().get(`${base}/${id}`).set(other.auth),
        api().get(`${base}/${id}/preview`).set(other.auth),
        api().patch(`${base}/${id}`).set(other.auth).send({ title: "Hacked" }),
        api().delete(`${base}/${id}`).set(other.auth),
        api().post(`${base}/${id}/publish`).set(other.auth),
        api().post(`${base}/${id}/unpublish`).set(other.auth),
        api().post(`${base}/${id}/share-link/regenerate`).set(other.auth),
        api().get(`${base}/${id}/stats`).set(other.auth),
        api().post(`${base}/${id}/cards`).set(other.auth).send({ type: "definition", text: "x", options: FOUR, correctOptionIndex: 0 }),
        api().patch(`${base}/${id}/cards/${cardId}`).set(other.auth).send({ text: "changed" }),
        api().delete(`${base}/${id}/cards/${cardId}`).set(other.auth),
      ];
      for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
      expect((await api().get(`${base}/${id}`)).status).toBe(401);

      const quiz = await CustomQuizModel.findById(id).lean();
      expect(quiz).toMatchObject({ title: "Live quiz", status: "live", deletedAt: null });
    });

    it("lets the owner preview the whole quiz and test-play it without affecting stats", async () => {
      const owner = await createUser();
      const created = await create(owner, "Draft quiz");
      const id = created.body.quiz.id;
      await addQuizCards(id, 5);

      const preview = await api().get(`${base}/${id}/preview`).set(owner.auth);
      expect(preview.body.cards).toHaveLength(5);
      expect(preview.body.cards[0]).toHaveProperty("correctOptionIndex");

      // A draft can be test-played by its owner.
      const test = await startTrivia(owner, { sourceType: "custom", sourceId: id, timerSeconds: 5, cardCount: 5 });
      expect(test.status).toBe(201);
      expect(test.body.session.isPreview).toBe(true);
      await playSession(owner, test.body.session.id);

      const stats = await api().get(`${base}/${id}/stats`).set(owner.auth);
      expect(stats.body.stats).toEqual({ plays: 0, averageScore: null, averageScorePercent: null });
    });

    it("reports play count and average score only", async () => {
      const owner = await createUser();
      const { id, slug } = await liveQuiz(owner);
      const a = await createUser();
      const b = await createUser();

      const first = await startTrivia(a, { sourceType: "custom", slug, timerSeconds: 5, cardCount: 5 });
      await playSession(a, first.body.session.id);
      const second = await startTrivia(b, { sourceType: "custom", slug, timerSeconds: 5, cardCount: 5 });
      await playSession(b, second.body.session.id, (i) => i < 3);

      const stats = await api().get(`${base}/${id}/stats`).set(owner.auth);
      expect(stats.body.stats).toEqual({ plays: 2, averageScore: 4, averageScorePercent: 80 });
      expect(Object.keys(stats.body.stats).sort()).toEqual(["averageScore", "averageScorePercent", "plays"]);

      // Custom quiz plays count toward the freemium campaign counter.
      expect((await userModel.findById(a.id).lean())!.nonCampaignPlaysSinceCampaign).toBe(1);
    });

    it("does not corrupt an in-progress attempt when the live quiz is edited", async () => {
      const owner = await createUser();
      const player = await createUser();
      const { id, slug } = await liveQuiz(owner);
      const started = await startTrivia(player, { sourceType: "custom", slug, timerSeconds: 5, cardCount: 6 });

      const cards = (await api().get(`${base}/${id}`).set(owner.auth)).body.cards;
      await api()
        .patch(`${base}/${id}/cards/${cards[0].id}`)
        .set(owner.auth)
        .send({ options: ["New A", "New B", "New C", "New D"], correctOptionIndex: 1 });
      await api().post(`${base}/${id}/unpublish`).set(owner.auth);

      const result = await playSession(player, started.body.session.id);
      expect(result).toMatchObject({ correct: 6, total: 6 });
      const attempt = await TriviaAttemptModel.findById(started.body.session.id).lean();
      expect(attempt!.status).toBe("completed");
    });
  });

  describe("when Pro expires", () => {
    async function proWithThreeQuizzes() {
      const user = await createUser({ proUntil: new Date(Date.now() + DAY_MS) });
      const first = await liveQuiz(user, "Oldest");
      const second = await liveQuiz(user, "Second");
      const third = (await create(user, "Third draft")).body.quiz.id as string;
      return { user, first, second, third };
    }
    const expire = (user: TestUser) =>
      userModel.updateOne({ _id: user.id }, { proUntil: new Date(Date.now() - 1000) });
    const statuses = async (user: TestUser) =>
      (await api().get(base).set(user.auth)).body.quizzes.map((q: any) => q.status);

    it("keeps the oldest quiz, locks the rest, and deletes nothing", async () => {
      const { user, first, second, third } = await proWithThreeQuizzes();
      await expire(user);

      // No job has run: the share link is already dead because the lock is applied on read.
      expect((await resolve(second.slug)).status).toBe(404);
      expect((await resolve(first.slug)).status).toBe(200);
      expect(await statuses(user)).toEqual(["live", "locked", "locked"]);
      expect(await CustomQuizModel.countDocuments({ ownerId: user.id, deletedAt: null })).toBe(3);

      const player = await createUser();
      const play = await startTrivia(player, { sourceType: "custom", slug: second.slug, timerSeconds: 5, cardCount: 5 });
      expect(play.status).toBe(404);

      // Still viewable and editable by the owner, but it cannot be published or added to.
      expect((await api().get(`${base}/${second.id}`).set(user.auth)).status).toBe(200);
      const edited = await api().patch(`${base}/${second.id}`).set(user.auth).send({ title: "Renamed" });
      expect(edited.body.quiz).toMatchObject({ title: "Renamed", status: "locked", shareUrl: null });
      const republish = await publish(user, third);
      expect(republish.status).toBe(403);
      expect(republish.body.code).toBe("UPGRADE_REQUIRED");
      expect((await create(user, "Fourth")).body.code).toBe("UPGRADE_REQUIRED");
    });

    it("unlocks everything again when Pro is renewed", async () => {
      const { user, second } = await proWithThreeQuizzes();
      await expire(user);
      expect(await statuses(user)).toEqual(["live", "locked", "locked"]);

      await userModel.updateOne({ _id: user.id }, { proUntil: new Date(Date.now() + 30 * DAY_MS) });
      await syncQuizLocks(user.id); // what a confirmed Pro payment calls

      expect(await statuses(user)).toEqual(["live", "live", "draft"]);
      expect((await resolve(second.slug)).status).toBe(200); // the same link is active again
    });

    it("unlocks the next quiz when the user deletes down to the limit", async () => {
      const { user, first, second } = await proWithThreeQuizzes();
      await expire(user);
      await api().delete(`${base}/${first.id}`).set(user.auth);
      expect(await statuses(user)).toEqual(["live", "locked"]);
      expect((await resolve(second.slug)).status).toBe(200);
    });

    it("is also applied by the scheduled sweep without any read", async () => {
      const { user } = await proWithThreeQuizzes();
      await expire(user);
      expect(await lockQuizzesForExpiredPro()).toBe(1);
      const stored = await CustomQuizModel.find({ ownerId: user.id }).sort({ createdAt: 1 }).lean();
      expect(stored.map((q) => q.status)).toEqual(["live", "locked", "locked"]);
      expect(stored[1].statusBeforeLock).toBe("live");
      expect(await lockQuizzesForExpiredPro()).toBe(0);
    });
  });
});
