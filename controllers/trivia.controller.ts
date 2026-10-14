import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import TriviaTopicModel from "../models/triviaTopic.model";
import TriviaCardModel from "../models/triviaCard.model";
import CustomQuizModel from "../models/customQuiz.model";
import CustomQuizCardModel from "../models/customQuizCard.model";
import userModel from "../models/user.model";
import { assertObjectId, cleanString, requireString, toInt } from "../utils/validators";
import { resolveImage } from "../services/upload/image.service";
import { buildBulkCards, buildCardContent, editorCard } from "../services/trivia/cardInput";
import {
  abandonSession,
  cardCountBounds,
  cardMix,
  getCurrentQuestion,
  getPlayStats,
  getResult,
  getSession,
  startSession,
  submitAnswer,
} from "../services/trivia/session.service";
import { importImageCards, IMPORT_MAX_COUNT } from "../services/trivia/imageImport.service";
import { listStarterTopics, loadStarterTopics } from "../services/trivia/starter.service";
import {
  GENERATE_AVOID_MAX,
  fingerprint,
  generateDraftCards,
  getGenerateOptions,
} from "../services/quizGen/generate.service";
import {
  COUNTRY_MIXED,
  COUNTRY_WORLDWIDE,
  IMPORT_CATEGORIES,
  IMPORT_COUNTRIES,
} from "../services/trivia/wikimedia";

// --- Player: topics -------------------------------------------------------------

// Topic lists are alphabetical, ignoring upper and lower case.
const NAME_ORDER = { locale: "en", strength: 2 };

type CardCount = { count: number; images: number };

async function cardCounts(topicIds: string[]): Promise<Map<string, CardCount>> {
  const rows = await TriviaCardModel.aggregate([
    { $match: { topicId: { $in: topicIds } } },
    {
      $group: {
        _id: "$topicId",
        count: { $sum: 1 },
        images: { $sum: { $cond: [{ $eq: ["$type", "image"] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id, { count: r.count, images: r.images }]));
}

const publicTopic = async (topic: any, { count, images }: CardCount) => ({
  id: String(topic._id),
  name: topic.name,
  slug: topic.slug,
  description: topic.description || null,
  coverImageUrl: topic.coverImageUrl || null,
  cardCount: count,
  cardCountBounds: await cardCountBounds(count),
  cardMix: await cardMix(images, count, topic.imagePercent),
});

// GET /trivia/topics — active topics that have at least one card
export const listTopics = CatchAsyncError(async (req: Request, res: Response) => {
  const topics = await TriviaTopicModel.find({ isActive: true }).sort({ name: 1 }).collation(NAME_ORDER).lean();
  const counts = await cardCounts(topics.map((t) => String(t._id)));
  const playable = topics.filter((t) => counts.has(String(t._id)));
  res.status(200).json({
    success: true,
    topics: await Promise.all(playable.map((t) => publicTopic(t, counts.get(String(t._id))!))),
  });
});

// GET /trivia/topics/:id
export const getTopic = CatchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
  const id = assertObjectId(req.params.id, "topic id");
  const topic = await TriviaTopicModel.findOne({ _id: id, isActive: true }).lean();
  if (!topic) return next(new ErrorHandler("Topic not found", 404, "TOPIC_NOT_FOUND"));
  const count = await TriviaCardModel.countDocuments({ topicId: id });
  const images = await TriviaCardModel.countDocuments({ topicId: id, type: "image" });
  res.status(200).json({ success: true, topic: await publicTopic(topic, { count, images }) });
});

// --- Player: sessions (shared by topics, custom quizzes and campaigns) -------------

// POST /trivia/sessions  { sourceType, sourceId | slug, timerSeconds, cardCount, imagePercent?, practice? }
export const postStartSession = CatchAsyncError(async (req: Request, res: Response) => {
  const body = req.body || {};
  const result = await startSession(req.user!, {
    sourceType: body.sourceType,
    sourceId: body.sourceId,
    slug: body.slug,
    timerSeconds: body.timerSeconds,
    cardCount: body.cardCount,
    imagePercent: body.imagePercent,
    practice: body.practice,
  });
  res.status(result.resumed ? 200 : 201).json({ success: true, ...result });
});

const sessionId = (req: Request) => assertObjectId(req.params.id, "session id");

// GET /trivia/sessions/:id
export const getSessionState = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    session: await getSession(String(req.user!._id), sessionId(req)),
  });
});

// GET /trivia/sessions/:id/question
export const getQuestion = CatchAsyncError(async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  res.status(200).json({ success: true, ...(await getCurrentQuestion(req.user!, sessionId(req))) });
});

// POST /trivia/sessions/:id/answer  { questionIndex, optionIndex }
export const postAnswer = CatchAsyncError(async (req: Request, res: Response) => {
  const result = await submitAnswer(
    req.user!,
    sessionId(req),
    req.body?.questionIndex,
    req.body?.optionIndex
  );
  res.status(200).json({ success: true, ...result });
});

// GET /trivia/sessions/:id/result
export const getSessionResult = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, result: await getResult(req.user!, sessionId(req)) });
});

// POST /trivia/sessions/:id/abandon
export const postAbandon = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    session: await abandonSession(String(req.user!._id), sessionId(req)),
  });
});

// --- Admin: topics and cards ------------------------------------------------------

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "topic";

async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let n = 2; await TriviaTopicModel.exists({ slug, _id: { $ne: excludeId } }); n++) {
    slug = `${base}-${n}`;
  }
  return slug;
}

/** undefined: not sent. null: use the global setting. Otherwise a whole number from 0 to 100. */
function parseImagePercent(value: any): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "" || value === "null") return null;
  const percent = toInt(value);
  if (percent === undefined || Number.isNaN(percent) || percent < 0 || percent > 100) {
    throw new ErrorHandler(
      "imagePercent must be a whole number from 0 to 100, or empty for the default",
      400,
      "INVALID_IMAGE_PERCENT"
    );
  }
  return percent;
}

const adminTopic = (topic: any, cardCount: number) => ({
  id: String(topic._id),
  name: topic.name,
  slug: topic.slug,
  description: topic.description || null,
  coverImageUrl: topic.coverImageUrl || null,
  isActive: topic.isActive,
  order: topic.order,
  imagePercent: topic.imagePercent ?? null,
  cardCount,
  createdAt: topic.createdAt,
  updatedAt: topic.updatedAt,
});

async function loadTopic(id: string) {
  const topic = await TriviaTopicModel.findById(assertObjectId(id, "topic id"));
  if (!topic) throw new ErrorHandler("Topic not found", 404, "TOPIC_NOT_FOUND");
  return topic;
}

// GET /admin/trivia/topics
export const adminListTopics = CatchAsyncError(async (req: Request, res: Response) => {
  const topics = await TriviaTopicModel.find({}).sort({ name: 1 }).collation(NAME_ORDER).lean();
  const counts = await cardCounts(topics.map((t) => String(t._id)));
  res.status(200).json({
    success: true,
    topics: topics.map((t) => adminTopic(t, counts.get(String(t._id))?.count || 0)),
  });
});

// POST /admin/trivia/topics  (multipart or JSON) { name, description?, order?, isActive?, imagePercent?, image? }
export const adminCreateTopic = CatchAsyncError(async (req: Request, res: Response) => {
  const adminId = String(req.user!._id);
  const name = requireString(req.body?.name, "name", 60);
  const order = toInt(req.body?.order);
  if (Number.isNaN(order)) throw new ErrorHandler("order must be an integer", 400);
  const topic = await TriviaTopicModel.create({
    name,
    slug: await uniqueSlug(name),
    description: cleanString(req.body?.description, 300),
    coverImageUrl: await resolveImage(req.file, req.body?.coverImageUrl, adminId, "covers"),
    order: order ?? 0,
    imagePercent: parseImagePercent(req.body?.imagePercent) ?? null,
    isActive: String(req.body?.isActive ?? "true") !== "false",
    createdBy: adminId,
  });
  res.status(201).json({ success: true, topic: adminTopic(topic, 0) });
});

// GET /admin/trivia/topics/:id — the topic with every card (admin preview)
export const adminGetTopic = CatchAsyncError(async (req: Request, res: Response) => {
  const topic = await loadTopic(req.params.id);
  const cards = await TriviaCardModel.find({ topicId: String(topic._id) })
    .sort({ createdAt: 1 })
    .lean();
  res.status(200).json({
    success: true,
    topic: adminTopic(topic, cards.length),
    cards: cards.map(editorCard),
    stats: await getPlayStats("topic", String(topic._id)),
  });
});

// PATCH /admin/trivia/topics/:id
export const adminUpdateTopic = CatchAsyncError(async (req: Request, res: Response) => {
  const adminId = String(req.user!._id);
  const topic = await loadTopic(req.params.id);
  const body = req.body || {};
  if (body.name !== undefined) {
    topic.name = requireString(body.name, "name", 60);
    topic.slug = await uniqueSlug(topic.name, String(topic._id));
  }
  if (body.description !== undefined) topic.description = cleanString(body.description, 300);
  if (body.order !== undefined) {
    const order = toInt(body.order);
    if (order === undefined || Number.isNaN(order)) {
      throw new ErrorHandler("order must be an integer", 400);
    }
    topic.order = order;
  }
  if (body.isActive !== undefined) topic.isActive = String(body.isActive) !== "false";
  const imagePercent = parseImagePercent(body.imagePercent);
  if (imagePercent !== undefined) topic.imagePercent = imagePercent;
  const cover = await resolveImage(req.file, body.coverImageUrl, adminId, "covers");
  if (cover) topic.coverImageUrl = cover;
  await topic.save();
  const count = await TriviaCardModel.countDocuments({ topicId: String(topic._id) });
  res.status(200).json({ success: true, topic: adminTopic(topic, count) });
});

// DELETE /admin/trivia/topics/:id — removes the topic and its cards.
// Sessions already in progress keep their own card snapshots.
export const adminDeleteTopic = CatchAsyncError(async (req: Request, res: Response) => {
  const topic = await loadTopic(req.params.id);
  await TriviaCardModel.deleteMany({ topicId: String(topic._id) });
  await topic.deleteOne();
  res.status(200).json({ success: true });
});

// POST /admin/trivia/topics/:id/cards  (multipart with "image", or JSON)
export const adminCreateCard = CatchAsyncError(async (req: Request, res: Response) => {
  const topic = await loadTopic(req.params.id);
  const content = await buildCardContent(req.body, req.file, String(req.user!._id), "cards");
  const card = await TriviaCardModel.create({ topicId: String(topic._id), ...content });
  res.status(201).json({ success: true, card: editorCard(card) });
});

// POST /admin/trivia/topics/:id/cards/bulk  { cards: [...] } — all-or-nothing
export const adminBulkCreateCards = CatchAsyncError(async (req: Request, res: Response) => {
  const topic = await loadTopic(req.params.id);
  const contents = await buildBulkCards(req.body, String(req.user!._id), "cards");
  const cards = await TriviaCardModel.insertMany(
    contents.map((content) => ({ topicId: String(topic._id), ...content }))
  );
  res.status(201).json({ success: true, created: cards.length, cards: cards.map(editorCard) });
});

// GET /admin/trivia/import/categories — what POST /admin/trivia/import can fetch
export const adminListImportCategories = CatchAsyncError(async (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    categories: IMPORT_CATEGORIES.map((c) => ({
      key: c.key,
      topicName: c.topicName,
      topicSlug: c.topicSlug,
      supportsCountry: c.people,
    })),
    countries: [COUNTRY_MIXED, COUNTRY_WORLDWIDE, ...Object.keys(IMPORT_COUNTRIES)],
    maxCount: IMPORT_MAX_COUNT,
  });
});

// POST /admin/trivia/import  { category, count?, topicId?, country? }
// Fetches pictures for the category and adds them to a topic as image cards.
export const adminImportImageCards = CatchAsyncError(async (req: Request, res: Response) => {
  const result = await importImageCards(String(req.user!._id), req.body || {});
  res.status(201).json({ success: true, import: result });
});

// GET /admin/trivia/starter — the built-in topics and how many of their questions are not loaded
export const adminListStarterTopics = CatchAsyncError(async (_req: Request, res: Response) => {
  res.status(200).json({ success: true, topics: await listStarterTopics() });
});

// POST /admin/trivia/starter  { slugs? } — adds the built-in questions a topic does not have yet
export const adminLoadStarterTopics = CatchAsyncError(async (req: Request, res: Response) => {
  const loaded = await loadStarterTopics(String(req.user!._id), req.body?.slugs);
  res.status(201).json({ success: true, loaded });
});

// GET /admin/trivia/generate — what the upload screen needs (admins have no daily allowance)
export const adminGetGenerateInfo = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    generate: await getGenerateOptions(req.user!, { unlimited: true }),
  });
});

// POST /admin/trivia/generate  (multipart "document", or JSON/multipart "text"; "count?", "topicId?")
// Returns draft definition cards for review. Nothing is stored: the admin edits them and
// saves the ones they keep through POST /admin/trivia/topics/:id/cards/bulk. With a
// topicId, questions the topic already has are not written again.
export const adminGenerateCards = CatchAsyncError(async (req: Request, res: Response) => {
  const body = req.body || {};
  let avoid: string[] = [];
  if (body.topicId !== undefined && body.topicId !== null && body.topicId !== "") {
    const topic = await loadTopic(body.topicId);
    const held = await TriviaCardModel.find({ topicId: String(topic._id), type: "definition" })
      .select("text")
      .sort({ _id: -1 })
      .limit(GENERATE_AVOID_MAX)
      .lean();
    avoid = held.map((card) => card.text || "").filter(Boolean);
  }
  const result = await generateDraftCards(req.user!, {
    file: req.file,
    text: body.text,
    count: body.count,
    unlimited: true,
    avoid,
  });
  res.status(200).json({ success: true, ...result });
});

async function loadTopicCard(topicId: string, cardId: string) {
  const card = await TriviaCardModel.findOne({
    _id: assertObjectId(cardId, "card id"),
    topicId: assertObjectId(topicId, "topic id"),
  });
  if (!card) throw new ErrorHandler("Card not found", 404, "CARD_NOT_FOUND");
  return card;
}

// PATCH /admin/trivia/topics/:id/cards/:cardId
export const adminUpdateCard = CatchAsyncError(async (req: Request, res: Response) => {
  const card = await loadTopicCard(req.params.id, req.params.cardId);
  const content = await buildCardContent(req.body, req.file, String(req.user!._id), "cards", card);
  // The credit belongs to the picture: it goes when the picture is replaced or removed.
  if (content.imageUrl !== card.imageUrl) card.attribution = undefined;
  card.set(content);
  if (content.type === "definition") card.imageUrl = undefined;
  await card.save();
  res.status(200).json({ success: true, card: editorCard(card) });
});

// DELETE /admin/trivia/topics/:id/cards/:cardId
export const adminDeleteCard = CatchAsyncError(async (req: Request, res: Response) => {
  const card = await loadTopicCard(req.params.id, req.params.cardId);
  await card.deleteOne();
  res.status(200).json({ success: true });
});

// --- Admin: AI generated trivia waiting to join General Trivia ----------------------------

const REVIEW_STATUSES = ["pending", "approved", "rejected"];
const OWNER_FIELDS = "username firstName name";

const adminAiTrivia = (quiz: any, cardCount: number, owner?: any) => ({
  id: String(quiz._id),
  title: quiz.title,
  topic: { id: quiz.aiTopicId || null, name: quiz.aiTopicName || null },
  prompt: quiz.aiPrompt || null,
  reviewStatus: quiz.reviewStatus || "pending",
  reviewNote: quiz.reviewNote || null,
  reviewedAt: quiz.reviewedAt || null,
  publishedTopicId: quiz.publishedTopicId || null,
  publishedCardCount: quiz.publishedCardCount ?? null,
  cardCount,
  owner: {
    id: quiz.ownerId,
    name: owner?.username || owner?.firstName || owner?.name || null,
  },
  createdAt: quiz.createdAt,
});

async function loadAiTrivia(id: string) {
  const quiz = await CustomQuizModel.findOne({
    _id: assertObjectId(id, "trivia id"),
    origin: "ai",
    deletedAt: null,
  });
  if (!quiz) throw new ErrorHandler("Trivia not found", 404, "AI_TRIVIA_NOT_FOUND");
  return quiz;
}

function assertPendingReview(quiz: any) {
  if ((quiz.reviewStatus || "pending") !== "pending") {
    throw new ErrorHandler("This trivia has already been reviewed", 409, "ALREADY_REVIEWED", {
      reviewStatus: quiz.reviewStatus,
    });
  }
}

// GET /admin/trivia/ai?status=pending|approved|rejected|all — oldest first
export const adminListAiTrivias = CatchAsyncError(async (req: Request, res: Response) => {
  const status = String(req.query.status || "pending");
  if (status !== "all" && !REVIEW_STATUSES.includes(status)) {
    throw new ErrorHandler(
      'status must be "pending", "approved", "rejected" or "all"',
      400,
      "INVALID_STATUS"
    );
  }
  const quizzes = await CustomQuizModel.find({
    origin: "ai",
    deletedAt: null,
    ...(status === "all" ? {} : { reviewStatus: status }),
  })
    .sort({ createdAt: 1 })
    .lean();
  const counts = await CustomQuizCardModel.aggregate([
    { $match: { quizId: { $in: quizzes.map((q) => String(q._id)) } } },
    { $group: { _id: "$quizId", count: { $sum: 1 } } },
  ]);
  const countOf = new Map(counts.map((c) => [c._id, c.count]));
  const owners = await userModel
    .find({ _id: { $in: quizzes.map((q) => q.ownerId) } })
    .select(OWNER_FIELDS)
    .lean();
  const ownerOf = new Map(owners.map((o) => [String(o._id), o]));
  res.status(200).json({
    success: true,
    trivias: quizzes.map((q) =>
      adminAiTrivia(q, countOf.get(String(q._id)) || 0, ownerOf.get(q.ownerId))
    ),
  });
});

// GET /admin/trivia/ai/:id — the trivia with every card, answers included
export const adminGetAiTrivia = CatchAsyncError(async (req: Request, res: Response) => {
  const quiz = await loadAiTrivia(req.params.id);
  const cards = await CustomQuizCardModel.find({ quizId: String(quiz._id) })
    .sort({ createdAt: 1 })
    .lean();
  const owner = await userModel.findById(quiz.ownerId).select(OWNER_FIELDS).lean();
  res.status(200).json({
    success: true,
    trivia: adminAiTrivia(quiz, cards.length, owner),
    cards: cards.map(editorCard),
  });
});

// POST /admin/trivia/ai/:id/approve  { topicId?, topicName?, cardIds?, note? }
// Copies the cards into a General Trivia topic, where they are live at once. The topic is
// `topicId`, else the one the player chose, else the one named `topicName` (or by the
// player), which is created if it does not exist. `cardIds` approves only some of the cards.
// The player's own trivia is not changed.
export const adminApproveAiTrivia = CatchAsyncError(async (req: Request, res: Response) => {
  const adminId = String(req.user!._id);
  const quiz = await loadAiTrivia(req.params.id);
  assertPendingReview(quiz);
  const body = req.body || {};

  let cardIds: string[] | undefined;
  if (body.cardIds !== undefined) {
    if (!Array.isArray(body.cardIds) || body.cardIds.length === 0) {
      throw new ErrorHandler("cardIds must be a list of card ids", 400, "INVALID_CARD");
    }
    cardIds = body.cardIds.map((id: any) => assertObjectId(id, "card id"));
  }
  const cards = await CustomQuizCardModel.find({
    quizId: String(quiz._id),
    ...(cardIds ? { _id: { $in: cardIds } } : {}),
  })
    .sort({ createdAt: 1 })
    .lean();
  if (cards.length === 0) throw new ErrorHandler("There are no cards to approve", 400, "NO_CARDS");

  let topic = null;
  if (body.topicId !== undefined && body.topicId !== null && body.topicId !== "") {
    topic = await loadTopic(body.topicId);
  } else if (body.topicName === undefined && quiz.aiTopicId) {
    topic = await TriviaTopicModel.findById(quiz.aiTopicId);
  }
  if (!topic) {
    const name = requireString(body.topicName ?? quiz.aiTopicName, "topicName", 60);
    topic =
      (await TriviaTopicModel.findOne({ name }).collation(NAME_ORDER)) ||
      (await TriviaTopicModel.create({ name, slug: await uniqueSlug(name), createdBy: adminId }));
  }
  const topicId = String(topic._id);

  // A card is copied once, and never on top of a question the topic already asks.
  const held = await TriviaCardModel.find({ topicId }).select("text sourceRef").lean();
  const copied = new Set(held.map((card) => card.sourceRef).filter(Boolean));
  const asked = new Set(held.map((card) => fingerprint(card.text || "")));
  const fresh = cards.filter((card) => {
    const key = fingerprint(card.text || "");
    if (copied.has(String(card._id)) || asked.has(key)) return false;
    asked.add(key);
    return true;
  });
  await TriviaCardModel.insertMany(
    fresh.map((card) => ({
      topicId,
      type: card.type,
      imageUrl: card.imageUrl,
      text: card.text,
      options: card.options,
      correctOptionIndex: card.correctOptionIndex,
      attribution: card.attribution,
      source: "ai",
      sourceRef: String(card._id),
    }))
  );

  quiz.reviewStatus = "approved";
  quiz.reviewedBy = adminId;
  quiz.reviewedAt = new Date();
  quiz.reviewNote = cleanString(body.note, 300);
  quiz.publishedTopicId = topicId;
  quiz.publishedCardCount = fresh.length;
  await quiz.save();

  const count = await CustomQuizCardModel.countDocuments({ quizId: String(quiz._id) });
  const topicCards = await TriviaCardModel.countDocuments({ topicId });
  res.status(200).json({
    success: true,
    trivia: adminAiTrivia(quiz, count),
    topic: adminTopic(topic, topicCards),
    added: fresh.length,
    skipped: cards.length - fresh.length,
  });
});

// POST /admin/trivia/ai/:id/reject  { note? } — the cards stay out of General Trivia
export const adminRejectAiTrivia = CatchAsyncError(async (req: Request, res: Response) => {
  const quiz = await loadAiTrivia(req.params.id);
  assertPendingReview(quiz);
  quiz.reviewStatus = "rejected";
  quiz.reviewedBy = String(req.user!._id);
  quiz.reviewedAt = new Date();
  quiz.reviewNote = cleanString(req.body?.note, 300);
  await quiz.save();
  const count = await CustomQuizCardModel.countDocuments({ quizId: String(quiz._id) });
  res.status(200).json({ success: true, trivia: adminAiTrivia(quiz, count) });
});
