import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import CampaignModel from "../models/campaign.model";
import CampaignCardModel from "../models/campaignCard.model";
import PaymentModel from "../models/payment.model";
import { assertObjectId, requireString } from "../utils/validators";
import { editorCard } from "../services/trivia/cardInput";
import { getCampaignStats, isServable } from "../services/campaign/campaign.service";

// Every route that uses this controller is mounted behind
// isAuthenticated + authorizeRoles("admin") in routes/admin.route.ts.

const CAMPAIGN_STATUSES = ["draft", "awaiting_payment", "live", "ended", "paused", "taken_down"];

const adminCampaign = (campaign: any) => ({
  id: String(campaign._id),
  brandId: campaign.brandId,
  brandName: campaign.brandName,
  logoUrl: campaign.logoUrl,
  websiteUrl: campaign.websiteUrl,
  ctaText: campaign.ctaText || null,
  title: campaign.title,
  description: campaign.description || null,
  coverImageUrl: campaign.coverImageUrl || null,
  tags: campaign.tags || [],
  status: campaign.status === "live" && !isServable(campaign) ? "ended" : campaign.status,
  paymentId: campaign.paymentId || null,
  startsAt: campaign.startsAt || null,
  endsAt: campaign.endsAt || null,
  moderationReason: campaign.moderationReason || null,
  moderatedBy: campaign.moderatedBy || null,
  moderatedAt: campaign.moderatedAt || null,
  urlClicks: campaign.urlClicks,
  createdAt: campaign.createdAt,
});

// GET /admin/campaigns?status=live&page=1&limit=50
export const listCampaigns = CatchAsyncError(async (req: Request, res: Response) => {
  const filter: Record<string, any> = {};
  if (typeof req.query.status === "string") {
    if (!CAMPAIGN_STATUSES.includes(req.query.status)) {
      throw new ErrorHandler(`status must be one of: ${CAMPAIGN_STATUSES.join(", ")}`, 400);
    }
    filter.status = req.query.status;
  }
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);

  const [campaigns, total] = await Promise.all([
    CampaignModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CampaignModel.countDocuments(filter),
  ]);
  res.status(200).json({
    success: true,
    page,
    limit,
    total,
    campaigns: campaigns.map(adminCampaign),
  });
});

async function loadCampaign(id: string) {
  const campaign = await CampaignModel.findById(assertObjectId(id, "campaign id"));
  if (!campaign) throw new ErrorHandler("Campaign not found", 404, "CAMPAIGN_NOT_FOUND");
  return campaign;
}

// GET /admin/campaigns/:id — the campaign, its cards and its numbers
export const getCampaign = CatchAsyncError(async (req: Request, res: Response) => {
  const campaign = await loadCampaign(req.params.id);
  const cards = await CampaignCardModel.find({ campaignId: String(campaign._id) })
    .sort({ createdAt: 1 })
    .lean();
  res.status(200).json({
    success: true,
    campaign: adminCampaign(campaign),
    cards: cards.map(editorCard),
    dashboard: await getCampaignStats(campaign),
  });
});

async function moderate(
  req: Request,
  from: string[],
  to: "paused" | "taken_down",
  next: NextFunction
) {
  const reason = requireString(req.body?.reason, "reason", 500);
  const campaign = await loadCampaign(req.params.id);
  const updated = await CampaignModel.findOneAndUpdate(
    { _id: campaign._id, status: { $in: from } },
    {
      $set: {
        status: to,
        moderationReason: reason,
        moderatedBy: String(req.user!._id),
        moderatedAt: new Date(),
      },
    },
    { new: true }
  );
  if (!updated) {
    return next(
      new ErrorHandler(
        `A campaign that is ${campaign.status} cannot be ${to === "paused" ? "paused" : "taken down"}`,
        409,
        "INVALID_CAMPAIGN_STATE",
        { status: campaign.status }
      )
    );
  }
  return updated;
}

// POST /admin/campaigns/:id/pause  { reason } — stops delivery; the paid window keeps running
export const pauseCampaign = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const updated = await moderate(req, ["live"], "paused", next);
    if (updated) res.status(200).json({ success: true, campaign: adminCampaign(updated) });
  }
);

// POST /admin/campaigns/:id/resume — paused -> live (or ended if its window is over)
export const resumeCampaign = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const campaign = await loadCampaign(req.params.id);
    const expired = !campaign.endsAt || campaign.endsAt.getTime() <= Date.now();
    const updated = await CampaignModel.findOneAndUpdate(
      { _id: campaign._id, status: "paused" },
      { $set: { status: expired ? "ended" : "live", moderatedBy: String(req.user!._id), moderatedAt: new Date() } },
      { new: true }
    );
    if (!updated) {
      return next(
        new ErrorHandler("Only a paused campaign can be resumed", 409, "INVALID_CAMPAIGN_STATE", {
          status: campaign.status,
        })
      );
    }
    res.status(200).json({ success: true, campaign: adminCampaign(updated) });
  }
);

// POST /admin/campaigns/:id/takedown  { reason } — permanent removal for a rule breach
export const takeDownCampaign = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const updated = await moderate(
      req,
      ["draft", "awaiting_payment", "live", "paused", "ended"],
      "taken_down",
      next
    );
    if (updated) res.status(200).json({ success: true, campaign: adminCampaign(updated) });
  }
);

function parseDate(value: any, label: string): Date | undefined {
  if (value === undefined || value === "") return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ErrorHandler(`${label} must be a valid date`, 400);
  return date;
}

// GET /admin/revenue?from=2026-01-01&to=2026-02-01 — confirmed payments by purpose and currency
export const getRevenueSummary = CatchAsyncError(async (req: Request, res: Response) => {
  const from = parseDate(req.query.from, "from");
  const to = parseDate(req.query.to, "to");
  const paidAt: Record<string, Date> = {};
  if (from) paidAt.$gte = from;
  if (to) paidAt.$lt = to;

  const rows = await PaymentModel.aggregate([
    { $match: { status: "success", ...(from || to ? { paidAt } : {}) } },
    {
      $group: {
        _id: { purpose: "$purpose", currency: "$currency" },
        payments: { $sum: 1 },
        total: { $sum: "$amount" },
      },
    },
    { $sort: { "_id.purpose": 1, "_id.currency": 1 } },
  ]);

  const totalsByCurrency: Record<string, number> = {};
  const breakdown = rows.map((row) => {
    totalsByCurrency[row._id.currency] =
      Math.round(((totalsByCurrency[row._id.currency] || 0) + row.total) * 100) / 100;
    return {
      purpose: row._id.purpose,
      currency: row._id.currency,
      payments: row.payments,
      total: Math.round(row.total * 100) / 100,
    };
  });

  res.status(200).json({
    success: true,
    range: { from: from || null, to: to || null },
    breakdown,
    totalsByCurrency,
    pendingPayments: await PaymentModel.countDocuments({ status: "pending" }),
  });
});

// GET /admin/payments?status=success&purpose=pro&page=1&limit=50
export const listPayments = CatchAsyncError(async (req: Request, res: Response) => {
  const filter: Record<string, any> = {};
  if (typeof req.query.status === "string") {
    if (!["pending", "success", "failed"].includes(req.query.status)) {
      throw new ErrorHandler("status must be pending, success or failed", 400);
    }
    filter.status = req.query.status;
  }
  if (typeof req.query.purpose === "string") {
    if (!["pro", "campaign"].includes(req.query.purpose)) {
      throw new ErrorHandler("purpose must be pro or campaign", 400);
    }
    filter.purpose = req.query.purpose;
  }
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);

  const [payments, total] = await Promise.all([
    PaymentModel.find(filter)
      .select("-gatewayResponse -authorizationUrl -idempotencyKey")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PaymentModel.countDocuments(filter),
  ]);
  res.status(200).json({ success: true, page, limit, total, payments });
});
