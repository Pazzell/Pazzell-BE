import "dotenv/config";
import mongoose from "mongoose";
import { randomBytes } from "crypto";
import userModel from "../models/user.model";
import BrandModel from "../models/brand.model";
import ConfigModel from "../models/config.model";
import MatchLevelConfigModel from "../models/matchLevelConfig.model";
import TriviaTopicModel from "../models/triviaTopic.model";
import TriviaCardModel from "../models/triviaCard.model";
import CampaignModel from "../models/campaign.model";
import CampaignCardModel from "../models/campaignCard.model";
import { CONFIG_DEFAULTS, READ_ONLY_CONFIG_KEYS } from "../services/config/config.service";
import { DEFAULT_LEVELS } from "../services/match/levels";
import { generateAvatar } from "../utils/userHelpers";
import { SEED_CAMPAIGN_CARDS, SEED_TOPICS, SeedCard } from "./seedData";

// Idempotent seed: safe to run repeatedly. It only ever inserts what is missing —
// it never overwrites a setting, level, topic or account that already exists.
//
//   npm run seed
//
// Optional env: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_BRAND_EMAIL, SEED_BRAND_PASSWORD.
// When a password is not provided a random one is generated and printed once.

export interface SeedSummary {
  settings: number;
  levels: number;
  topics: number;
  cards: number;
  admin: { email: string; created: boolean; password?: string };
  brand: { email: string; created: boolean; password?: string };
}

const toCard = ([text, correct, wrong]: SeedCard, index: number) => {
  // Alternate which side holds the right answer so position is never a clue.
  const correctFirst = index % 2 === 0;
  return {
    type: "definition" as const,
    text,
    options: correctFirst ? [correct, wrong] : [wrong, correct],
    correctOptionIndex: correctFirst ? 0 : 1,
  };
};

async function ensureAccount(
  email: string,
  password: string | undefined,
  fields: Record<string, any>
) {
  const existing = await userModel.findOne({ email });
  if (existing) return { user: existing, created: false, password: undefined };
  const generated = password || randomBytes(12).toString("base64url");
  const user = await userModel.create({ email, password: generated, isVerified: true, ...fields });
  return { user, created: true, password: password ? undefined : generated };
}

export async function runSeed(): Promise<SeedSummary> {
  // 1. Settings: store the defaults so they are visible and editable from the admin shell.
  let settings = 0;
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    if (READ_ONLY_CONFIG_KEYS.has(key)) continue;
    const result = await ConfigModel.updateOne(
      { key },
      { $setOnInsert: { key, value, description: "Seeded default" } },
      { upsert: true }
    );
    settings += result.upsertedCount;
  }

  // 2. Match levels
  let levels = 0;
  for (const level of DEFAULT_LEVELS) {
    const result = await MatchLevelConfigModel.updateOne(
      { level: level.level },
      { $setOnInsert: level },
      { upsert: true }
    );
    levels += result.upsertedCount;
  }

  // 3. Admin account
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@pazzell.local";
  const admin = await ensureAccount(adminEmail, process.env.SEED_ADMIN_PASSWORD, {
    firstName: "Pazzell",
    lastName: "Admin",
    username: "pazzelladmin",
    role: "admin",
    avatar: generateAvatar("Pazzell Admin"),
  });

  // 4. Example topics with cards
  let topics = 0;
  let cards = 0;
  for (const seed of SEED_TOPICS) {
    let topic = await TriviaTopicModel.findOne({ slug: seed.slug });
    if (!topic) {
      topic = await TriviaTopicModel.create({
        name: seed.name,
        slug: seed.slug,
        description: seed.description,
        order: seed.order,
        createdBy: String(admin.user._id),
      });
      topics++;
    }
    const topicId = String(topic._id);
    if ((await TriviaCardModel.countDocuments({ topicId })) === 0) {
      const inserted = await TriviaCardModel.insertMany(
        seed.cards.map((card, i) => ({ topicId, ...toCard(card, i) }))
      );
      cards += inserted.length;
    }
  }

  // 5. Sample brand with a draft campaign (draft only: it is never live without a payment)
  const brandEmail = process.env.SEED_BRAND_EMAIL || "brand@pazzell.local";
  const brandName = "Sunrise Foods";
  const logoUrl = generateAvatar(brandName);
  const brand = await ensureAccount(brandEmail, process.env.SEED_BRAND_PASSWORD, {
    name: "Sample Brand",
    companyName: brandName,
    role: "brand",
    avatar: logoUrl,
  });
  const brandId = String(brand.user._id);
  if (!(await BrandModel.exists({ userId: brandId }))) {
    await BrandModel.create({
      userId: brandId,
      companyEmail: brandEmail,
      companyName: brandName,
      logoUrl,
      websiteUrl: "https://example.com/",
      verified: true,
    });
  }
  if (!(await CampaignModel.exists({ brandId }))) {
    const campaign = await CampaignModel.create({
      brandId,
      brandName,
      logoUrl,
      websiteUrl: "https://example.com/",
      ctaText: "Visit our site",
      title: "Healthy habits with Sunrise Foods",
      description: "A short sponsored trivia about everyday healthy habits.",
      tags: ["health", "food"],
      status: "draft",
    });
    await CampaignCardModel.insertMany(
      SEED_CAMPAIGN_CARDS.map((card, i) => ({ campaignId: String(campaign._id), ...toCard(card, i) }))
    );
  }

  return {
    settings,
    levels,
    topics,
    cards,
    admin: { email: adminEmail, created: admin.created, password: admin.password },
    brand: { email: brandEmail, created: brand.created, password: brand.password },
  };
}

async function main() {
  const uri = process.env.DB_URI;
  if (!uri) throw new Error("DB_URI is not set");
  if (process.env.NODE_ENV === "production" && process.env.SEED_CONFIRM !== "yes") {
    throw new Error("Refusing to seed a production database without SEED_CONFIRM=yes");
  }

  await mongoose.connect(uri);
  console.log(`Seeding database "${mongoose.connection.name}" on ${mongoose.connection.host}`);
  const summary = await runSeed();
  console.log(
    `Inserted: ${summary.settings} setting(s), ${summary.levels} level(s), ${summary.topics} topic(s), ${summary.cards} card(s)`
  );
  for (const account of [summary.admin, summary.brand]) {
    if (!account.created) console.log(`Account ${account.email} already exists — left unchanged`);
    else if (account.password) console.log(`Created ${account.email} with password: ${account.password}`);
    else console.log(`Created ${account.email} with the password from the environment`);
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Seed failed:", err.message);
    process.exit(1);
  });
}
