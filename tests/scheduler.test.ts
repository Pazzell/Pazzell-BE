import { connectTestDB, clearTestDB, closeTestDB } from "./setup";
import TransactionModel from "../models/transaction.model";
import PayoutModel from "../models/payout.model";
import RaffleTicketModel from "../models/raffleTicket.model";
import RaffleDrawModel from "../models/raffleDraw.model";
import { awardPoints } from "../services/points/pointsLedger.service";
import { getPreviousWeekKey } from "../utils/weekBoundary";
import { runWeeklyRollover } from "../services/scheduler";

describe("services/scheduler runWeeklyRollover", () => {
  beforeAll(async () => {
    await connectTestDB();
  });
  afterEach(async () => {
    await clearTestDB();
  });
  afterAll(async () => {
    await closeTestDB();
  });

  it("calculates last week's payouts and draws raffles for campaigns that sold tickets last week", async () => {
    const lastWeekDate = new Date();
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const previousWeekKey = getPreviousWeekKey();

    // Revenue + a top player for last week's payout calculation
    await TransactionModel.create({
      campaignId: "campaign-1",
      brandId: "brand-1",
      packageType: "basic",
      amount: 5000,
      currency: "NGN",
      reference: `ref-${Math.random()}`,
      status: "success",
      createdAt: lastWeekDate,
    });
    await awardPoints({
      userId: "player-1",
      points: 7,
      source: "session_completion",
      campaignId: "campaign-1",
      at: lastWeekDate,
    });

    // A raffle ticket minted last week for campaign-1
    await RaffleTicketModel.create({
      userId: "player-1",
      campaignId: "campaign-1",
      weekKey: previousWeekKey,
      sourceSessionId: "session-1",
      createdAt: lastWeekDate,
    });

    await runWeeklyRollover();

    const payout = await PayoutModel.findOne({ userId: "player-1", weekKey: previousWeekKey });
    expect(payout).not.toBeNull();
    expect(payout!.amount).toBeGreaterThan(0);

    const draw = await RaffleDrawModel.findOne({ campaignId: "campaign-1", weekKey: previousWeekKey });
    expect(draw).not.toBeNull();
    expect(draw!.winnerUserId).toBe("player-1");
  });

  it("is a no-op for weeks with no revenue or ticket activity", async () => {
    await expect(runWeeklyRollover()).resolves.toBeUndefined();
    const payoutCount = await PayoutModel.countDocuments({});
    expect(payoutCount).toBe(0);
  });
});
