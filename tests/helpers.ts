import crypto from "crypto";
import request from "supertest";
import { app } from "../app";
import userModel from "../models/user.model";
import BrandModel from "../models/brand.model";
import TriviaTopicModel from "../models/triviaTopic.model";
import TriviaCardModel from "../models/triviaCard.model";
import TriviaAttemptQuestionModel from "../models/triviaAttemptQuestion.model";
import CustomQuizCardModel from "../models/customQuizCard.model";
import CampaignModel from "../models/campaign.model";
import CampaignCardModel from "../models/campaignCard.model";
import { redis } from "../utils/redis";
import { resetConfigCache } from "../services/config/config.service";
import { clearTestDB } from "./setup";

export const api = () => request(app);
export const DAY_MS = 24 * 60 * 60 * 1000;

let counter = 0;

export interface TestUser {
  id: string;
  email: string;
  token: string;
  auth: { Authorization: string };
}

/** Creates a user with an open session, exactly as a successful login would. */
export async function createUser(
  overrides: Partial<{ role: "gamer" | "brand" | "admin"; proUntil: Date | null; email: string }> = {}
): Promise<TestUser> {
  counter++;
  const role = overrides.role || "gamer";
  const email = overrides.email || `${role}${counter}@test.local`;
  const user = await userModel.create({
    email,
    firstName: `Test${counter}`,
    username: `user${counter}_${Date.now()}`,
    role,
    isVerified: true,
    proUntil: overrides.proUntil ?? null,
    ...(role === "brand" ? { name: "Brand Owner", companyName: `Brand ${counter}` } : {}),
  });
  if (role === "brand") {
    await BrandModel.create({
      userId: String(user._id),
      companyEmail: email,
      companyName: `Brand ${counter}`,
    });
  }
  await redis.set(String(user._id), JSON.stringify(user));
  const token = user.SignAccessToken();
  return { id: String(user._id), email, token, auth: { Authorization: `Bearer ${token}` } };
}

export async function resetState() {
  await clearTestDB();
  resetConfigCache();
}

export const definitionCard = (n: number) => ({
  type: "definition" as const,
  text: `Statement number ${n}`,
  options: [`Right ${n}`, `Wrong ${n}`],
  correctOptionIndex: 0,
});

export async function createTopic(cardCount = 12, name = "General") {
  const topic = await TriviaTopicModel.create({
    name,
    slug: `${name.toLowerCase()}-${++counter}`,
    createdBy: "admin",
  });
  await TriviaCardModel.insertMany(
    Array.from({ length: cardCount }, (_, i) => ({ topicId: String(topic._id), ...definitionCard(i) }))
  );
  return String(topic._id);
}

export async function addQuizCards(quizId: string, count: number) {
  await CustomQuizCardModel.insertMany(
    Array.from({ length: count }, (_, i) => ({ quizId, ...definitionCard(i) }))
  );
}

/** A campaign in the given state with enough cards to play. */
export async function createCampaign(
  brandId: string,
  fields: Record<string, any> = {},
  cardCount = 6
) {
  const campaign = await CampaignModel.create({
    brandId,
    brandName: "Acme",
    logoUrl: "https://storage.pazzell.test/logo.webp",
    websiteUrl: "https://acme.example/",
    title: `Acme campaign ${++counter}`,
    ...fields,
  });
  await CampaignCardModel.insertMany(
    Array.from({ length: cardCount }, (_, i) => ({
      campaignId: String(campaign._id),
      ...definitionCard(i),
    }))
  );
  return String(campaign._id);
}

export const liveWindow = (now = Date.now()) => ({
  status: "live",
  startsAt: new Date(now - DAY_MS),
  endsAt: new Date(now + 29 * DAY_MS),
});

/** Signs a webhook body the way Paystack does (HMAC-SHA512 of the raw JSON). */
export function signedWebhook(body: any) {
  const raw = JSON.stringify(body);
  const signature = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY as string)
    .update(raw)
    .digest("hex");
  return api()
    .post("/api/v1/payments/webhook/paystack")
    .set("Content-Type", "application/json")
    .set("x-paystack-signature", signature)
    .send(raw);
}

export const chargeSuccess = (
  reference: string,
  amountMajor: number,
  paidAt: Date,
  currency = "NGN"
) => ({
  event: "charge.success",
  data: {
    reference,
    amount: Math.round(amountMajor * 100),
    currency,
    status: "success",
    paid_at: paidAt.toISOString(),
  },
});

/** Starts a trivia session and returns its id. */
export async function startTrivia(user: TestUser, body: Record<string, any>) {
  const res = await api().post("/api/v1/trivia/sessions").set(user.auth).send(body);
  return res;
}

/**
 * Plays a started session through to the end. `pick` decides, per question, whether
 * to answer correctly; the right answer is read from the server-side record, which a
 * real client never sees.
 */
export async function playSession(
  user: TestUser,
  sessionId: string,
  pick: (index: number) => boolean = () => true
) {
  let last: any = null;
  for (let guard = 0; guard < 100; guard++) {
    const q = await api().get(`/api/v1/trivia/sessions/${sessionId}/question`).set(user.auth);
    if (q.body.completed) return q.body.result;
    const index = q.body.question.index;
    const stored = await TriviaAttemptQuestionModel.findOne({
      attemptId: sessionId,
      quizIndex: index,
    }).lean();
    const correctPosition = stored!.optionOrder.indexOf(stored!.card.correctOptionIndex);
    last = await api()
      .post(`/api/v1/trivia/sessions/${sessionId}/answer`)
      .set(user.auth)
      .send({ questionIndex: index, optionIndex: pick(index) ? correctPosition : 1 - correctPosition });
    if (last.body.completed) return last.body.result;
  }
  throw new Error("session did not finish");
}

/** Starts and completes one topic session for the user. */
export async function completeTopicPlay(user: TestUser, topicId: string) {
  const start = await startTrivia(user, {
    sourceType: "topic",
    sourceId: topicId,
    timerSeconds: 5,
    cardCount: 5,
  });
  if (start.status !== 201) return start;
  await playSession(user, start.body.session.id);
  return start;
}

/** Collects every key name in a JSON value, at any depth. */
export function allKeys(value: any, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, keys));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      allKeys(v, keys);
    }
  }
  return keys;
}
