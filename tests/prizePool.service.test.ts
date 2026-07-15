import { connectTestDB, clearTestDB, closeTestDB } from "./setup";
import TransactionModel from "../models/transaction.model";
import PayoutModel from "../models/payout.model";
import { awardPoints } from "../services/points/pointsLedger.service";
import { calculateWeeklyPayouts } from "../services/prizePool.service";
import { getWeekBounds } from "../utils/weekBoundary";
import { setConfigValue } from "../services/config/config.service";

async function makeSuccessfulTransaction(amount: number) {
  return TransactionModel.create({
    campaignId: "campaign-1",
    brandId: "brand-1",
    packageType: "basic",
    amount,
    currency: "NGN",
    reference: `ref-${Math.random()}`,
    status: "success",
  });
}

describe("prizePool.service.calculateWeeklyPayouts", () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  it("splits the week's revenue 50/50 by default and distributes the player pool by configured rank percentages", async () => {
    const { weekKey } = getWeekBounds();
    await makeSuccessfulTransaction(10000);

    await awardPoints({ userId: "player-1", points: 21, source: "session_completion" });
    await awardPoints({ userId: "player-2", points: 14, source: "session_completion" });

    const result = await calculateWeeklyPayouts(weekKey);

    expect(result.totalRevenue).toBe(10000);
    expect(result.playerPool).toBe(5000); // 50% default
    expect(result.platformShare).toBe(5000);

    const first = result.payouts.find((p: any) => p.userId === "player-1");
    const second = result.payouts.find((p: any) => p.userId === "player-2");
    expect(first.position).toBe(1);
    expect(second.position).toBe(2);
    // rank 1 = 20% of the 5000 player pool = 1000; rank 2 = 15% = 750
    expect(first.amount).toBe(1000);
    expect(second.amount).toBe(750);
    expect(first.playerSharePercent).toBe(50);
    expect(first.platformSharePercent).toBe(50);
  });

  it("reflects an updated split once Config is changed (e.g. 60/40 in players' favor)", async () => {
    const { weekKey } = getWeekBounds();
    await makeSuccessfulTransaction(10000);
    await awardPoints({ userId: "player-1", points: 7, source: "session_completion" });

    await setConfigValue("payout.playerSharePercent", 60);
    await setConfigValue("payout.platformSharePercent", 40);

    const result = await calculateWeeklyPayouts(weekKey);
    expect(result.playerPool).toBe(6000);
    expect(result.platformShare).toBe(4000);

    // reset for other tests relying on the default (config cache is process-wide)
    await setConfigValue("payout.playerSharePercent", 50);
    await setConfigValue("payout.platformSharePercent", 50);
  });

  it("upserts (not duplicates) a payout row when recalculated for the same user+week", async () => {
    const { weekKey } = getWeekBounds();
    await makeSuccessfulTransaction(1000);
    await awardPoints({ userId: "player-1", points: 7, source: "session_completion" });

    await calculateWeeklyPayouts(weekKey);
    await calculateWeeklyPayouts(weekKey);

    const count = await PayoutModel.countDocuments({ userId: "player-1", weekKey });
    expect(count).toBe(1);
  });

  it("returns no payouts when nobody earned points that week", async () => {
    const { weekKey } = getWeekBounds();
    await makeSuccessfulTransaction(5000);

    const result = await calculateWeeklyPayouts(weekKey);
    expect(result.payouts).toEqual([]);
  });
});
