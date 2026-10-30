import { Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import { frontendUrl } from "../services/config/frontendUrl";
import CustomQuizModel, {
  CUSTOM_QUIZ_MODES,
  CustomQuizMode,
  ICustomQuiz,
  PRIVATE_QUIZ_ORIGINS,
} from "../models/customQuiz.model";
import CustomQuizCardModel from "../models/customQuizCard.model";
import userModel from "../models/user.model";
import { assertObjectId, cleanString, requireString, toInt } from "../utils/validators";
import { resolveImage } from "../services/upload/image.service";
import { buildBulkCards, buildCardContent, editorCard } from "../services/trivia/cardInput";
import { QUIZ_CARD_OPTIONS, TOPIC_CARD_OPTIONS } from "../models/cardFields";
import { cardCountBounds, cardMix, getPlayStats } from "../services/trivia/session.service";
import { assertCanCreateCustomQuiz } from "../services/plan/policy";
import { getPlan } from "../services/plan/plan.service";
import { ensureQuizLocks, syncQuizLocks } from "../services/customQuiz/quizLock.service";
import { generateDraftCards, getGenerateOptions } from "../services/quizGen/generate.service";
import { MIN_TEAM_QUIZ_CARDS } from "../services/teamGame/board";
import {
  getCustomQuizFreeLimit,
  getCustomQuizMinCards,
  getDefaultTimerSeconds,
  getTimerRange,
  getTriviaCardBounds,
  isValidTimerSeconds,
} from "../services/config/config.service";


// 128 bits of randomness, URL-safe: share links cannot be guessed or enumerated.
const newShareSlug = () => randomBytes(16).toString("base64url");
const shareUrlFor = (slug?: string) => (slug ? `${frontendUrl()}/q/${slug}` : null);

const isTeamQuiz = (quiz: { mode?: string }) => quiz.mode === "team";

const ownerQuiz = (quiz: any, cardCount: number) => {
  // The link only resolves while the quiz is live, and a team quiz has none: it is played
  // through a team game's join link instead.
  const linked = quiz.status === "live" && !isTeamQuiz(quiz);
  return {
    id: String(quiz._id),
    title: quiz.title,
    mode: quiz.mode || "broadcast",
    origin: quiz.origin || "manual",
    description: quiz.description || null,
    coverImageUrl: quiz.coverImageUrl || null,
    status: quiz.status,
    shareSlug: linked ? quiz.shareSlug || null : null,
    shareUrl: linked ? shareUrlFor(quiz.shareSlug) : null,
    defaultTimerSeconds: quiz.defaultTimerSeconds,
    defaultCardCount: quiz.defaultCardCount,
    cardCount,
    createdAt: quiz.createdAt,
    updatedAt: quiz.updatedAt,
  };
};

function parseMode(value: any): CustomQuizMode {
  if (!CUSTOM_QUIZ_MODES.includes(value)) {
    throw new ErrorHandler(
      `mode must be one of: ${CUSTOM_QUIZ_MODES.join(", ")}`,
      400,
      "INVALID_QUIZ_MODE",
      { modes: CUSTOM_QUIZ_MODES }
    );
  }
  return value;
}

/** Cards a quiz needs before it can go live: a team quiz fills the smallest board. */
async function minCardsFor(quiz: { mode?: string }): Promise<number> {
  const min = await getCustomQuizMinCards();
  return isTeamQuiz(quiz) ? Math.max(min, MIN_TEAM_QUIZ_CARDS) : min;
}

/** Loads a quiz the caller owns. 404 for anyone else, so ids cannot be probed. */
async function loadOwnedQuiz(req: Request): Promise<ICustomQuiz> {
  const quiz = await CustomQuizModel.findOne({
    _id: assertObjectId(req.params.id, "quiz id"),
    ownerId: String(req.user!._id),
    deletedAt: null,
  });
  if (!quiz) throw new ErrorHandler("Quiz not found", 404, "QUIZ_NOT_FOUND");
  return quiz;
}

// AI generated trivia keeps the two options it was written with; every other custom quiz
// (broadcast, team, personal) has four.
const optionCountFor = (quiz: ICustomQuiz) =>
  quiz.origin === "ai" ? TOPIC_CARD_OPTIONS : QUIZ_CARD_OPTIONS;

function parseTimer(value: any): number {
  const timer = toInt(value);
  if (!isValidTimerSeconds(timer)) {
    const { minSeconds, maxSeconds } = getTimerRange();
    throw new ErrorHandler(
      `defaultTimerSeconds must be a whole number from ${minSeconds} to ${maxSeconds}`,
      400,
      "INVALID_TIMER",
      { minSeconds, maxSeconds }
    );
  }
  return timer;
}

async function parseDefaultCardCount(value: any): Promise<number> {
  const { maxCards } = await getTriviaCardBounds();
  const count = toInt(value);
  if (count === undefined || !Number.isInteger(count) || count < 1 || count > maxCards) {
    throw new ErrorHandler(
      `defaultCardCount must be a whole number from 1 to ${maxCards}`,
      400,
      "INVALID_CARD_COUNT",
      { min: 1, max: maxCards }
    );
  }
  return count;
}

/** `origin` on create: "manual" (the default, a quiz for others) or "personal". */
function parseCreateOrigin(value: any): "manual" | "personal" {
  if (value === undefined || value === "manual" || value === "personal") return value ?? "manual";
  throw new ErrorHandler('origin must be "manual" or "personal"', 400, "INVALID_QUIZ_ORIGIN");
}

// POST /custom-quizzes  (multipart with optional "image" cover, or JSON)
// origin "personal" makes trivia the owner plays alone: free, private, never shared.
export const createQuiz = CatchAsyncError(async (req: Request, res: Response) => {
  const user = req.user!;
  const ownerId = String(user._id);
  const body = req.body || {};
  const origin = parseCreateOrigin(body.origin);
  await ensureQuizLocks(ownerId);
  if (origin === "manual") await assertCanCreateCustomQuiz(user);

  const mode = body.mode === undefined ? "broadcast" : parseMode(body.mode);
  if (origin === "personal" && mode !== "broadcast") {
    throw new ErrorHandler("Personal trivia is played alone, not as a team game", 400, "INVALID_QUIZ_MODE");
  }
  const title = requireString(body.title, "title", 80);
  const { minCards } = await getTriviaCardBounds();
  const quiz = await CustomQuizModel.create({
    ownerId,
    title,
    origin,
    mode,
    description: cleanString(body.description, 300),
    coverImageUrl: await resolveImage(req.file, body.coverImageUrl, ownerId, "covers"),
    defaultTimerSeconds:
      body.defaultTimerSeconds !== undefined
        ? parseTimer(body.defaultTimerSeconds)
        : await getDefaultTimerSeconds(),
    defaultCardCount:
      body.defaultCardCount !== undefined
        ? await parseDefaultCardCount(body.defaultCardCount)
        : minCards,
  });

  // Two creates racing past the limit check: re-apply the freemium rule so at most
  // the allowed number stays usable.
  await syncQuizLocks(ownerId);
  const saved = (await CustomQuizModel.findById(quiz._id))!;
  res.status(201).json({ success: true, quiz: ownerQuiz(saved, 0) });
});

// GET /custom-quizzes — the caller's quizzes. ?origin=personal lists their personal trivia
// instead (AI generated trivia has its own list at /ai-trivia).
export const listMyQuizzes = CatchAsyncError(async (req: Request, res: Response) => {
  const ownerId = String(req.user!._id);
  await ensureQuizLocks(ownerId);
  const origin = req.query.origin === "personal" ? "personal" : { $nin: PRIVATE_QUIZ_ORIGINS };
  const quizzes = await CustomQuizModel.find({ ownerId, deletedAt: null, origin })
    .sort({ createdAt: 1 })
    .lean();
  const counts = await CustomQuizCardModel.aggregate([
    { $match: { quizId: { $in: quizzes.map((q) => String(q._id)) } } },
    { $group: { _id: "$quizId", count: { $sum: 1 } } },
  ]);
  const countOf = new Map(counts.map((c) => [c._id, c.count]));
  const plan = getPlan(req.user);
  res.status(200).json({
    success: true,
    plan,
    limit: plan.isPro ? null : await getCustomQuizFreeLimit(),
    quizzes: quizzes.map((q) => ownerQuiz(q, countOf.get(String(q._id)) || 0)),
  });
});

// GET /custom-quizzes/:id  and  GET /custom-quizzes/:id/preview — the whole quiz for its owner
export const getMyQuiz = CatchAsyncError(async (req: Request, res: Response) => {
  await ensureQuizLocks(String(req.user!._id));
  const quiz = await loadOwnedQuiz(req);
  const cards = await CustomQuizCardModel.find({ quizId: String(quiz._id) })
    .sort({ createdAt: 1 })
    .lean();
  res.status(200).json({
    success: true,
    quiz: ownerQuiz(quiz, cards.length),
    cards: cards.map(editorCard),
    minCardsToPublish: await minCardsFor(quiz),
    cardCountBounds: await cardCountBounds(cards.length),
    cardMix: await cardMix(cards.filter((c) => c.type === "image").length, cards.length),
  });
});

// PATCH /custom-quizzes/:id
export const updateQuiz = CatchAsyncError(async (req: Request, res: Response) => {
  const quiz = await loadOwnedQuiz(req);
  const body = req.body || {};
  if (body.title !== undefined) quiz.title = requireString(body.title, "title", 80);
  if (body.mode !== undefined) {
    const mode = parseMode(body.mode);
    if (quiz.origin === "personal" && mode !== "broadcast") {
      throw new ErrorHandler("Personal trivia is played alone, not as a team game", 400, "INVALID_QUIZ_MODE");
    }
    // Switching a live quiz would cut off a link people have, or open one nobody expects.
    if (mode !== (quiz.mode || "broadcast") && quiz.status === "live") {
      throw new ErrorHandler(
        "Unpublish the quiz before changing how it is played",
        409,
        "QUIZ_LIVE"
      );
    }
    quiz.mode = mode;
  }
  if (body.description !== undefined) quiz.description = cleanString(body.description, 300);
  if (body.defaultTimerSeconds !== undefined) {
    quiz.defaultTimerSeconds = parseTimer(body.defaultTimerSeconds);
  }
  if (body.defaultCardCount !== undefined) {
    quiz.defaultCardCount = await parseDefaultCardCount(body.defaultCardCount);
  }
  const cover = await resolveImage(req.file, body.coverImageUrl, String(req.user!._id), "covers");
  if (cover) quiz.coverImageUrl = cover;
  await quiz.save();
  const count = await CustomQuizCardModel.countDocuments({ quizId: String(quiz._id) });
  res.status(200).json({ success: true, quiz: ownerQuiz(quiz, count) });
});

// DELETE /custom-quizzes/:id — soft delete; frees a slot under the freemium limit
export const deleteQuiz = CatchAsyncError(async (req: Request, res: Response) => {
  const quiz = await loadOwnedQuiz(req);
  quiz.deletedAt = new Date();
  quiz.status = "unpublished";
  quiz.shareSlug = undefined;
  await quiz.save();
  await syncQuizLocks(quiz.ownerId);
  res.status(200).json({ success: true });
});

// --- Cards ----------------------------------------------------------------------

// POST /custom-quizzes/:id/cards  (multipart with "image", or JSON)
export const createCard = CatchAsyncError(async (req: Request, res: Response) => {
  const quiz = await loadOwnedQuiz(req);
  const content = await buildCardContent(
    req.body,
    req.file,
    quiz.ownerId,
    "cards",
    undefined,
    optionCountFor(quiz)
  );
  const card = await CustomQuizCardModel.create({ quizId: String(quiz._id), ...content });
  res.status(201).json({ success: true, card: editorCard(card) });
});

// POST /custom-quizzes/:id/cards/bulk  { cards: [...] }
export const bulkCreateCards = CatchAsyncError(async (req: Request, res: Response) => {
  const quiz = await loadOwnedQuiz(req);
  const contents = await buildBulkCards(req.body, quiz.ownerId, "cards", optionCountFor(quiz));
  const cards = await CustomQuizCardModel.insertMany(
    contents.map((content) => ({ quizId: String(quiz._id), ...content }))
  );
  res.status(201).json({ success: true, created: cards.length, cards: cards.map(editorCard) });
});

async function loadQuizCard(quiz: ICustomQuiz, cardId: string) {
  const card = await CustomQuizCardModel.findOne({
    _id: assertObjectId(cardId, "card id"),
    quizId: String(quiz._id),
  });
  if (!card) throw new ErrorHandler("Card not found", 404, "CARD_NOT_FOUND");
  return card;
}

// PATCH /custom-quizzes/:id/cards/:cardId
// Sessions already in progress keep their own snapshot of the card, so editing a live
// quiz never changes a question someone is in the middle of.
export const updateCard = CatchAsyncError(async (req: Request, res: Response) => {
  const quiz = await loadOwnedQuiz(req);
  const card = await loadQuizCard(quiz, req.params.cardId);
  const content = await buildCardContent(
    req.body,
    req.file,
    quiz.ownerId,
    "cards",
    card,
    optionCountFor(quiz)
  );
  card.set(content);
  if (content.type === "definition") card.imageUrl = undefined;
  await card.save();
  res.status(200).json({ success: true, card: editorCard(card) });
});

// DELETE /custom-quizzes/:id/cards/:cardId
export const deleteCard = CatchAsyncError(async (req: Request, res: Response) => {
  const quiz = await loadOwnedQuiz(req);
  const card = await loadQuizCard(quiz, req.params.cardId);
  if (quiz.status === "live") {
    const min = await minCardsFor(quiz);
    const count = await CustomQuizCardModel.countDocuments({ quizId: String(quiz._id) });
    if (count - 1 < min) {
      throw new ErrorHandler(
        `A live quiz needs at least ${min} cards. Unpublish it before removing this card.`,
        409,
        "MIN_CARDS_REQUIRED",
        { minCards: min, cardCount: count }
      );
    }
  }
  await card.deleteOne();
  res.status(200).json({ success: true });
});

// --- Publishing and the share link ---------------------------------------------------

function assertNotLocked(quiz: ICustomQuiz) {
  if (quiz.status === "locked") {
    throw new ErrorHandler(
      "This quiz is locked because your Pro plan has ended. Renew Pro, or delete other quizzes.",
      403,
      "UPGRADE_REQUIRED",
      { feature: "custom_quiz", reason: "quiz_locked" }
    );
  }
}

// POST /custom-quizzes/:id/publish — draft/unpublished -> live, with a share link
export const publishQuiz = CatchAsyncError(async (req: Request, res: Response) => {
  await ensureQuizLocks(String(req.user!._id));
  const quiz = await loadOwnedQuiz(req);
  assertNotLocked(quiz);
  if (quiz.origin === "ai") {
    throw new ErrorHandler("An AI generated trivia cannot be shared", 409, "AI_TRIVIA_NOT_SHAREABLE");
  }
  if (quiz.origin === "personal") {
    throw new ErrorHandler(
      "Personal trivia is just for you, so it cannot be published or shared",
      409,
      "PERSONAL_TRIVIA_NOT_SHAREABLE"
    );
  }

  const min = await minCardsFor(quiz);
  const count = await CustomQuizCardModel.countDocuments({ quizId: String(quiz._id) });
  if (count < min) {
    throw new ErrorHandler(
      isTeamQuiz(quiz)
        ? `A team quiz needs at least ${min} cards, one for each cell of the board.`
        : `A quiz needs at least ${min} cards to go live.`,
      400,
      "MIN_CARDS_REQUIRED",
      { minCards: min, cardCount: count }
    );
  }
  quiz.status = "live";
  if (!quiz.shareSlug && !isTeamQuiz(quiz)) quiz.shareSlug = newShareSlug();
  await quiz.save();
  res.status(200).json({ success: true, quiz: ownerQuiz(quiz, count) });
});

// POST /custom-quizzes/:id/unpublish — live -> unpublished (the link stops resolving)
export const unpublishQuiz = CatchAsyncError(async (req: Request, res: Response) => {
  const quiz = await loadOwnedQuiz(req);
  if (quiz.status === "live") {
    quiz.status = "unpublished";
    await quiz.save();
  }
  const count = await CustomQuizCardModel.countDocuments({ quizId: String(quiz._id) });
  res.status(200).json({ success: true, quiz: ownerQuiz(quiz, count) });
});

// POST /custom-quizzes/:id/share-link/regenerate — the old link stops working at once
export const regenerateShareLink = CatchAsyncError(async (req: Request, res: Response) => {
  await ensureQuizLocks(String(req.user!._id));
  const quiz = await loadOwnedQuiz(req);
  assertNotLocked(quiz);
  if (quiz.status !== "live") {
    throw new ErrorHandler("Publish the quiz to get a share link", 409, "QUIZ_NOT_LIVE");
  }
  if (isTeamQuiz(quiz)) {
    throw new ErrorHandler(
      "A team quiz is shared through its team game's join link",
      409,
      "TEAM_QUIZ_NO_SHARE_LINK"
    );
  }
  quiz.shareSlug = newShareSlug();
  await quiz.save();
  const count = await CustomQuizCardModel.countDocuments({ quizId: String(quiz._id) });
  res.status(200).json({ success: true, quiz: ownerQuiz(quiz, count) });
});

// DELETE /custom-quizzes/:id/share-link — revoke the link; the quiz becomes unpublished
export const revokeShareLink = CatchAsyncError(async (req: Request, res: Response) => {
  const quiz = await loadOwnedQuiz(req);
  quiz.shareSlug = undefined;
  if (quiz.status === "live") quiz.status = "unpublished";
  await quiz.save();
  const count = await CustomQuizCardModel.countDocuments({ quizId: String(quiz._id) });
  res.status(200).json({ success: true, quiz: ownerQuiz(quiz, count) });
});

// GET /custom-quizzes/:id/stats — play count and average score only (no player data)
export const getQuizStats = CatchAsyncError(async (req: Request, res: Response) => {
  const quiz = await loadOwnedQuiz(req);
  res.status(200).json({ success: true, stats: await getPlayStats("custom", String(quiz._id)) });
});

// --- Cards from a document ---------------------------------------------------------

// GET /custom-quizzes/generate — what the upload screen needs: limits and today's allowance
export const getGenerateInfo = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, generate: await getGenerateOptions(req.user!) });
});

// POST /custom-quizzes/generate  (multipart "document", or JSON/multipart "text"; "count?")
// Returns draft cards for review. Nothing is stored: the owner edits them and saves the
// ones they keep through POST /custom-quizzes/:id/cards/bulk.
export const generateCards = CatchAsyncError(async (req: Request, res: Response) => {
  const body = req.body || {};
  const result = await generateDraftCards(req.user!, {
    file: req.file,
    text: body.text,
    prompt: body.prompt,
    topic: body.topic,
    count: body.count,
    // Drafts for a broadcast, team or personal quiz come with four options.
    optionCount: QUIZ_CARD_OPTIONS,
  });
  res.status(200).json({ success: true, ...result });
});

// GET /custom-quizzes/link/:slug — PUBLIC. Minimal landing info only; never the cards.
export const resolveShareLink = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const slug = String(req.params.slug || "");
    const notFound = () =>
      next(new ErrorHandler("This link is not available", 404, "QUIZ_NOT_FOUND"));
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(slug)) return notFound();

    const found = await CustomQuizModel.findOne({ shareSlug: slug, deletedAt: null })
      .select("ownerId")
      .lean();
    if (!found) return notFound();
    await ensureQuizLocks(found.ownerId);

    const quiz = await CustomQuizModel.findOne({
      shareSlug: slug,
      deletedAt: null,
      status: "live",
      // A team quiz is only played through a team game.
      mode: { $ne: "team" },
    }).lean();
    if (!quiz) return notFound();

    const owner = await userModel
      .findById(quiz.ownerId)
      .select("username firstName name avatar")
      .lean();
    res.set("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      quiz: {
        title: quiz.title,
        description: quiz.description || null,
        coverImageUrl: quiz.coverImageUrl || null,
        creator: {
          name: owner?.username || owner?.firstName || owner?.name || "A Pazzell player",
          avatar: owner?.avatar || null,
        },
      },
      requiresAuth: true,
    });
  }
);

// GET /custom-quizzes/link/:slug/play-info — logged-in players: what they need to start
export const getShareLinkPlayInfo = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const slug = String(req.params.slug || "");
    const quiz = await CustomQuizModel.findOne({
      shareSlug: slug,
      deletedAt: null,
    }).lean();
    if (quiz) await ensureQuizLocks(quiz.ownerId);
    const live = quiz
      ? await CustomQuizModel.findOne({
          _id: quiz._id,
          status: "live",
          shareSlug: slug,
          mode: { $ne: "team" },
        }).lean()
      : null;
    if (!live) return next(new ErrorHandler("This link is not available", 404, "QUIZ_NOT_FOUND"));

    const count = await CustomQuizCardModel.countDocuments({ quizId: String(live._id) });
    const images = await CustomQuizCardModel.countDocuments({
      quizId: String(live._id),
      type: "image",
    });
    res.status(200).json({
      success: true,
      quiz: {
        id: String(live._id),
        title: live.title,
        description: live.description || null,
        coverImageUrl: live.coverImageUrl || null,
        defaultTimerSeconds: live.defaultTimerSeconds,
        defaultCardCount: live.defaultCardCount,
        cardCountBounds: await cardCountBounds(count),
        cardMix: await cardMix(images, count),
        isOwner: live.ownerId === String(req.user!._id),
      },
    });
  }
);
