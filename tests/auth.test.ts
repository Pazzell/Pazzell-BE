import jwt from "jsonwebtoken";
import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import { api, createUser, resetState } from "./helpers";
import userModel from "../models/user.model";
import BrandModel from "../models/brand.model";
import axios from "axios";

// No real mail is sent from the test suite.
const sendMail = jest.fn(async () => undefined);
jest.mock("../services/email/emailFactory", () => ({
  getEmailService: () => ({ sendMail }),
}));

const codeFrom = (activationToken: string) =>
  (jwt.decode(activationToken) as { activationCode: string }).activationCode;

describe("Auth flows", () => {
  beforeAll(connectTestDB);
  afterEach(async () => {
    sendMail.mockClear();
    await resetState();
  });
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  it("registers, activates and logs in a player as a freemium gamer", async () => {
    const registered = await api().post("/api/v1/auth/gamer/register").send({
      firstName: "Ada",
      lastName: "Obi",
      email: "ada@test.local",
      password: "password123",
      referralCode: "legacy-field-is-ignored",
    });
    expect(registered.status).toBe(201);
    expect(sendMail).toHaveBeenCalledTimes(1);

    const activated = await api().post("/api/v1/auth/user/activate").send({
      activation_token: registered.body.activationToken,
      activation_code: codeFrom(registered.body.activationToken),
    });
    expect(activated.status).toBe(200);
    expect(activated.body.user).toMatchObject({ role: "gamer", isVerified: true });

    const login = await api()
      .post("/api/v1/auth/login")
      .send({ email: "ada@test.local", password: "password123" });
    expect(login.status).toBe(200);
    expect(login.body).toHaveProperty("accessToken");

    const me = await api().get("/api/v1/me").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(me.body.plan).toEqual({ tier: "freemium", isPro: false, proUntil: null });
    expect(me.body.user).toMatchObject({ nonCampaignPlaysSinceCampaign: 0 });
    expect(me.body.user).not.toHaveProperty("password");
    expect(me.body.user).not.toHaveProperty("analytics");
  });

  it("registers a brand with a brand profile", async () => {
    const registered = await api().post("/api/v1/auth/brand/register").send({
      name: "Brand Owner",
      email: "brand@test.local",
      password: "password123",
      companyName: "BrandCo",
    });
    expect(registered.status).toBe(201);
    const user = await userModel.findOne({ email: "brand@test.local" }).lean();
    expect(user!.role).toBe("brand");
    expect(await BrandModel.findOne({ userId: String(user!._id) }).lean()).toMatchObject({
      companyName: "BrandCo",
    });

    const wrongPassword = await api()
      .post("/api/v1/auth/login")
      .send({ email: "brand@test.local", password: "nope" });
    expect(wrongPassword.status).toBe(401);
  });

  it("reads role and plan from the database on every request, not from the cached session", async () => {
    const user = await createUser();
    expect((await api().get("/api/v1/admin/campaigns").set(user.auth)).status).toBe(403);

    // The session cache still says "gamer"; the database is what counts.
    await userModel.updateOne({ _id: user.id }, { role: "admin" });
    expect((await api().get("/api/v1/admin/campaigns").set(user.auth)).status).toBe(200);
    await userModel.updateOne({ _id: user.id }, { role: "gamer" });
    expect((await api().get("/api/v1/admin/campaigns").set(user.auth)).status).toBe(403);
  });

  it("rejects missing, malformed and logged-out tokens", async () => {
    const user = await createUser();
    expect((await api().get("/api/v1/me")).status).toBe(401);
    expect((await api().get("/api/v1/me").set("Authorization", "Bearer not-a-token")).status).toBe(400);

    expect((await api().post("/api/v1/auth/logout").set(user.auth)).status).toBe(200);
    await api().post("/api/v1/logout").set(user.auth);
    expect((await api().get("/api/v1/me").set(user.auth)).status).toBe(400);
  });

  it("no longer serves any removed reward-economy route", async () => {
    const user = await createUser();
    for (const path of [
      "/leaderboards/weekly",
      "/leaderboards/all-time",
      "/referrals/my-stats",
      "/referrals/summary",
      "/raffles/my-tickets",
      "/packages",
      "/payouts/my-earnings",
      "/prize-pools/weekly/summary",
      "/gamers",
      "/forum/winner-submissions/mine",
    ]) {
      const res = await api().get(`/api/v1${path}`).set(user.auth);
      expect(res.status).toBe(404);
    }
    expect((await api().post("/api/v1/sessions/start").set(user.auth).send({})).status).toBe(404);
  });

  describe("Google sign-in", () => {
    const clientId = "pazzell-test.apps.googleusercontent.com";
    const google = (overrides: { aud?: string; email?: string; email_verified?: boolean } = {}) =>
      jest.spyOn(axios, "get").mockImplementation((async (url: string) => {
        if (url.includes("tokeninfo")) {
          return { data: { aud: overrides.aud ?? clientId, azp: overrides.aud ?? clientId, sub: "g-123" } };
        }
        return {
          data: {
            sub: "g-123",
            email: overrides.email ?? "chidi@gmail.com",
            email_verified: overrides.email_verified ?? true,
            name: "Chidi Okafor",
            given_name: "Chidi",
            family_name: "Okafor",
            picture: "https://lh3.googleusercontent.com/a/chidi",
          },
        };
      }) as any);
    const signIn = () => api().post("/api/v1/auth/google").send({ googleAccessToken: "ya29.token" });

    afterEach(() => jest.restoreAllMocks());

    it("signs a new player up from a verified Google token, and signs them in again", async () => {
      google();
      const first = await signIn();
      expect(first.status).toBe(200);
      expect(first.body.user).toMatchObject({
        email: "chidi@gmail.com",
        firstName: "Chidi",
        lastName: "Okafor",
        role: "gamer",
        isVerified: true,
        googleId: "g-123",
      });
      expect(first.body).toHaveProperty("accessToken");

      const me = await api().get("/api/v1/me").set("Authorization", `Bearer ${first.body.accessToken}`);
      expect(me.status).toBe(200);

      const second = await signIn();
      expect(second.status).toBe(200);
      expect(second.body.user._id).toBe(first.body.user._id);
      expect(await userModel.countDocuments({ email: "chidi@gmail.com" })).toBe(1);
    });

    it("links an existing account with the same email, whatever its case", async () => {
      const existing = await createUser({ role: "brand", email: "Chidi@Gmail.com" });
      google();
      const res = await signIn();
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ _id: existing.id, role: "brand", googleId: "g-123" });
    });

    it("never trusts a profile sent by the client", async () => {
      await createUser({ role: "admin", email: "admin@pazzell.test" });
      const spy = google();
      const res = await api()
        .post("/api/v1/auth/google")
        .send({ email: "admin@pazzell.test", googleId: "made-up" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("GOOGLE_TOKEN_REQUIRED");
      expect(res.body).not.toHaveProperty("accessToken");
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a token issued to another app", async () => {
      google({ aud: "someone-else.apps.googleusercontent.com" });
      const res = await signIn();
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("GOOGLE_TOKEN_INVALID");
      expect(await userModel.countDocuments({})).toBe(0);
    });

    it("rejects a token Google does not recognise", async () => {
      jest.spyOn(axios, "get").mockRejectedValue({ response: { status: 400 } });
      const res = await signIn();
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("GOOGLE_TOKEN_INVALID");
    });

    it("refuses a Google account without a verified email", async () => {
      google({ email_verified: false });
      const res = await signIn();
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("GOOGLE_EMAIL_UNVERIFIED");
    });
  });
});
