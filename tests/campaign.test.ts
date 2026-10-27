import sharp from "sharp";
import mongoose from "mongoose";
import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import {
  api,
  createUser,
  createTopic,
  createCampaign,
  liveWindow,
  resetState,
  signedWebhook,
  chargeSuccess,
  startTrivia,
  playSession,
  completeTopicPlay,
  allKeys,
  DAY_MS,
  TestUser,
} from "./helpers";
import userModel from "../models/user.model";
import CampaignModel from "../models/campaign.model";
import CampaignPlayModel from "../models/campaignPlay.model";
import PaymentModel from "../models/payment.model";
import { paystackService } from "../services/payment";
import { expireCampaigns } from "../services/campaign/campaign.service";

const brandBase = "/api/v1/brand/campaigns";
const counterOf = async (user: TestUser) =>
  (await userModel.findById(user.id).lean())!.nonCampaignPlaysSinceCampaign;
const setCounter = (user: TestUser, n: number) =>
  userModel.updateOne({ _id: user.id }, { nonCampaignPlaysSinceCampaign: n });
const startTopic = (user: TestUser, topicId: string) =>
  startTrivia(user, { sourceType: "topic", sourceId: topicId, timerSeconds: 5, cardCount: 5 });
const startCampaign = (user: TestUser, campaignId: string) =>
  startTrivia(user, { sourceType: "campaign", sourceId: campaignId, timerSeconds: 5, cardCount: 5 });

describe("Brand campaigns", () => {
  let brand: TestUser;
  let topicId: string;

  beforeAll(connectTestDB);
  beforeEach(async () => {
    jest.spyOn(paystackService, "initialize").mockImplementation(async (p) => ({
      success: true,
      authorizationUrl: `https://checkout.test/${p.reference}`,
      reference: p.reference,
    }));
    brand = await createUser({ role: "brand" });
    topicId = await createTopic(8);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await resetState();
  });
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  describe("lifecycle and payment", () => {
    async function draftWithCards(cards = 6) {
      const logo = await sharp({
        create: { width: 64, height: 64, channels: 3, background: "#ff0000" },
      })
        .png()
        .toBuffer();
      const created = await api()
        .post(brandBase)
        .set(brand.auth)
        .field("title", "Spring launch")
        .field("brandName", "Acme")
        .field("websiteUrl", "https://acme.example/spring")
        .field("ctaText", "Visit our site")
        .attach("logo", logo, { filename: "logo.png", contentType: "image/png" });
      expect(created.status).toBe(201);
      const id = created.body.campaign.id as string;
      if (cards > 0) {
        const bulk = await api()
          .post(`${brandBase}/${id}/cards/bulk`)
          .set(brand.auth)
          .send({
            cards: Array.from({ length: cards }, (_, i) => ({
              type: "definition",
              text: `Acme fact ${i}`,
              options: ["True", "False"],
              correctOptionIndex: 0,
            })),
          });
        expect(bulk.status).toBe(201);
      }
      return id;
    }

    it("shows the flat price and lets a brand build and preview a draft", async () => {
      const pricing = await api().get(`${brandBase}/pricing`).set(brand.auth);
      expect(pricing.body.pricing).toEqual({ amount: 15000, currency: "NGN", durationDays: 30 });

      const id = await draftWithCards();
      const preview = await api().get(`${brandBase}/${id}/preview`).set(brand.auth);
      expect(preview.body.campaign).toMatchObject({
        status: "draft",
        brandName: "Acme",
        websiteUrl: "https://acme.example/spring",
        ctaText: "Visit our site",
        cardCount: 6,
      });
      expect(preview.body.campaign.logoUrl).toMatch(/\.webp$/);
      expect(preview.body.cards[0]).toHaveProperty("correctOptionIndex");

      // The brand can test-play its own draft.
      const test = await startCampaign(brand, id);
      expect(test.status).toBe(201);
      expect(test.body.session.isPreview).toBe(true);
    });

    it("lets the brand set the timer from 0 to 15 seconds, 15 by default", async () => {
      const id = await draftWithCards(0);
      const created = await api().get(`${brandBase}/${id}`).set(brand.auth);
      expect(created.body.campaign.timerSeconds).toBe(15);

      for (const timerSeconds of [0, 7, 15]) {
        const res = await api().patch(`${brandBase}/${id}`).set(brand.auth).send({ timerSeconds });
        expect(res.status).toBe(200);
        expect(res.body.campaign.timerSeconds).toBe(timerSeconds);
      }
      for (const timerSeconds of [-1, 16, 2.5, "fast"]) {
        const res = await api().patch(`${brandBase}/${id}`).set(brand.auth).send({ timerSeconds });
        expect(res.body.code).toBe("INVALID_TIMER");
      }

      const withTimer = await api()
        .post(brandBase)
        .set(brand.auth)
        .send({ title: "T", brandName: "Acme", websiteUrl: "https://acme.example/", logoUrl: created.body.campaign.logoUrl, timerSeconds: 0 });
      expect(withTimer.status).toBe(201);
      expect(withTimer.body.campaign.timerSeconds).toBe(0);
    });

    it("only accepts http(s) brand URLs", async () => {
      const send = (websiteUrl: string) =>
        api().post(brandBase).set(brand.auth).send({ title: "T", brandName: "Acme", websiteUrl, logoUrl: "x" });
      for (const bad of ["javascript:alert(1)", "data:text/html,hi", "ftp://acme.example", "//acme.example", "acme", "https://user:pw@acme.example"]) {
        const res = await send(bad);
        expect(res.status).toBe(400);
      }
      expect(await CampaignModel.countDocuments({})).toBe(0);
    });

    it("needs the minimum number of cards before checkout", async () => {
      const id = await draftWithCards(2);
      const res = await api().post(`${brandBase}/${id}/checkout`).set(brand.auth).send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("MIN_CARDS_REQUIRED");
      expect(await PaymentModel.countDocuments({})).toBe(0);
    });

    it("goes live only after the payment is confirmed, for exactly 30 days from the payment time", async () => {
      const id = await draftWithCards();
      const player = await createUser();
      await setCounter(player, 10);

      const checkout = await api().post(`${brandBase}/${id}/checkout`).set(brand.auth).send({});
      expect(checkout.status).toBe(201);
      expect(checkout.body.checkout.payment).toMatchObject({ amount: 15000, currency: "NGN", purpose: "campaign" });
      const reference = checkout.body.checkout.reference;

      // Awaiting payment: not live, not served, nobody is gated by it.
      let campaign = await CampaignModel.findById(id).lean();
      expect(campaign!.status).toBe("awaiting_payment");
      expect(campaign!.startsAt).toBeUndefined();
      expect((await startCampaign(player, id)).status).toBe(404);
      expect((await startTopic(player, topicId)).status).toBe(201);
      await api().post(`/api/v1/trivia/sessions/${(await startTopic(player, topicId)).body.session.id}/abandon`).set(player.auth);

      // An unsigned "payment succeeded" call does nothing.
      await api().post("/api/v1/payments/webhook/paystack").send(chargeSuccess(reference, 15000, new Date()));
      expect((await CampaignModel.findById(id).lean())!.status).toBe("awaiting_payment");

      const paidAt = new Date(Date.now() - 5000);
      await signedWebhook(chargeSuccess(reference, 15000, paidAt));
      campaign = await CampaignModel.findById(id).lean();
      expect(campaign!.status).toBe("live");
      expect(campaign!.startsAt!.getTime()).toBe(paidAt.getTime());
      expect(campaign!.endsAt!.getTime()).toBe(paidAt.getTime() + 30 * DAY_MS);
      expect(campaign!.paymentId).toBe(String((await PaymentModel.findOne({ reference }).lean())!._id));

      // A second delivery (even with a different timestamp) cannot re-activate or move the window.
      await signedWebhook(chargeSuccess(reference, 15000, new Date(Date.now() + 5 * DAY_MS)));
      await signedWebhook(chargeSuccess(reference, 15000, paidAt));
      const again = await CampaignModel.findById(id).lean();
      expect(again!.startsAt!.getTime()).toBe(paidAt.getTime());
      expect(again!.endsAt!.getTime()).toBe(paidAt.getTime() + 30 * DAY_MS);

      // Live campaigns are frozen.
      const edit = await api().patch(`${brandBase}/${id}`).set(brand.auth).send({ title: "Changed" });
      expect(edit.status).toBe(409);
      expect(edit.body.code).toBe("CAMPAIGN_NOT_EDITABLE");
      const repay = await api().post(`${brandBase}/${id}/checkout`).set(brand.auth).send({});
      expect(repay.body.code).toBe("CAMPAIGN_NOT_PAYABLE");
    });

    it("does not open a second checkout on a double click", async () => {
      const id = await draftWithCards();

      const first = await api().post(`${brandBase}/${id}/checkout`).set(brand.auth).send({});
      const second = await api().post(`${brandBase}/${id}/checkout`).set(brand.auth).send({});
      expect(second.status).toBe(200);
      expect(second.body.checkout.reference).toBe(first.body.checkout.reference);
      expect(await PaymentModel.countDocuments({ campaignId: id })).toBe(1);

      await signedWebhook(chargeSuccess(first.body.checkout.reference, 15000, new Date()));
      expect((await CampaignModel.findById(id).lean())!.status).toBe("live");
    });

    it("rejects a campaign payment with the wrong amount", async () => {
      const id = await draftWithCards();
      const checkout = await api().post(`${brandBase}/${id}/checkout`).set(brand.auth).send({});
      await signedWebhook(chargeSuccess(checkout.body.checkout.reference, 1, new Date()));
      expect((await CampaignModel.findById(id).lean())!.status).toBe("awaiting_payment");
    });

    it("lets a brand step back from checkout to keep editing", async () => {
      const id = await draftWithCards();
      await api().post(`${brandBase}/${id}/checkout`).set(brand.auth).send({});
      const cancelled = await api().post(`${brandBase}/${id}/cancel-checkout`).set(brand.auth);
      expect(cancelled.body.campaign.status).toBe("draft");
      const edit = await api().patch(`${brandBase}/${id}`).set(brand.auth).send({ title: "Better title" });
      expect(edit.body.campaign.title).toBe("Better title");
    });
  });

  describe("automatic end", () => {
    it("never serves a campaign past its end date, even before the job runs", async () => {
      const id = await createCampaign(brand.id, {
        status: "live",
        startsAt: new Date(Date.now() - 31 * DAY_MS),
        endsAt: new Date(Date.now() - 1000),
      });
      const player = await createUser();
      await setCounter(player, 10);

      expect((await CampaignModel.findById(id).lean())!.status).toBe("live"); // job has not run
      expect((await startCampaign(player, id)).body.code).toBe("CAMPAIGN_NOT_AVAILABLE");
      expect((await api().get(`/api/v1/campaigns/${id}`).set(player.auth)).status).toBe(404);
      const next = await api().get("/api/v1/campaigns/next").set(player.auth);
      expect(next.body).toMatchObject({ required: false, campaign: null });
      expect((await startTopic(player, topicId)).status).toBe(201);

      const dashboard = await api().get(`${brandBase}/${id}/dashboard`).set(brand.auth);
      expect(dashboard.body.dashboard).toMatchObject({ status: "ended", daysRemaining: 0 });
    });

    it("is marked ended by the scheduled job", async () => {
      const expired = await createCampaign(brand.id, {
        status: "live",
        startsAt: new Date(Date.now() - 31 * DAY_MS),
        endsAt: new Date(Date.now() - 1000),
      });
      const running = await createCampaign(brand.id, liveWindow());
      expect(await expireCampaigns()).toBe(1);
      expect((await CampaignModel.findById(expired).lean())!.status).toBe("ended");
      expect((await CampaignModel.findById(running).lean())!.status).toBe("live");
    });
  });

  describe("the interruption rule", () => {
    it("blocks a freemium player with CAMPAIGN_REQUIRED once N non-campaign trivias are done", async () => {
      const campaignId = await createCampaign(brand.id, liveWindow());
      const player = await createUser();
      await setCounter(player, 8);

      // 9th and 10th plays are allowed and counted.
      expect((await completeTopicPlay(player, topicId)).status).toBe(201);
      expect((await completeTopicPlay(player, topicId)).status).toBe(201);
      expect(await counterOf(player)).toBe(10);

      const blocked = await startTopic(player, topicId);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe("CAMPAIGN_REQUIRED");
      expect(blocked.body.details).toMatchObject({
        counter: 10,
        threshold: 10,
        campaign: { id: campaignId, brandName: "Acme", websiteUrl: "https://acme.example/" },
      });
      expect(allKeys(blocked.body).has("correctOptionIndex")).toBe(false);

      const next = await api().get("/api/v1/campaigns/next").set(player.auth);
      expect(next.body).toMatchObject({ required: true, campaign: { id: campaignId } });
    });

    it("clears the block and resets the counter when the campaign trivia is completed", async () => {
      const campaignId = await createCampaign(brand.id, liveWindow());
      const player = await createUser();
      await setCounter(player, 12);
      expect((await startTopic(player, topicId)).body.code).toBe("CAMPAIGN_REQUIRED");

      const session = await startCampaign(player, campaignId);
      expect(session.status).toBe(201);
      expect(session.body.session.brand).toMatchObject({ brandName: "Acme", logoUrl: expect.any(String) });

      // Starting or abandoning it is not enough.
      expect((await startTopic(player, topicId)).body.code).toBe("CAMPAIGN_REQUIRED");

      const state = await api().get(`/api/v1/trivia/sessions/${session.body.session.id}`).set(player.auth);
      expect(state.body.session.brand.websiteUrl).toBe("https://acme.example/");
      const result = await playSession(player, session.body.session.id, (i) => i !== 0);
      expect(result).toMatchObject({ correct: 4, total: 5, brand: { brandName: "Acme" } });
      expect(result.campaignGate).toMatchObject({ required: false, counter: 0 });

      expect(await counterOf(player)).toBe(0);
      expect((await startTopic(player, topicId)).status).toBe(201);
      const play = await CampaignPlayModel.findOne({ campaignId, userId: player.id }).lean();
      expect(play).toMatchObject({ completed: true, score: 4, total: 5 });
    });

    it("counts only completed non-campaign trivias: not campaigns or abandoned sessions", async () => {
      const campaignId = await createCampaign(brand.id, liveWindow());
      const player = await createUser();

      const abandoned = await startTopic(player, topicId);
      await api().post(`/api/v1/trivia/sessions/${abandoned.body.session.id}/abandon`).set(player.auth);
      expect(await counterOf(player)).toBe(0);

      await completeTopicPlay(player, topicId);
      expect(await counterOf(player)).toBe(1);

      const campaign = await startCampaign(player, campaignId);
      await playSession(player, campaign.body.session.id);
      expect(await counterOf(player)).toBe(0); // a voluntary campaign play still resets it
    });

    it("never interrupts a Pro player", async () => {
      await createCampaign(brand.id, liveWindow());
      const pro = await createUser({ proUntil: new Date(Date.now() + DAY_MS) });
      await setCounter(pro, 50);

      expect((await completeTopicPlay(pro, topicId)).status).toBe(201);
      expect(await counterOf(pro)).toBe(50); // not counted while Pro
      const next = await api().get("/api/v1/campaigns/next").set(pro.auth);
      expect(next.body.required).toBe(false);
      expect(next.body.campaign).not.toBeNull(); // may still choose to play one

      // The moment Pro lapses the rule applies again, with no client involvement.
      await userModel.updateOne({ _id: pro.id }, { proUntil: new Date(Date.now() - 1000) });
      expect((await startTopic(pro, topicId)).body.code).toBe("CAMPAIGN_REQUIRED");
    });

    it("blocks nobody while no campaign is live; the counter just keeps its value", async () => {
      await createCampaign(brand.id, { status: "draft" });
      await createCampaign(brand.id, { ...liveWindow(), status: "paused" });
      const player = await createUser();
      await setCounter(player, 10);

      expect((await completeTopicPlay(player, topicId)).status).toBe(201);
      expect(await counterOf(player)).toBe(11);

      await createCampaign(brand.id, liveWindow());
      expect((await startTopic(player, topicId)).body.code).toBe("CAMPAIGN_REQUIRED");
    });

    it("uses the admin-configured threshold", async () => {
      await createCampaign(brand.id, liveWindow());
      const admin = await createUser({ role: "admin" });
      const player = await createUser();
      const set = await api()
        .put("/api/v1/admin/config/campaign.interruptionThreshold")
        .set(admin.auth)
        .send({ value: 2 });
      expect(set.status).toBe(200);

      await completeTopicPlay(player, topicId);
      await completeTopicPlay(player, topicId);
      const blocked = await startTopic(player, topicId);
      expect(blocked.body.code).toBe("CAMPAIGN_REQUIRED");
      expect(blocked.body.details.threshold).toBe(2);
    });

    it("rotates fairly across live campaigns", async () => {
      const a = await createCampaign(brand.id, liveWindow());
      const b = await createCampaign(brand.id, liveWindow());
      const player = await createUser();
      const nextId = async () => (await api().get("/api/v1/campaigns/next").set(player.auth)).body.campaign.id;
      const play = async (id: string) => playSession(player, (await startCampaign(player, id)).body.session.id);

      const first = await nextId();
      expect([a, b]).toContain(first);
      await play(first);
      const second = await nextId();
      expect(second).toBe(first === a ? b : a); // the one not played yet
      await play(second);
      expect(await nextId()).toBe(first); // least recently played comes round again
    });
  });

  describe("campaign sessions", () => {
    it("hides answers like any other trivia", async () => {
      const campaignId = await createCampaign(brand.id, liveWindow());
      const player = await createUser();
      const session = await startCampaign(player, campaignId);
      const id = session.body.session.id;
      const q = await api().get(`/api/v1/trivia/sessions/${id}/question`).set(player.auth);
      const keys = allKeys(q.body);
      expect(keys.has("correctOptionIndex")).toBe(false);
      expect(keys.has("isCorrect")).toBe(false);

      const again = await startTrivia(player, { sourceType: "campaign", sourceId: campaignId, timerSeconds: 16, cardCount: 5 });
      expect(again.status).toBe(200); // already in progress: resumed, not restarted
    });

    it("plays at the brand's timer, whatever the player sends", async () => {
      const campaignId = await createCampaign(brand.id, { ...liveWindow(), timerSeconds: 0 });
      const player = await createUser();
      const session = await startTrivia(player, { sourceType: "campaign", sourceId: campaignId, timerSeconds: 16, cardCount: 5 });
      expect(session.status).toBe(201);
      expect(session.body.session.timerSeconds).toBe(0);
      const q = await api().get(`/api/v1/trivia/sessions/${session.body.session.id}/question`).set(player.auth);
      expect(q.body.question).toMatchObject({ deadlineAt: null, remainingMs: null });

      // A campaign made before the setting existed plays at the default of 15.
      const older = await createCampaign(brand.id, liveWindow());
      await CampaignModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(older) }, { $unset: { timerSeconds: "" } });
      const other = await createUser();
      const oldSession = await startTrivia(other, { sourceType: "campaign", sourceId: older, cardCount: 5 });
      expect(oldSession.body.session.timerSeconds).toBe(15);
      const gate = await api().get(`/api/v1/campaigns/${older}`).set(other.auth);
      expect(gate.body.campaign.timerSeconds).toBe(15);
    });

    it("counts brand URL clicks and reports them on the dashboard", async () => {
      const campaignId = await createCampaign(brand.id, liveWindow());
      const a = await createUser();
      const b = await createUser();
      await playSession(a, (await startCampaign(a, campaignId)).body.session.id);
      await playSession(b, (await startCampaign(b, campaignId)).body.session.id, (i) => i < 3);
      await startCampaign(await createUser(), campaignId); // started, never finished

      const click = await api().post(`/api/v1/campaigns/${campaignId}/click`).set(a.auth);
      expect(click.body).toEqual({ success: true, url: "https://acme.example/" });
      await api().post(`/api/v1/campaigns/${campaignId}/click`).set(a.auth);
      expect((await api().post(`/api/v1/campaigns/${campaignId}/click`)).status).toBe(401);

      const dashboard = await api().get(`${brandBase}/${campaignId}/dashboard`).set(brand.auth);
      expect(dashboard.body.dashboard).toMatchObject({
        status: "live",
        daysRemaining: 29,
        plays: 3,
        completions: 2,
        averageScore: 4,
        averageScorePercent: 80,
        urlClicks: 2,
        uniqueUrlClickers: 1,
      });
      const keys = allKeys(dashboard.body);
      expect(keys.has("userId")).toBe(false);
    });
  });

  describe("authorization", () => {
    it("restricts brand routes to brands, and each campaign to its own brand", async () => {
      const player = await createUser();
      const otherBrand = await createUser({ role: "brand" });
      const id = await createCampaign(brand.id, { status: "draft" });
      const cardBody = { type: "definition", text: "x", options: ["a", "b"], correctOptionIndex: 0 };

      expect((await api().post(brandBase).set(player.auth).send({ title: "T" })).status).toBe(403);
      expect((await api().get(brandBase).set(player.auth)).status).toBe(403);
      expect((await api().get(brandBase)).status).toBe(401);

      const attempts = [
        api().get(`${brandBase}/${id}`).set(otherBrand.auth),
        api().patch(`${brandBase}/${id}`).set(otherBrand.auth).send({ title: "Stolen" }),
        api().delete(`${brandBase}/${id}`).set(otherBrand.auth),
        api().post(`${brandBase}/${id}/cards`).set(otherBrand.auth).send(cardBody),
        api().post(`${brandBase}/${id}/checkout`).set(otherBrand.auth).send({}),
        api().get(`${brandBase}/${id}/dashboard`).set(otherBrand.auth),
      ];
      for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
      expect((await api().get(brandBase).set(otherBrand.auth)).body.campaigns).toHaveLength(0);
      expect((await CampaignModel.findById(id).lean())!.title).not.toBe("Stolen");

      // A draft cannot be played by anyone but its brand.
      expect((await startCampaign(player, id)).body.code).toBe("CAMPAIGN_NOT_AVAILABLE");
    });

    it("lets only admins moderate, and requires a reason", async () => {
      const admin = await createUser({ role: "admin" });
      const player = await createUser();
      const id = await createCampaign(brand.id, liveWindow());
      await setCounter(player, 10);

      for (const actor of [player, brand]) {
        expect((await api().get("/api/v1/admin/campaigns").set(actor.auth)).status).toBe(403);
        expect((await api().post(`/api/v1/admin/campaigns/${id}/pause`).set(actor.auth).send({ reason: "x" })).status).toBe(403);
        expect((await api().post(`/api/v1/admin/campaigns/${id}/takedown`).set(actor.auth).send({ reason: "x" })).status).toBe(403);
        expect((await api().get("/api/v1/admin/revenue").set(actor.auth)).status).toBe(403);
        expect((await api().put("/api/v1/admin/config/campaign.priceAmount").set(actor.auth).send({ value: 1 })).status).toBe(403);
      }

      expect((await api().post(`/api/v1/admin/campaigns/${id}/pause`).set(admin.auth).send({})).status).toBe(400);
      const paused = await api()
        .post(`/api/v1/admin/campaigns/${id}/pause`)
        .set(admin.auth)
        .send({ reason: "Misleading claim on card 3" });
      expect(paused.body.campaign).toMatchObject({ status: "paused", moderationReason: "Misleading claim on card 3" });
      expect((await startTopic(player, topicId)).status).toBe(201); // a paused campaign gates nobody

      const resumed = await api().post(`/api/v1/admin/campaigns/${id}/resume`).set(admin.auth);
      expect(resumed.body.campaign.status).toBe("live");

      const down = await api()
        .post(`/api/v1/admin/campaigns/${id}/takedown`)
        .set(admin.auth)
        .send({ reason: "Breaks the content rules" });
      expect(down.body.campaign.status).toBe("taken_down");
      expect((await startCampaign(await createUser(), id)).status).toBe(404);
      const brandView = await api().get(`${brandBase}/${id}`).set(brand.auth);
      expect(brandView.body.campaign).toMatchObject({ status: "taken_down", moderationReason: "Breaks the content rules" });

      const list = await api().get("/api/v1/admin/campaigns?status=taken_down").set(admin.auth);
      expect(list.body.campaigns.map((c: any) => c.id)).toEqual([id]);
    });

    it("lets admins edit price, duration and threshold but not the global timer range", async () => {
      const admin = await createUser({ role: "admin" });
      const put = (key: string, value: any) =>
        api().put(`/api/v1/admin/config/${key}`).set(admin.auth).send({ value });

      expect((await put("campaign.priceAmount", 25)).status).toBe(200);
      expect((await put("campaign.durationDays", 14)).status).toBe(200);
      const pricing = await api().get(`${brandBase}/pricing`).set(brand.auth);
      expect(pricing.body.pricing).toEqual({ amount: 25, currency: "NGN", durationDays: 14 });

      expect((await put("campaign.priceAmount", -1)).status).toBe(400);
      expect((await put("campaign.interruptionThreshold", 0)).status).toBe(400);
      expect((await put("game.timerMaxSeconds", 30)).status).toBe(400);
      expect((await put("game.timerMinSeconds", 0)).status).toBe(400);
      expect((await put("trivia.defaultTimerSeconds", 16)).status).toBe(400);
      expect((await put("points.sessionCompletionPoints", 7)).status).toBe(400);
      const settings = await api().get("/api/v1/settings/game");
      expect(settings.body.settings.timer).toMatchObject({ minSeconds: 0, maxSeconds: 15 });
    });

    it("summarises confirmed revenue for admins", async () => {
      const admin = await createUser({ role: "admin" });
      const now = new Date();
      await PaymentModel.create([
        { userId: "u1", purpose: "pro", amount: 1500, currency: "NGN", durationDays: 30, reference: "r1", idempotencyKey: "k1", status: "success", paidAt: now },
        { userId: "u2", purpose: "pro", amount: 1500, currency: "NGN", durationDays: 30, reference: "r2", idempotencyKey: "k2", status: "success", paidAt: now },
        { userId: "b1", purpose: "campaign", amount: 15000, currency: "NGN", durationDays: 30, reference: "r3", idempotencyKey: "k3", status: "success", paidAt: now },
        { userId: "b2", purpose: "campaign", amount: 15000, currency: "NGN", durationDays: 30, reference: "r4", idempotencyKey: "k4", status: "pending" },
      ]);
      const res = await api().get("/api/v1/admin/revenue").set(admin.auth);
      expect(res.body.breakdown).toEqual([
        { purpose: "campaign", currency: "NGN", payments: 1, total: 15000 },
        { purpose: "pro", currency: "NGN", payments: 2, total: 3000 },
      ]);
      expect(res.body.totalsByCurrency).toEqual({ NGN: 18000 });
      expect(res.body.pendingPayments).toBe(1);
    });
  });
});
