import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import CampaignModel, { ICampaign } from "../models/campaign.model";
import CampaignCardModel from "../models/campaignCard.model";
import BrandModel from "../models/brand.model";
import PaymentModel from "../models/payment.model";
import {
  assertObjectId,
  cleanString,
  parseHttpUrl,
  requireString,
  toInt,
} from "../utils/validators";
import { resolveImage } from "../services/upload/image.service";
import { buildBulkCards, buildCardContent, editorCard } from "../services/trivia/cardInput";
import { cardCountBounds } from "../services/trivia/session.service";
import { startCheckout } from "../services/payment/payment.service";
import {
  getCampaignMinCards,
  getCampaignPricing,
  getTimerRange,
  isValidTimerSeconds,
} from "../services/config/config.service";
import {
  getCampaignGateState,
  campaignTimerSeconds,
  getCampaignStats,
  isServable,
  pickCampaignForPlayer,
  publicCampaign,
  recordUrlClick,
} from "../services/campaign/campaign.service";

// A pending checkout younger than this is handed back instead of opening a second one,
// so an impatient double click cannot charge a brand twice for the same campaign.
const CHECKOUT_REUSE_MS = 30 * 60 * 1000;

const brandCampaign = (campaign: any, cardCount: number) => ({
  id: String(campaign._id),
  brandName: campaign.brandName,
  logoUrl: campaign.logoUrl,
  websiteUrl: campaign.websiteUrl,
  ctaText: campaign.ctaText || null,
  title: campaign.title,
  description: campaign.description || null,
  coverImageUrl: campaign.coverImageUrl || null,
  tags: campaign.tags || [],
  timerSeconds: campaignTimerSeconds(campaign),
  // A live campaign past its end date reads as ended even before the scheduler runs.
  status:
    campaign.status === "live" && !isServable(campaign) ? "ended" : campaign.status,
  startsAt: campaign.startsAt || null,
  endsAt: campaign.endsAt || null,
  moderationReason: campaign.moderationReason || null,
  cardCount,
  createdAt: campaign.createdAt,
  updatedAt: campaign.updatedAt,
});

/** Loads a campaign owned by the calling brand. 404 for any other brand. */
async function loadOwnedCampaign(req: Request): Promise<ICampaign> {
  const campaign = await CampaignModel.findOne({
    _id: assertObjectId(req.params.id, "campaign id"),
    brandId: String(req.user!._id),
  });
  if (!campaign) throw new ErrorHandler("Campaign not found", 404, "CAMPAIGN_NOT_FOUND");
  return campaign;
}

function assertDraft(campaign: ICampaign) {
  if (campaign.status !== "draft") {
    throw new ErrorHandler(
      "A campaign can only be edited while it is a draft",
      409,
      "CAMPAIGN_NOT_EDITABLE",
      { status: campaign.status }
    );
  }
}

function parseTags(raw: any): string[] | undefined {
  if (raw === undefined) return undefined;
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = value.split(",");
    }
  }
  if (!Array.isArray(value) || value.length > 8) {
    throw new ErrorHandler("tags must be a list of at most 8 short labels", 400);
  }
  const tags = value
    .map((t: any) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
    .filter(Boolean);
  if (tags.some((t: string) => t.length > 24)) {
    throw new ErrorHandler("Each tag must be at most 24 characters", 400);
  }
  return Array.from(new Set<string>(tags));
}

/** Seconds per question chosen by the brand: 0 (no timer) up to the global maximum. */
function parseTimer(value: any): number {
  const timer = toInt(value);
  if (!isValidTimerSeconds(timer)) {
    const { minSeconds, maxSeconds } = getTimerRange();
    throw new ErrorHandler(
      `timerSeconds must be a whole number from ${minSeconds} to ${maxSeconds}`,
      400,
      "INVALID_TIMER",
      { minSeconds, maxSeconds }
    );
  }
  return timer;
}

const fileOf = (req: Request, field: string) =>
  ((req.files as Record<string, Express.Multer.File[]> | undefined) || {})[field]?.[0];

// GET /brand/campaigns/pricing — the flat price and duration
export const getPricing = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    pricing: await getCampaignPricing(),
    minCardsToPublish: await getCampaignMinCards(),
  });
});

// POST /brand/campaigns  (multipart with optional "logo" and "cover" files, or JSON)
// Brand name, logo and website default to the brand profile when omitted.
export const createCampaign = CatchAsyncError(async (req: Request, res: Response) => {
  const brandId = String(req.user!._id);
  const body = req.body || {};
  const profile = await BrandModel.findOne({ userId: brandId }).lean();

  const logoUrl =
    (await resolveImage(fileOf(req, "logo"), body.logoUrl, brandId, "logos")) || profile?.logoUrl;
  if (!logoUrl) throw new ErrorHandler("A brand logo is required", 400, "IMAGE_REQUIRED");

  const website = body.websiteUrl || profile?.websiteUrl;
  const campaign = await CampaignModel.create({
    brandId,
    brandName: requireString(body.brandName || profile?.companyName, "brandName", 80),
    logoUrl,
    websiteUrl: parseHttpUrl(website, "websiteUrl"),
    ctaText: cleanString(body.ctaText, 40),
    title: requireString(body.title, "title", 80),
    description: cleanString(body.description, 300),
    coverImageUrl: await resolveImage(fileOf(req, "cover"), body.coverImageUrl, brandId, "covers"),
    tags: parseTags(body.tags) || [],
    ...(body.timerSeconds !== undefined ? { timerSeconds: parseTimer(body.timerSeconds) } : {}),
  });
  res.status(201).json({ success: true, campaign: brandCampaign(campaign, 0) });
});

// GET /brand/campaigns
export const listMyCampaigns = CatchAsyncError(async (req: Request, res: Response) => {
  const campaigns = await CampaignModel.find({ brandId: String(req.user!._id) })
    .sort({ createdAt: -1 })
    .lean();
  const counts = await CampaignCardModel.aggregate([
    { $match: { campaignId: { $in: campaigns.map((c) => String(c._id)) } } },
    { $group: { _id: "$campaignId", count: { $sum: 1 } } },
  ]);
  const countOf = new Map(counts.map((c) => [c._id, c.count]));
  res.status(200).json({
    success: true,
    campaigns: campaigns.map((c) => brandCampaign(c, countOf.get(String(c._id)) || 0)),
  });
});

// GET /brand/campaigns/:id  and  /brand/campaigns/:id/preview — everything, answers included
export const getMyCampaign = CatchAsyncError(async (req: Request, res: Response) => {
  const campaign = await loadOwnedCampaign(req);
  const cards = await CampaignCardModel.find({ campaignId: String(campaign._id) })
    .sort({ createdAt: 1 })
    .lean();
  res.status(200).json({
    success: true,
    campaign: brandCampaign(campaign, cards.length),
    cards: cards.map(editorCard),
    pricing: await getCampaignPricing(),
    minCardsToPublish: await getCampaignMinCards(),
    cardCountBounds: await cardCountBounds(cards.length),
  });
});

// PATCH /brand/campaigns/:id — draft only
export const updateCampaign = CatchAsyncError(async (req: Request, res: Response) => {
  const campaign = await loadOwnedCampaign(req);
  assertDraft(campaign);
  const brandId = campaign.brandId;
  const body = req.body || {};

  if (body.brandName !== undefined) campaign.brandName = requireString(body.brandName, "brandName", 80);
  if (body.title !== undefined) campaign.title = requireString(body.title, "title", 80);
  if (body.websiteUrl !== undefined) campaign.websiteUrl = parseHttpUrl(body.websiteUrl, "websiteUrl");
  if (body.ctaText !== undefined) campaign.ctaText = cleanString(body.ctaText, 40);
  if (body.description !== undefined) campaign.description = cleanString(body.description, 300);
  const tags = parseTags(body.tags);
  if (tags) campaign.tags = tags;
  if (body.timerSeconds !== undefined) campaign.timerSeconds = parseTimer(body.timerSeconds);
  const logo = await resolveImage(fileOf(req, "logo"), body.logoUrl, brandId, "logos");
  if (logo) campaign.logoUrl = logo;
  const cover = await resolveImage(fileOf(req, "cover"), body.coverImageUrl, brandId, "covers");
  if (cover) campaign.coverImageUrl = cover;

  await campaign.save();
  const count = await CampaignCardModel.countDocuments({ campaignId: String(campaign._id) });
  res.status(200).json({ success: true, campaign: brandCampaign(campaign, count) });
});

// DELETE /brand/campaigns/:id — draft only
export const deleteCampaign = CatchAsyncError(async (req: Request, res: Response) => {
  const campaign = await loadOwnedCampaign(req);
  assertDraft(campaign);
  await CampaignCardModel.deleteMany({ campaignId: String(campaign._id) });
  await campaign.deleteOne();
  res.status(200).json({ success: true });
});

// --- Cards (draft only) -------------------------------------------------------------

// POST /brand/campaigns/:id/cards  (multipart with "image", or JSON)
export const createCard = CatchAsyncError(async (req: Request, res: Response) => {
  const campaign = await loadOwnedCampaign(req);
  assertDraft(campaign);
  const content = await buildCardContent(req.body, req.file, campaign.brandId, "cards");
  const card = await CampaignCardModel.create({ campaignId: String(campaign._id), ...content });
  res.status(201).json({ success: true, card: editorCard(card) });
});

// POST /brand/campaigns/:id/cards/bulk  { cards: [...] }
export const bulkCreateCards = CatchAsyncError(async (req: Request, res: Response) => {
  const campaign = await loadOwnedCampaign(req);
  assertDraft(campaign);
  const contents = await buildBulkCards(req.body, campaign.brandId, "cards");
  const cards = await CampaignCardModel.insertMany(
    contents.map((content) => ({ campaignId: String(campaign._id), ...content }))
  );
  res.status(201).json({ success: true, created: cards.length, cards: cards.map(editorCard) });
});

async function loadCampaignCard(campaign: ICampaign, cardId: string) {
  const card = await CampaignCardModel.findOne({
    _id: assertObjectId(cardId, "card id"),
    campaignId: String(campaign._id),
  });
  if (!card) throw new ErrorHandler("Card not found", 404, "CARD_NOT_FOUND");
  return card;
}

// PATCH /brand/campaigns/:id/cards/:cardId
export const updateCard = CatchAsyncError(async (req: Request, res: Response) => {
  const campaign = await loadOwnedCampaign(req);
  assertDraft(campaign);
  const card = await loadCampaignCard(campaign, req.params.cardId);
  const content = await buildCardContent(req.body, req.file, campaign.brandId, "cards", card);
  card.set(content);
  if (content.type === "definition") card.imageUrl = undefined;
  await card.save();
  res.status(200).json({ success: true, card: editorCard(card) });
});

// DELETE /brand/campaigns/:id/cards/:cardId
export const deleteCard = CatchAsyncError(async (req: Request, res: Response) => {
  const campaign = await loadOwnedCampaign(req);
  assertDraft(campaign);
  const card = await loadCampaignCard(campaign, req.params.cardId);
  await card.deleteOne();
  res.status(200).json({ success: true });
});

// --- Payment --------------------------------------------------------------------------

// POST /brand/campaigns/:id/checkout  { idempotencyKey? }
// draft -> awaiting_payment. The campaign goes live only when the payment is confirmed
// by the gateway (webhook or server-side verification) — never from this response.
export const startCampaignCheckout = CatchAsyncError(async (req: Request, res: Response) => {
  const campaign = await loadOwnedCampaign(req);
  if (campaign.status !== "draft" && campaign.status !== "awaiting_payment") {
    throw new ErrorHandler(
      "This campaign has already been paid for or is not payable",
      409,
      "CAMPAIGN_NOT_PAYABLE",
      { status: campaign.status }
    );
  }

  const min = await getCampaignMinCards();
  const count = await CampaignCardModel.countDocuments({ campaignId: String(campaign._id) });
  if (count < min) {
    throw new ErrorHandler(
      `A campaign needs at least ${min} cards before it can be published.`,
      400,
      "MIN_CARDS_REQUIRED",
      { minCards: min, cardCount: count }
    );
  }

  const respond = (payment: any, authorizationUrl: string, created: boolean) =>
    res.status(created ? 201 : 200).json({
      success: true,
      checkout: {
        authorizationUrl,
        reference: payment.reference,
        payment: {
          id: String(payment._id),
          purpose: payment.purpose,
          campaignId: payment.campaignId,
          amount: payment.amount,
          currency: payment.currency,
          durationDays: payment.durationDays,
          status: payment.status,
        },
      },
      campaign: { id: String(campaign._id), status: "awaiting_payment" },
    });

  const idempotencyKey = cleanString(req.body?.idempotencyKey, 100);
  if (!idempotencyKey) {
    const recent = await PaymentModel.findOne({
      campaignId: String(campaign._id),
      userId: campaign.brandId,
      status: "pending",
      authorizationUrl: { $exists: true },
      createdAt: { $gt: new Date(Date.now() - CHECKOUT_REUSE_MS) },
    }).sort({ createdAt: -1 });
    if (recent) return respond(recent, recent.authorizationUrl!, false);
  }

  const checkout = await startCheckout({
    user: { _id: req.user!._id, email: req.user!.email },
    purpose: "campaign",
    campaignId: String(campaign._id),
    idempotencyKey,
  });
  await CampaignModel.updateOne(
    { _id: campaign._id, status: "draft" },
    { $set: { status: "awaiting_payment" } }
  );
  respond(checkout.payment, checkout.authorizationUrl, !checkout.reused);
});

// POST /brand/campaigns/:id/cancel-checkout — awaiting_payment -> draft, to edit again
export const cancelCampaignCheckout = CatchAsyncError(async (req: Request, res: Response) => {
  const campaign = await loadOwnedCampaign(req);
  await CampaignModel.updateOne(
    { _id: campaign._id, status: "awaiting_payment" },
    { $set: { status: "draft" } }
  );
  const fresh = (await CampaignModel.findById(campaign._id).lean())!;
  const count = await CampaignCardModel.countDocuments({ campaignId: String(campaign._id) });
  res.status(200).json({ success: true, campaign: brandCampaign(fresh, count) });
});

// GET /brand/campaigns/:id/dashboard
export const getDashboard = CatchAsyncError(async (req: Request, res: Response) => {
  const campaign = await loadOwnedCampaign(req);
  const count = await CampaignCardModel.countDocuments({ campaignId: String(campaign._id) });
  res.status(200).json({
    success: true,
    campaign: brandCampaign(campaign, count),
    dashboard: await getCampaignStats(campaign),
  });
});

// --- Players --------------------------------------------------------------------------

// GET /campaigns/next — whether a campaign is owed, and which campaign to play next
export const getNextCampaign = CatchAsyncError(async (req: Request, res: Response) => {
  const gate = await getCampaignGateState(req.user!);
  const suggestion =
    gate.campaign ||
    (await pickCampaignForPlayer(String(req.user!._id)).then((c) => (c ? publicCampaign(c) : null)));
  res.status(200).json({
    success: true,
    required: gate.required,
    counter: gate.counter,
    threshold: gate.threshold,
    campaign: suggestion,
  });
});

// GET /campaigns/:id — brand info for a running campaign (no cards)
export const getCampaignInfo = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const campaign = await CampaignModel.findById(assertObjectId(req.params.id, "campaign id"));
    if (!campaign || !isServable(campaign)) {
      return next(new ErrorHandler("This campaign is not running", 404, "CAMPAIGN_NOT_AVAILABLE"));
    }
    const count = await CampaignCardModel.countDocuments({ campaignId: String(campaign._id) });
    res.status(200).json({
      success: true,
      campaign: publicCampaign(campaign),
      cardCountBounds: await cardCountBounds(count),
    });
  }
);

// POST /campaigns/:id/click — counts the click and returns the URL to open in a new tab
export const postUrlClick = CatchAsyncError(async (req: Request, res: Response) => {
  const url = await recordUrlClick(
    assertObjectId(req.params.id, "campaign id"),
    String(req.user!._id)
  );
  res.status(200).json({ success: true, url });
});
