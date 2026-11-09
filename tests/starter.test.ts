import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import { api, createUser, resetState } from "./helpers";
import TriviaCardModel from "../models/triviaCard.model";
import TriviaTopicModel from "../models/triviaTopic.model";
import { SEED_TOPICS } from "../scripts/seedData";

describe("Starter questions (/admin/trivia/starter)", () => {
  const football = SEED_TOPICS.find((s) => s.slug === "football")!;
  const total = SEED_TOPICS.reduce((sum, s) => sum + s.cards.length, 0);
  const list = (auth: any) => api().get("/api/v1/admin/trivia/starter").set(auth);
  const load = (auth: any, body?: any) => api().post("/api/v1/admin/trivia/starter").set(auth).send(body);

  beforeAll(connectTestDB);
  afterEach(resetState);
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  it("lists every built-in topic with how many questions are not loaded yet", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await list(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.topics.map((t: any) => t.slug)).toEqual(SEED_TOPICS.map((s) => s.slug));
    expect(res.body.topics.find((t: any) => t.slug === "football")).toMatchObject({
      name: "Football",
      topicId: null,
      total: football.cards.length,
      missing: football.cards.length,
    });
  });

  it("loads the chosen topics, creating them when needed", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await load(admin.auth, { slugs: ["football"] });
    expect(res.status).toBe(201);
    expect(res.body.loaded).toMatchObject({
      created: football.cards.length,
      topics: [{ slug: "football", topicCreated: true, created: football.cards.length }],
    });

    const topic = await TriviaTopicModel.findOne({ slug: "football" }).lean();
    expect(await TriviaTopicModel.countDocuments({})).toBe(1);
    const cards = await TriviaCardModel.find({ topicId: String(topic!._id) }).lean();
    expect(cards).toHaveLength(football.cards.length);
    const first = cards.find((c) => c.text === football.cards[0][0])!;
    expect(first.type).toBe("definition");
    expect(first.options[first.correctOptionIndex]).toBe(football.cards[0][1]);
    expect(first.options).toHaveLength(4);
    // The right answer moves through every position.
    expect(new Set(cards.map((c) => c.correctOptionIndex)).size).toBe(4);

    const after = (await list(admin.auth)).body.topics.find((t: any) => t.slug === "football");
    expect(after).toMatchObject({ topicId: String(topic!._id), missing: 0 });
  });

  it("adds only the questions a topic does not have, and never twice", async () => {
    const admin = await createUser({ role: "admin" });
    await load(admin.auth, { slugs: ["football"] });
    const topic = await TriviaTopicModel.findOne({ slug: "football" }).lean();
    const topicId = String(topic!._id);

    // Two starter questions removed, one edited by the admin, one picture card added.
    const cards = await TriviaCardModel.find({ topicId }).sort({ _id: 1 });
    await TriviaCardModel.deleteMany({ _id: { $in: [cards[0]._id, cards[1]._id] } });
    await TriviaCardModel.updateOne({ _id: cards[2]._id }, { options: ["Mine", "Theirs"] });
    await TriviaCardModel.create({
      topicId,
      type: "image",
      imageUrl: "https://storage.pazzell.test/x.webp",
      options: ["A", "B"],
      correctOptionIndex: 0,
    });

    const again = await load(admin.auth, { slugs: ["football"] });
    expect(again.body.loaded).toMatchObject({
      created: 2,
      topics: [{ slug: "football", topicCreated: false, created: 2 }],
    });
    expect(await TriviaCardModel.countDocuments({ topicId, type: "definition" })).toBe(football.cards.length);
    expect((await TriviaCardModel.findById(cards[2]._id).lean())!.options).toEqual(["Mine", "Theirs"]);

    expect((await load(admin.auth, { slugs: ["football"] })).body.loaded.created).toBe(0);
  });

  it("gives starter questions loaded with two options all four, unless the admin edited them", async () => {
    const admin = await createUser({ role: "admin" });
    await load(admin.auth, { slugs: ["football"] });
    const topicId = String((await TriviaTopicModel.findOne({ slug: "football" }).lean())!._id);
    const byText = (text: string) => TriviaCardModel.findOne({ topicId, text });
    const [kickOff, length, keeper] = football.cards;

    // Two cards as they were stored before four options, and one the admin reworded.
    await byText(kickOff[0]).updateOne({ options: [kickOff[2], kickOff[1]], correctOptionIndex: 1 });
    await byText(length[0]).updateOne({ options: [length[1], length[2]], correctOptionIndex: 0 });
    await byText(keeper[0]).updateOne({ options: [keeper[1], "Anyone"], correctOptionIndex: 0 });

    const listed = (await list(admin.auth)).body.topics.find((t: any) => t.slug === "football");
    expect(listed).toMatchObject({ missing: 0, outdated: 2 });

    const res = await load(admin.auth, { slugs: ["football"] });
    expect(res.body.loaded).toMatchObject({
      created: 0,
      upgraded: 2,
      topics: [{ slug: "football", created: 0, upgraded: 2 }],
    });
    for (const seed of [kickOff, length]) {
      const card = (await byText(seed[0]).lean())!;
      expect([...card.options].sort()).toEqual(seed.slice(1).sort());
      expect(card.options[card.correctOptionIndex]).toBe(seed[1]);
    }
    expect((await byText(keeper[0]).lean())!.options).toEqual([keeper[1], "Anyone"]);
    expect((await load(admin.auth, { slugs: ["football"] })).body.loaded.upgraded).toBe(0);
  });

  it("loads everything when no topics are named", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await load(admin.auth);
    expect(res.body.loaded.created).toBe(total);
    expect(await TriviaTopicModel.countDocuments({})).toBe(SEED_TOPICS.length);
    expect(await TriviaCardModel.countDocuments({})).toBe(total);
  });

  it("validates the request and is admin-only", async () => {
    const admin = await createUser({ role: "admin" });
    const gamer = await createUser();
    expect((await list(gamer.auth)).status).toBe(403);
    expect((await load(gamer.auth, { slugs: ["football"] })).status).toBe(403);
    for (const slugs of [["dragons"], [], "football"]) {
      const res = await load(admin.auth, { slugs });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_STARTER_TOPIC");
    }
    expect(await TriviaTopicModel.countDocuments({})).toBe(0);
  });
});
