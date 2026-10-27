import ErrorHandler from "../../utils/ErrorHandler";
import { isObjectId } from "../../utils/validators";
import { ICardContent } from "../../models/cardFields";
import { TriviaSourceType } from "../../models/triviaAttempt.model";
import TriviaTopicModel from "../../models/triviaTopic.model";
import TriviaCardModel from "../../models/triviaCard.model";
import CustomQuizModel from "../../models/customQuiz.model";
import CustomQuizCardModel from "../../models/customQuizCard.model";
import CampaignModel from "../../models/campaign.model";
import CampaignCardModel from "../../models/campaignCard.model";
import { ensureQuizLocks } from "../customQuiz/quizLock.service";
import { campaignTimerSeconds, isServable, publicCampaign } from "../campaign/campaign.service";

export interface SourceCard extends ICardContent {
  id: string;
}

export interface ResolvedSource {
  sourceType: TriviaSourceType;
  sourceId: string;
  title: string;
  // Owner / brand / admin test play: never gated and never counted.
  isPreview: boolean;
  defaults: { timerSeconds?: number; cardCount?: number };
  // Seconds per question the source insists on (a campaign's, set by its brand); the
  // player's own choice is ignored when it is set.
  fixedTimerSeconds?: number;
  // The source's own share of picture cards; without it the global setting applies.
  imagePercent?: number;
  brand: ReturnType<typeof publicCampaign> | null;
  cards: SourceCard[];
}

type Player = { _id: any; role: string };

const toCards = (rows: any[]): SourceCard[] =>
  rows.map((c) => ({
    id: String(c._id),
    type: c.type,
    imageUrl: c.imageUrl,
    text: c.text,
    options: c.options,
    correctOptionIndex: c.correctOptionIndex,
    attribution: c.attribution,
  }));

const notFound = (what: string, code: string) => new ErrorHandler(`${what} not found`, 404, code);

/**
 * Resolves what a player is asking to play and whether they are allowed to.
 *  - topic:    any active admin topic.
 *  - custom:   the owner may always play their own quiz (a test play); anyone else needs
 *              the share link slug, and the quiz must be live.
 *  - campaign: any player while the campaign is live and inside its paid window; the
 *              owning brand and admins may test-play it in any state.
 */
export async function resolveSource(
  player: Player,
  input: { sourceType?: any; sourceId?: any; slug?: any }
): Promise<ResolvedSource> {
  const playerId = String(player._id);

  if (input.sourceType === "topic") {
    if (!isObjectId(input.sourceId)) throw notFound("Topic", "TOPIC_NOT_FOUND");
    const topic = await TriviaTopicModel.findOne({ _id: input.sourceId, isActive: true }).lean();
    if (!topic) throw notFound("Topic", "TOPIC_NOT_FOUND");
    const cards = await TriviaCardModel.find({ topicId: String(topic._id) }).lean();
    return {
      sourceType: "topic",
      sourceId: String(topic._id),
      title: topic.name,
      isPreview: false,
      defaults: {},
      imagePercent: topic.imagePercent ?? undefined,
      brand: null,
      cards: toCards(cards),
    };
  }

  if (input.sourceType === "custom") {
    let quiz;
    if (typeof input.slug === "string" && input.slug) {
      quiz = await CustomQuizModel.findOne({ shareSlug: input.slug, deletedAt: null });
    } else if (isObjectId(input.sourceId)) {
      quiz = await CustomQuizModel.findOne({ _id: input.sourceId, deletedAt: null });
    }
    if (!quiz) throw notFound("Quiz", "QUIZ_NOT_FOUND");

    const isOwner = quiz.ownerId === playerId;
    if (!isOwner) {
      // The owner's plan may have lapsed since the locks were last applied.
      await ensureQuizLocks(quiz.ownerId);
      const fresh = await CustomQuizModel.findById(quiz._id).select("status shareSlug mode").lean();
      const viaLink = typeof input.slug === "string" && input.slug === fresh?.shareSlug;
      // A team quiz is only played through a team game, never alone through a link.
      if (!fresh || fresh.status !== "live" || !viaLink || fresh.mode === "team") {
        throw notFound("Quiz", "QUIZ_NOT_FOUND");
      }
    }
    const cards = await CustomQuizCardModel.find({ quizId: String(quiz._id) }).lean();
    return {
      sourceType: "custom",
      sourceId: String(quiz._id),
      title: quiz.title,
      // An AI generated trivia has no other players: its owner's plays are real plays.
      isPreview: isOwner && quiz.origin !== "ai",
      defaults: { timerSeconds: quiz.defaultTimerSeconds, cardCount: quiz.defaultCardCount },
      brand: null,
      cards: toCards(cards),
    };
  }

  if (input.sourceType === "campaign") {
    if (!isObjectId(input.sourceId)) throw notFound("Campaign", "CAMPAIGN_NOT_FOUND");
    const campaign = await CampaignModel.findById(input.sourceId);
    if (!campaign) throw notFound("Campaign", "CAMPAIGN_NOT_FOUND");

    const isPreview = campaign.brandId === playerId || player.role === "admin";
    if (!isPreview && !isServable(campaign)) {
      throw new ErrorHandler("This campaign is not running", 404, "CAMPAIGN_NOT_AVAILABLE");
    }
    const cards = await CampaignCardModel.find({ campaignId: String(campaign._id) }).lean();
    return {
      sourceType: "campaign",
      sourceId: String(campaign._id),
      title: campaign.title,
      isPreview,
      defaults: {},
      fixedTimerSeconds: campaignTimerSeconds(campaign),
      brand: publicCampaign(campaign),
      cards: toCards(cards),
    };
  }

  throw new ErrorHandler('sourceType must be "topic", "custom" or "campaign"', 400, "INVALID_SOURCE");
}

/** Brand block for an existing campaign attempt (session and result screen). */
export async function brandForAttempt(sourceType: string, sourceId: string) {
  if (sourceType !== "campaign") return null;
  const campaign = await CampaignModel.findById(sourceId).lean();
  return campaign ? publicCampaign(campaign) : null;
}

export async function titleForAttempt(sourceType: string, sourceId: string): Promise<string | null> {
  if (sourceType === "topic") {
    return (await TriviaTopicModel.findById(sourceId).select("name").lean())?.name || null;
  }
  if (sourceType === "custom") {
    return (await CustomQuizModel.findById(sourceId).select("title").lean())?.title || null;
  }
  return (await CampaignModel.findById(sourceId).select("title").lean())?.title || null;
}
