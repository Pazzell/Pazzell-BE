import ErrorHandler from "../../utils/ErrorHandler";
import { redis } from "../../utils/redis";
import { isObjectId, requireString, toInt } from "../../utils/validators";
import { ICardContent } from "../../models/cardFields";
import CustomQuizModel, { ICustomQuiz } from "../../models/customQuiz.model";
import CustomQuizCardModel from "../../models/customQuizCard.model";
import TriviaTopicModel from "../../models/triviaTopic.model";
import TriviaCardModel from "../../models/triviaCard.model";
import { buildCardContent } from "../trivia/cardInput";
import { cardCountBounds } from "../trivia/session.service";
import { getPlan } from "../plan/plan.service";
import { assertCanGenerateAiTrivia } from "../plan/policy";
import {
  getAiTriviaDailyLimit,
  getDefaultTimerSeconds,
  getProPricing,
} from "../config/config.service";
import * as claude from "../quizGen/claude";
import { GENERATE_AVOID_MAX, GENERATE_MAX_COUNT, fingerprint } from "../quizGen/generate.service";

// AI generated trivia: a Pro player names a topic and describes the questions they want;
// Claude writes the cards, a second request answers them blind, and the cards both
// requests agree on are stored as a trivia that only its owner plays. It is kept as a
// custom quiz with origin "ai", so it runs on the same session engine as everything else.
// An admin decides separately whether the cards also go into General Trivia.

export const AI_TRIVIA_DEFAULT_COUNT = 10;
export const AI_TRIVIA_MIN_COUNT = 5;
export const AI_TRIVIA_MAX_COUNT = GENERATE_MAX_COUNT;
export const AI_TOPIC_MAX = 60;
export const AI_PROMPT_MAX = 500;
const TITLE_MAX = 80;
// Topic names match whatever the case, as in the topic lists.
const NAME_MATCH = { locale: "en", strength: 2 };

type PlanUser = { _id: any; proUntil?: Date | string | null };

export const publicAiTrivia = async (quiz: any, cardCount: number) => ({
  id: String(quiz._id),
  title: quiz.title,
  topic: { id: quiz.aiTopicId || null, name: quiz.aiTopicName || null },
  prompt: quiz.aiPrompt || null,
  reviewStatus: quiz.reviewStatus || "pending",
  // True once an admin has added its cards to General Trivia.
  inGeneralTrivia: quiz.reviewStatus === "approved",
  cardCount,
  cardCountBounds: await cardCountBounds(cardCount),
  defaultTimerSeconds: quiz.defaultTimerSeconds,
  defaultCardCount: quiz.defaultCardCount,
  createdAt: quiz.createdAt,
});

// --- Daily allowance --------------------------------------------------------------------

const usageKey = (userId: string, now = new Date()) =>
  `aitrivia:${userId}:${now.toISOString().slice(0, 10)}`;

const nextResetAt = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

async function allowance(userId: string) {
  const dailyLimit = await getAiTriviaDailyLimit();
  const used = Number(await redis.get(usageKey(userId))) || 0;
  return {
    dailyLimit,
    usedToday: Math.min(used, dailyLimit),
    remaining: Math.max(0, dailyLimit - used),
    resetsAt: nextResetAt(),
  };
}

/** GET /ai-trivia/options: everything the "create" screen needs. */
export async function getAiTriviaOptions(user: PlanUser) {
  const { isPro } = getPlan(user);
  const topics = await TriviaTopicModel.find({ isActive: true })
    .sort({ name: 1 })
    .collation(NAME_MATCH)
    .select("name")
    .lean();
  return {
    enabled: claude.isAiConfigured(),
    isPro,
    // What Pro costs, for the upgrade prompt.
    pro: isPro ? null : await getProPricing(),
    topics: topics.map((t) => ({ id: String(t._id), name: t.name })),
    topicMaxLength: AI_TOPIC_MAX,
    promptMaxLength: AI_PROMPT_MAX,
    count: {
      default: AI_TRIVIA_DEFAULT_COUNT,
      min: AI_TRIVIA_MIN_COUNT,
      max: AI_TRIVIA_MAX_COUNT,
    },
    ...(await allowance(String(user._id))),
  };
}

// --- Generation -------------------------------------------------------------------------

function parseCount(value: any): number {
  const count = toInt(value) ?? AI_TRIVIA_DEFAULT_COUNT;
  if (!Number.isInteger(count) || count < AI_TRIVIA_MIN_COUNT || count > AI_TRIVIA_MAX_COUNT) {
    throw new ErrorHandler(
      `count must be a whole number from ${AI_TRIVIA_MIN_COUNT} to ${AI_TRIVIA_MAX_COUNT}`,
      400,
      "INVALID_CARD_COUNT",
      { min: AI_TRIVIA_MIN_COUNT, max: AI_TRIVIA_MAX_COUNT }
    );
  }
  return count;
}

/** The topic a player selected, or the one they typed (matched to an existing topic by name). */
async function resolveTopic(input: { topicId?: any; topicName?: any }) {
  if (input.topicId !== undefined && input.topicId !== null && input.topicId !== "") {
    const topic = isObjectId(input.topicId)
      ? await TriviaTopicModel.findOne({ _id: input.topicId, isActive: true }).lean()
      : null;
    if (!topic) throw new ErrorHandler("Topic not found", 404, "TOPIC_NOT_FOUND");
    return { id: String(topic._id), name: topic.name };
  }
  if (typeof input.topicName !== "string" || !input.topicName.trim()) {
    throw new ErrorHandler("Choose a topic or type one", 400, "TOPIC_REQUIRED");
  }
  const name = requireString(input.topicName, "topicName", AI_TOPIC_MAX);
  const match = await TriviaTopicModel.findOne({ name, isActive: true })
    .collation(NAME_MATCH)
    .lean();
  return match ? { id: String(match._id), name: match.name } : { id: undefined, name };
}

/**
 * Turns the model's candidates into valid cards, dropping malformed ones and any that
 * repeat a question in `taken` or each other.
 */
async function buildCards(
  candidates: claude.TopicCardCandidate[],
  ownerId: string,
  taken: string[]
): Promise<ICardContent[]> {
  const seen = new Set<string>(taken.map(fingerprint));
  const cards: ICardContent[] = [];
  for (const candidate of candidates) {
    const key = fingerprint(candidate.statement);
    if (!key || seen.has(key)) continue;
    // The correct answer goes first or second at random; play shuffles the options again.
    const correctOptionIndex = Math.random() < 0.5 ? 0 : 1;
    const options =
      correctOptionIndex === 0
        ? [candidate.correctAnswer, candidate.wrongAnswer]
        : [candidate.wrongAnswer, candidate.correctAnswer];
    try {
      cards.push(
        await buildCardContent(
          { type: "definition", text: candidate.statement, options, correctOptionIndex },
          undefined,
          ownerId,
          "cards"
        )
      );
    } catch {
      continue;
    }
    seen.add(key);
  }
  return cards;
}

export interface AiTriviaInput {
  topicId?: any;
  topicName?: any;
  prompt?: any;
  count?: any;
}

/** POST /ai-trivia: writes, checks and stores a new AI generated trivia for a Pro player. */
export async function generateAiTrivia(user: PlanUser, input: AiTriviaInput) {
  const userId = String(user._id);
  if (!claude.isAiConfigured()) {
    throw new ErrorHandler("AI generated trivia is not available yet", 503, "AI_NOT_CONFIGURED");
  }
  await assertCanGenerateAiTrivia(user);

  const count = parseCount(input.count);
  const topic = await resolveTopic(input);
  if (typeof input.prompt !== "string" || !input.prompt.trim()) {
    throw new ErrorHandler("Describe the questions you want", 400, "PROMPT_REQUIRED");
  }
  const prompt = requireString(input.prompt, "prompt", AI_PROMPT_MAX);

  // Take today's slot before the paid requests, so parallel requests cannot exceed the limit.
  const key = usageKey(userId);
  const dailyLimit = await getAiTriviaDailyLimit();
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 2 * 24 * 60 * 60);
  if (used > dailyLimit) {
    await redis.decr(key);
    throw new ErrorHandler(
      `You have used today's ${dailyLimit} AI generated trivia${dailyLimit === 1 ? "" : "s"}. Try again tomorrow.`,
      429,
      "GENERATION_LIMIT_REACHED",
      { dailyLimit, resetsAt: nextResetAt(), isPro: true }
    );
  }

  let quiz: ICustomQuiz;
  let kept: ICardContent[];
  try {
    // Questions General Trivia already has on this topic are not written again.
    const avoid = topic.id
      ? (
          await TriviaCardModel.find({ topicId: topic.id, type: "definition" })
            .select("text")
            .sort({ _id: -1 })
            .limit(GENERATE_AVOID_MAX)
            .lean()
        )
          .map((card) => card.text || "")
          .filter(Boolean)
      : [];

    // A few spare cards cover the ones the checks below throw away.
    const spare = count + Math.ceil(count / 4);
    const generated = await claude.requestTopicCards(topic.name, prompt, spare, avoid);
    if (generated.declined && generated.cards.length === 0) {
      throw new ErrorHandler(generated.declined.slice(0, 300), 422, "PROMPT_REJECTED");
    }
    const cards = await buildCards(generated.cards, userId, avoid);

    // The blind check: a card stays only when a second request, which is not told the
    // marked answer, picks the same option.
    const answers = cards.length
      ? await claude.answerCards(
          topic.name,
          cards.map((card) => ({ statement: card.text || "", options: card.options }))
        )
      : [];
    kept = cards.filter((card, i) => answers[i] === card.correctOptionIndex).slice(0, count);
    if (kept.length === 0) {
      throw new ErrorHandler(
        "No reliable questions could be written for this. Try a broader topic or a different description.",
        422,
        "NO_CARDS_GENERATED"
      );
    }

    quiz = await CustomQuizModel.create({
      ownerId: userId,
      title: (generated.title || topic.name).slice(0, TITLE_MAX),
      origin: "ai",
      aiTopicId: topic.id,
      aiTopicName: topic.name,
      aiPrompt: prompt,
      reviewStatus: "pending",
      defaultTimerSeconds: await getDefaultTimerSeconds(),
      defaultCardCount: Math.min(kept.length, AI_TRIVIA_DEFAULT_COUNT),
    });
    await CustomQuizCardModel.insertMany(
      kept.map((content) => ({ quizId: String(quiz._id), ...content }))
    );
  } catch (e) {
    // A failed attempt does not cost the player one of today's trivias.
    await redis.decr(key);
    throw e;
  }

  return {
    trivia: await publicAiTrivia(quiz, kept.length),
    requested: count,
    usage: await allowance(userId),
  };
}

// --- The owner's trivias ----------------------------------------------------------------

/** GET /ai-trivia: newest first. Listed and playable whether or not the owner is still Pro. */
export async function listAiTrivias(userId: string) {
  const quizzes = await CustomQuizModel.find({ ownerId: userId, origin: "ai", deletedAt: null })
    .sort({ createdAt: -1 })
    .lean();
  const counts = await CustomQuizCardModel.aggregate([
    { $match: { quizId: { $in: quizzes.map((q) => String(q._id)) } } },
    { $group: { _id: "$quizId", count: { $sum: 1 } } },
  ]);
  const countOf = new Map(counts.map((c) => [c._id, c.count]));
  return Promise.all(quizzes.map((q) => publicAiTrivia(q, countOf.get(String(q._id)) || 0)));
}

/** Loads an AI generated trivia the caller owns. 404 for anyone else, so ids cannot be probed. */
export async function loadOwnedAiTrivia(userId: string, id: any): Promise<ICustomQuiz> {
  const quiz = isObjectId(id)
    ? await CustomQuizModel.findOne({ _id: id, ownerId: userId, origin: "ai", deletedAt: null })
    : null;
  if (!quiz) throw new ErrorHandler("Trivia not found", 404, "AI_TRIVIA_NOT_FOUND");
  return quiz;
}

export async function getAiTrivia(userId: string, id: any) {
  const quiz = await loadOwnedAiTrivia(userId, id);
  const count = await CustomQuizCardModel.countDocuments({ quizId: String(quiz._id) });
  return publicAiTrivia(quiz, count);
}

/** Soft delete. Cards an admin already copied into General Trivia stay there. */
export async function deleteAiTrivia(userId: string, id: any): Promise<void> {
  const quiz = await loadOwnedAiTrivia(userId, id);
  quiz.deletedAt = new Date();
  await quiz.save();
}
