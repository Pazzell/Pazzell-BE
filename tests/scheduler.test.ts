import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import { createUser, createCampaign, liveWindow, resetState, DAY_MS } from "./helpers";
import userModel from "../models/user.model";
import CampaignModel from "../models/campaign.model";
import CustomQuizModel from "../models/customQuiz.model";
import MatchAttemptModel from "../models/matchAttempt.model";
import TriviaAttemptModel from "../models/triviaAttempt.model";
import { creditWallet, getBalance } from "../services/wallet/wallet.service";
import WalletModel from "../models/wallet.model";
import {
  runExpirySweep,
  runNightlyWalletReconciliation,
  runStaleAttemptSweep,
} from "../services/scheduler";

describe("Scheduled jobs", () => {
  beforeAll(connectTestDB);
  afterEach(resetState);
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  it("ends campaigns whose 30 days are over and leaves the others alone", async () => {
    const brand = await createUser({ role: "brand" });
    const over = { startsAt: new Date(Date.now() - 31 * DAY_MS), endsAt: new Date(Date.now() - 60_000) };
    const liveExpired = await createCampaign(brand.id, { status: "live", ...over });
    const pausedExpired = await createCampaign(brand.id, { status: "paused", ...over });
    const takenDown = await createCampaign(brand.id, { status: "taken_down", ...over });
    const running = await createCampaign(brand.id, liveWindow());
    const draft = await createCampaign(brand.id, { status: "draft" });

    await runExpirySweep();

    const status = async (id: string) => (await CampaignModel.findById(id).lean())!.status;
    expect(await status(liveExpired)).toBe("ended");
    expect(await status(pausedExpired)).toBe("ended");
    expect(await status(takenDown)).toBe("taken_down");
    expect(await status(running)).toBe("live");
    expect(await status(draft)).toBe("draft");
  });

  it("locks the extra quizzes of users whose Pro plan has lapsed", async () => {
    const lapsed = await createUser({ proUntil: new Date(Date.now() - 60_000) });
    const active = await createUser({ proUntil: new Date(Date.now() + DAY_MS) });
    for (const user of [lapsed, active]) {
      for (let i = 0; i < 3; i++) {
        await CustomQuizModel.create({
          ownerId: user.id,
          title: `Quiz ${i}`,
          status: "live",
          shareSlug: `${user.id}-slug-${i}-padpadpad`,
          defaultTimerSeconds: 5,
          defaultCardCount: 5,
          createdAt: new Date(Date.now() - (10 - i) * 1000),
        });
      }
    }
    // Both were Pro when their quizzes were last synced.
    await userModel.updateMany({}, { quizLocksSyncedAsPro: true });

    await runExpirySweep();

    const statuses = async (ownerId: string) =>
      (await CustomQuizModel.find({ ownerId }).sort({ createdAt: 1 }).lean()).map((q) => q.status);
    expect(await statuses(lapsed.id)).toEqual(["live", "locked", "locked"]);
    expect(await statuses(active.id)).toEqual(["live", "live", "live"]);
  });

  it("closes attempts and sessions that were walked away from", async () => {
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000);
    await MatchAttemptModel.create([
      { userId: "u1", level: 1, timerSeconds: 5, questionCount: 3, startedAt: old },
      { userId: "u2", level: 1, timerSeconds: 5, questionCount: 3 },
    ]);
    await TriviaAttemptModel.create([
      { userId: "u1", sourceType: "topic", sourceId: "t", sourceKey: "topic:t", timerSeconds: 5, cardCount: 5, startedAt: old },
      { userId: "u2", sourceType: "topic", sourceId: "t", sourceKey: "topic:t", timerSeconds: 5, cardCount: 5 },
    ]);

    await runStaleAttemptSweep();

    expect(await MatchAttemptModel.countDocuments({ status: "abandoned", active: false })).toBe(1);
    expect(await MatchAttemptModel.countDocuments({ status: "in_progress", active: true })).toBe(1);
    expect(await TriviaAttemptModel.countDocuments({ status: "abandoned", active: false })).toBe(1);
    expect(await TriviaAttemptModel.countDocuments({ status: "studying", active: true })).toBe(1);
  });

  it("still reconciles wallet balances against the ledger", async () => {
    await creditWallet("user-x", 500, "reward", { idempotencyKey: "r-1" });
    await WalletModel.updateOne({ userId: "user-x" }, { balance: 999 });
    await runNightlyWalletReconciliation();
    expect(await getBalance("user-x")).toBe(500);
  });
});
