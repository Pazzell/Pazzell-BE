import { connectTestDB, clearTestDB, closeTestDB } from "./setup";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";
import RaffleTicketModel from "../models/raffleTicket.model";
import RaffleDrawModel from "../models/raffleDraw.model";
import {
  mintTicketOnFirstCompletion,
  getEligibilityFloor,
  isEligibleThisWeek,
  runDraw,
  verifyDraw,
} from "../services/raffle.service";
import { awardPoints } from "../services/points/pointsLedger.service";
import { getWeekBounds } from "../utils/weekBoundary";

async function createActiveV2Campaign() {
  const now = new Date();
  return PuzzleCampaignModel.create({
    brandId: "brand-1",
    packageId: "000000000000000000000000",
    schemaVersion: 2,
    gameType: "sliding_puzzle",
    gameTypes: ["sliding_puzzle", "card_matching", "spot_the_difference", "word_hunt"],
    title: "Campaign",
    description: "desc",
    puzzleImageUrl: "http://example.com/i.png",
    videoUrl: "http://example.com/v.mp4",
    words: ["a"],
    questions: [
      { question: "q1", choices: ["a", "b"], correctIndex: 0 },
      { question: "q2", choices: ["a", "b"], correctIndex: 0 },
      { question: "q3", choices: ["a", "b"], correctIndex: 0 },
    ],
    prizeDescription: "prize",
    prizeUnitsAvailable: 1,
    durationWeeks: 1,
    timeLimit: 168,
    status: "active",
    paymentStatus: "paid",
    startDate: now,
    endDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
  });
}

describe("Raffle service", () => {
  beforeAll(async () => {
    await connectTestDB();
  });
  afterEach(async () => {
    await clearTestDB();
  });
  afterAll(async () => {
    await closeTestDB();
  });

  describe("ticket minting", () => {
    it("mints exactly one ticket per player per campaign, never on a replay", async () => {
      const { weekKey } = getWeekBounds();
      const first = await mintTicketOnFirstCompletion("user-1", "campaign-1", "session-1", weekKey);
      expect(first).not.toBeNull();

      // Simulating a replay attempt trying to mint again for the same user+campaign
      const second = await mintTicketOnFirstCompletion("user-1", "campaign-1", "session-2", weekKey);
      expect(second).toBeNull();

      const count = await RaffleTicketModel.countDocuments({ userId: "user-1", campaignId: "campaign-1" });
      expect(count).toBe(1);
    });
  });

  describe("eligibility floor", () => {
    it("uses the lesser of the configured cap (3) or the number of active campaigns", async () => {
      // Only 2 active v2 campaigns exist this week -> floor should be 2, not 3
      await createActiveV2Campaign();
      await createActiveV2Campaign();

      const floor = await getEligibilityFloor();
      expect(floor).toBe(2);
    });

    it("caps the floor at the configured value (3) even with many more active campaigns", async () => {
      for (let i = 0; i < 5; i++) await createActiveV2Campaign();
      const floor = await getEligibilityFloor();
      expect(floor).toBe(3);
    });

    it("a player is only eligible once they've completed at least the floor's worth of distinct campaigns this week", async () => {
      await createActiveV2Campaign();
      await createActiveV2Campaign(); // floor = 2
      const { weekKey } = getWeekBounds();

      await awardPoints({ userId: "user-1", points: 7, source: "session_completion", campaignId: "campaign-A" });
      expect(await isEligibleThisWeek("user-1", weekKey)).toBe(false);

      await awardPoints({ userId: "user-1", points: 7, source: "session_completion", campaignId: "campaign-B" });
      expect(await isEligibleThisWeek("user-1", weekKey)).toBe(true);
    });
  });

  describe("provably-random draw", () => {
    it("returns null when nobody holds a ticket that week", async () => {
      const { weekKey } = getWeekBounds();
      const draw = await runDraw("campaign-1", weekKey);
      expect(draw).toBeNull();
    });

    it("draws exactly one winner from the eligible ticket holders and the result is independently verifiable", async () => {
      const { weekKey } = getWeekBounds();
      // No active-campaign floor requirement here (0 active campaigns -> floor 0 -> everyone eligible)
      for (const userId of ["user-1", "user-2", "user-3"]) {
        await mintTicketOnFirstCompletion(userId, "campaign-1", `session-${userId}`, weekKey);
      }

      const draw = await runDraw("campaign-1", weekKey);
      expect(draw).not.toBeNull();
      expect(draw!.status).toBe("drawn");
      expect(draw!.eligibleTicketUserIds.length).toBe(3);
      expect(draw!.winnerUserId).toBeDefined();
      expect(draw!.eligibleTicketUserIds).toContain(draw!.winnerUserId);
      expect(draw!.seed).toBeDefined();

      const verification = await verifyDraw(String(draw!._id));
      expect(verification.valid).toBe(true);
      expect(verification.recomputedWinnerUserId).toBe(draw!.winnerUserId);
    });

    it("is idempotent — re-running the draw for the same campaign+week does not pick a new winner", async () => {
      const { weekKey } = getWeekBounds();
      await mintTicketOnFirstCompletion("user-1", "campaign-1", "s1", weekKey);
      await mintTicketOnFirstCompletion("user-2", "campaign-1", "s2", weekKey);

      const first = await runDraw("campaign-1", weekKey);
      const second = await runDraw("campaign-1", weekKey);

      expect(second!.winnerUserId).toBe(first!.winnerUserId);
      expect(second!.seed).toBe(first!.seed);

      const drawCount = await RaffleDrawModel.countDocuments({ campaignId: "campaign-1", weekKey });
      expect(drawCount).toBe(1);
    });

    it("excludes ineligible ticket holders from the winner pool (lesser-of-3 rule with fewer than 3 active campaigns)", async () => {
      await createActiveV2Campaign(); // 1 active campaign -> floor = 1
      const { weekKey } = getWeekBounds();

      // user-1 has completed a campaign this week (eligible); user-2 has not (ineligible)
      await awardPoints({ userId: "user-1", points: 7, source: "session_completion", campaignId: "some-other-campaign" });
      await mintTicketOnFirstCompletion("user-1", "campaign-1", "s1", weekKey);
      await mintTicketOnFirstCompletion("user-2", "campaign-1", "s2", weekKey);

      const draw = await runDraw("campaign-1", weekKey);
      expect(draw!.allTicketUserIds.sort()).toEqual(["user-1", "user-2"]);
      expect(draw!.eligibleTicketUserIds).toEqual(["user-1"]);
      expect(draw!.winnerUserId).toBe("user-1");
    });

    it("detects tampering when a draw's stored winner does not match its seed", async () => {
      const { weekKey } = getWeekBounds();
      await mintTicketOnFirstCompletion("user-1", "campaign-1", "s1", weekKey);
      await mintTicketOnFirstCompletion("user-2", "campaign-1", "s2", weekKey);
      const draw = await runDraw("campaign-1", weekKey);

      // Tamper with the recorded winner without changing the seed
      const tamperedWinner = draw!.eligibleTicketUserIds.find((u) => u !== draw!.winnerUserId);
      await RaffleDrawModel.updateOne({ _id: draw!._id }, { $set: { winnerUserId: tamperedWinner } });

      const verification = await verifyDraw(String(draw!._id));
      expect(verification.valid).toBe(false);
    });
  });
});
