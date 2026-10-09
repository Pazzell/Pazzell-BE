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
import {
  getCampaignPricing,
  getProPricing,
  migrateRetiredPricing,
  resetConfigCache,
} from "../services/config/config.service";

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
    expect(byKey["campaign.priceAmount"]).toBe(15000);
    expect(byKey["campaign.durationDays"]).toBe(30);
    expect(byKey["campaign.interruptionThreshold"]).toBe(10);
    expect(byKey["pro.priceAmount"]).toBe(1500);
    expect(byKey).not.toHaveProperty("game.timerMaxSeconds");
    expect(await getCampaignPricing()).toEqual({ amount: 15000, currency: "NGN", durationDays: 30 });

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

  it("moves stored dollar prices from an earlier seed to the naira prices", async () => {
    const valueOf = async (key: string) => (await ConfigModel.findOne({ key }).lean())!.value;
    const store = (key: string, value: any) => ConfigModel.updateOne({ key }, { value });
    await runSeed();

    // Nothing to do on a freshly seeded database.
    expect(await migrateRetiredPricing()).toEqual([]);

    await store("payments.currency", "USD");
    await store("pro.priceAmount", 1);
    await store("campaign.priceAmount", 10);
    resetConfigCache();
    expect((await migrateRetiredPricing()).sort()).toEqual(
      ["campaign.priceAmount", "payments.currency", "pro.priceAmount"]
    );
    expect(await getProPricing()).toEqual({ amount: 1500, currency: "NGN", durationDays: 30 });
    expect(await getCampaignPricing()).toEqual({ amount: 15000, currency: "NGN", durationDays: 30 });

    // The converted prices that were the default for a short while.
    await store("pro.priceAmount", 1330.21);
    await store("campaign.priceAmount", 13302.07);
    await migrateRetiredPricing();
    expect(await valueOf("pro.priceAmount")).toBe(1500);
    expect(await valueOf("campaign.priceAmount")).toBe(15000);

    // A price an admin chose is never touched, and neither is its currency.
    await store("payments.currency", "USD");
    await store("pro.priceAmount", 3);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await migrateRetiredPricing()).toEqual([]);
    warn.mockRestore();
    expect(await valueOf("payments.currency")).toBe("USD");
    expect(await valueOf("pro.priceAmount")).toBe(3);
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
