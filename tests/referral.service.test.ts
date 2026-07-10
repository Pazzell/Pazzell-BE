import { connectTestDB, clearTestDB, closeTestDB } from "./setup";
import ReferralModel from "../models/referral.model";
import { awardPoints, getUserLifetimePoints } from "../services/points/pointsLedger.service";

describe("Referral 21-point qualification", () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  it("does not credit the referrer before the referee reaches the points threshold", async () => {
    const referrerId = "referrer-1";
    const refereeId = "referee-1";
    await ReferralModel.create({ referrerId, referredUserId: refereeId });

    // Two session completions = 14 points, below the 21-point threshold
    await awardPoints({ userId: refereeId, points: 7, source: "session_completion" });
    await awardPoints({ userId: refereeId, points: 7, source: "session_completion" });

    const referral = await ReferralModel.findOne({ referredUserId: refereeId });
    expect(referral!.successful).toBe(false);

    const referrerPoints = await getUserLifetimePoints(referrerId);
    expect(referrerPoints).toBe(0);
  });

  it("credits the referrer exactly 5 points once the referee crosses 21 points", async () => {
    const referrerId = "referrer-2";
    const refereeId = "referee-2";
    await ReferralModel.create({ referrerId, referredUserId: refereeId });

    // Three session completions = 21 points, crossing the threshold
    await awardPoints({ userId: refereeId, points: 7, source: "session_completion" });
    await awardPoints({ userId: refereeId, points: 7, source: "session_completion" });
    await awardPoints({ userId: refereeId, points: 7, source: "session_completion" });

    const referral = await ReferralModel.findOne({ referredUserId: refereeId });
    expect(referral!.successful).toBe(true);
    expect(referral!.pointsAwarded).toBe(5);
    expect(referral!.successfulAt).toBeDefined();

    const referrerPoints = await getUserLifetimePoints(referrerId);
    expect(referrerPoints).toBe(5);
  });

  it("does not re-credit the referrer on further points earned by an already-qualified referee", async () => {
    const referrerId = "referrer-3";
    const refereeId = "referee-3";
    await ReferralModel.create({ referrerId, referredUserId: refereeId });

    await awardPoints({ userId: refereeId, points: 21, source: "session_completion" });
    await awardPoints({ userId: refereeId, points: 7, source: "session_completion" }); // further points, already qualified

    const referrerPoints = await getUserLifetimePoints(referrerId);
    expect(referrerPoints).toBe(5); // still just the one 5pt credit, not repeated
  });

  it("is a no-op when the user has no pending referral", async () => {
    const soloUserId = "solo-user";
    await expect(
      awardPoints({ userId: soloUserId, points: 21, source: "session_completion" })
    ).resolves.toBeDefined();
    // no throw, no referral rows exist — nothing to assert beyond "didn't crash"
  });
});
