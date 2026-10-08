import { connectTestDB, closeTestDB } from "./setup";
import { resetState } from "./helpers";
import { closeRedisConnection } from "../utils/redis";
import { runSeed } from "../scripts/seed";
import userModel from "../models/user.model";
import BrandModel from "../models/brand.model";
import ConfigModel from "../models/config.model";
import MatchLevelConfigModel from "../models/matchLevelConfig.model";
import TriviaTopicModel from "../models/triviaTopic.model";
import TriviaCardModel from "../models/triviaCard.model";
import CampaignModel from "../models/campaign.model";
import { getActiveLevels } from "../services/match/levels";
import { generateQuestions } from "../services/match/questionGenerator";
import { getCampaignPricing } from "../services/config/config.service";

describe("Seed script", () => {
  beforeAll(connectTestDB);
  afterEach(resetState);
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  it("seeds levels, topics, settings, an admin and a sample brand", async () => {
    const summary = await runSeed();

    expect(await MatchLevelConfigModel.countDocuments({})).toBeGreaterThanOrEqual(10);
    const levels = await getActiveLevels();
    for (const level of levels) expect(generateQuestions(level)).toHaveLength(level.questionCount);

    const topics = await TriviaTopicModel.find({}).lean();
    expect(topics.length).toBeGreaterThanOrEqual(3);
    for (const topic of topics) {
      const cards = await TriviaCardModel.find({ topicId: String(topic._id) }).lean();
      expect(cards.length).toBeGreaterThanOrEqual(20);
      for (const card of cards) {
        expect(card.options).toHaveLength(2);
        expect([0, 1]).toContain(card.correctOptionIndex);
      }
      // The right answer is not always in the same position.
      expect(new Set(cards.map((c) => c.correctOptionIndex)).size).toBe(2);
    }

    const stored = await ConfigModel.find({}).lean();
    const byKey = Object.fromEntries(stored.map((c) => [c.key, c.value]));
    expect(byKey["campaign.priceAmount"]).toBe(13302.07);
    expect(byKey["campaign.durationDays"]).toBe(30);
    expect(byKey["campaign.interruptionThreshold"]).toBe(10);
    expect(byKey["pro.priceAmount"]).toBe(1330.21);
    expect(byKey).not.toHaveProperty("game.timerMaxSeconds");
    expect(await getCampaignPricing()).toEqual({ amount: 13302.07, currency: "NGN", durationDays: 30 });

    const admin = await userModel.findOne({ role: "admin" }).select("+password");
    expect(admin!.email).toBe(summary.admin.email);
    expect(await admin!.comparePassword!(summary.admin.password!)).toBe(true);
    expect(admin!.password).not.toBe(summary.admin.password); // stored hashed

    const brandUser = await userModel.findOne({ role: "brand" }).lean();
    const profile = await BrandModel.findOne({ userId: String(brandUser!._id) }).lean();
    expect(profile).toMatchObject({ companyName: "Sunrise Foods", websiteUrl: "https://example.com/" });
    const campaign = await CampaignModel.findOne({ brandId: String(brandUser!._id) }).lean();
    expect(campaign!.status).toBe("draft"); // never live without a payment
  });

  it("is idempotent and never overwrites existing data", async () => {
    await runSeed();
    await ConfigModel.updateOne({ key: "campaign.priceAmount" }, { value: 25 });
    await MatchLevelConfigModel.updateOne({ level: 1 }, { questionCount: 9 });
    const counts = async () => ({
      users: await userModel.countDocuments({}),
      topics: await TriviaTopicModel.countDocuments({}),
      cards: await TriviaCardModel.countDocuments({}),
      levels: await MatchLevelConfigModel.countDocuments({}),
      campaigns: await CampaignModel.countDocuments({}),
    });
    const before = await counts();

    const second = await runSeed();

    expect(await counts()).toEqual(before);
    expect(second).toMatchObject({ settings: 0, levels: 0, topics: 0, cards: 0 });
    expect(second.admin.created).toBe(false);
    expect((await ConfigModel.findOne({ key: "campaign.priceAmount" }).lean())!.value).toBe(25);
    expect((await MatchLevelConfigModel.findOne({ level: 1 }).lean())!.questionCount).toBe(9);
  });
});
