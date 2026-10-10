import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import TriviaTopicModel from "../models/triviaTopic.model";
import TriviaCardModel from "../models/triviaCard.model";
import { assertObjectId, cleanString, requireString, toInt } from "../utils/validators";
import { resolveImage } from "../services/upload/image.service";
import { buildBulkCards, buildCardContent, editorCard } from "../services/trivia/cardInput";
import {
  abandonSession,
  cardCountBounds,
  getCurrentQuestion,
  getPlayStats,
  getResult,
  getSession,
  startSession,
  submitAnswer,
} from "../services/trivia/session.service";
import { importImageCards, IMPORT_MAX_COUNT } from "../services/trivia/imageImport.service";
import {
  COUNTRY_MIXED,
  COUNTRY_WORLDWIDE,
  IMPORT_CATEGORIES,
  IMPORT_COUNTRIES,
} from "../services/trivia/wikimedia";

// --- Player: topics -------------------------------------------------------------

async function cardCounts(topicIds: string[]): Promise<Map<string, number>> {
  const rows = await TriviaCardModel.aggregate([
    { $match: { topicId: { $in: topicIds } } },
    { $group: { _id: "$topicId", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.count]));
}

const publicTopic = async (topic: any, count: number) => ({
  id: String(topic._id),
  name: topic.name,
  slug: topic.slug,
  description: topic.description || null,
  coverImageUrl: topic.coverImageUrl || null,
  cardCount: count,
  cardCountBounds: await cardCountBounds(count),
});

// GET /trivia/topics — active topics that have at least one card
export const listTopics = CatchAsyncError(async (req: Request, res: Response) => {
  const topics = await TriviaTopicModel.find({ isActive: true }).sort({ order: 1, name: 1 }).lean();
  const counts = await cardCounts(topics.map((t) => String(t._id)));
  const playable = topics.filter((t) => (counts.get(String(t._id)) || 0) > 0);
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
  res.status(200).json({ success: true, topic: await publicTopic(topic, count) });
});

// --- Player: sessions (shared by topics, custom quizzes and campaigns) -------------

// POST /trivia/sessions  { sourceType, sourceId | slug, timerSeconds, cardCount, practice? }
export const postStartSession = CatchAsyncError(async (req: Request, res: Response) => {
  const body = req.body || {};
  const result = await startSession(req.user!, {
    sourceType: body.sourceType,
    sourceId: body.sourceId,
    slug: body.slug,
    timerSeconds: body.timerSeconds,
    cardCount: body.cardCount,
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

const adminTopic = (topic: any, cardCount: number) => ({
  id: String(topic._id),
  name: topic.name,
  slug: topic.slug,
  description: topic.description || null,
  coverImageUrl: topic.coverImageUrl || null,
  isActive: topic.isActive,
  order: topic.order,
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
  const topics = await TriviaTopicModel.find({}).sort({ order: 1, name: 1 }).lean();
  const counts = await cardCounts(topics.map((t) => String(t._id)));
  res.status(200).json({
    success: true,
    topics: topics.map((t) => adminTopic(t, counts.get(String(t._id)) || 0)),
  });
});

// POST /admin/trivia/topics  (multipart or JSON) { name, description?, order?, isActive?, image? }
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
