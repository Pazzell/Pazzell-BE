import { connectTestDB, clearTestDB, closeTestDB } from "./setup";
import ForumThreadModel from "../models/forumThread.model";
import ForumPostModel from "../models/forumPost.model";
import WinnerShareSubmissionModel from "../models/winnerShareSubmission.model";
import {
  likePost,
  unlikePost,
  verifyWinnerShareSubmission,
  rejectWinnerShareSubmission,
  ForumError,
} from "../services/forum.service";
import { getUserLifetimePoints } from "../services/points/pointsLedger.service";

async function createPost() {
  const thread = await ForumThreadModel.create({ title: "t", createdBy: "user-1" });
  return ForumPostModel.create({ threadId: String(thread._id), userId: "user-1", body: "hello" });
}

describe("Forum service", () => {
  beforeAll(async () => {
    await connectTestDB();
  });
  afterEach(async () => {
    await clearTestDB();
  });
  afterAll(async () => {
    await closeTestDB();
  });

  describe("likes", () => {
    it("increments a post's like count and is idempotent on repeat likes", async () => {
      const post = await createPost();
      const first = await likePost(String(post._id), "liker-1");
      const second = await likePost(String(post._id), "liker-1"); // duplicate

      expect(first).toBe(true);
      expect(second).toBe(false);

      const updated = await ForumPostModel.findById(post._id).lean();
      expect(updated!.likeCount).toBe(1);
    });

    it("decrements the like count on unlike, no-ops if never liked", async () => {
      const post = await createPost();
      await likePost(String(post._id), "liker-1");
      const unliked = await unlikePost(String(post._id), "liker-1");
      const noop = await unlikePost(String(post._id), "liker-1");

      expect(unliked).toBe(true);
      expect(noop).toBe(false);

      const updated = await ForumPostModel.findById(post._id).lean();
      expect(updated!.likeCount).toBe(0);
    });
  });

  describe("winner-share verification", () => {
    it("credits 5 bonus points to the submitter on verification", async () => {
      const submission = await WinnerShareSubmissionModel.create({
        userId: "winner-1",
        campaignId: "campaign-1",
        postUrl: "https://example.com/post/1",
        claimedLikeCount: 25,
      });

      const verified = await verifyWinnerShareSubmission(String(submission._id), "admin-1");
      expect(verified.status).toBe("verified");
      expect(verified.bonusPointsGranted).toBe(5);

      const points = await getUserLifetimePoints("winner-1");
      expect(points).toBe(5);
    });

    it("is idempotent — verifying an already-verified submission does not re-credit", async () => {
      const submission = await WinnerShareSubmissionModel.create({
        userId: "winner-2",
        campaignId: "campaign-1",
        postUrl: "https://example.com/post/2",
      });

      await verifyWinnerShareSubmission(String(submission._id), "admin-1");
      await verifyWinnerShareSubmission(String(submission._id), "admin-1");

      const points = await getUserLifetimePoints("winner-2");
      expect(points).toBe(5);
    });

    it("rejects a submission and prevents later verification", async () => {
      const submission = await WinnerShareSubmissionModel.create({
        userId: "winner-3",
        campaignId: "campaign-1",
        postUrl: "https://example.com/post/3",
      });

      const rejected = await rejectWinnerShareSubmission(String(submission._id), "admin-1", "not enough likes");
      expect(rejected.status).toBe("rejected");

      await expect(
        verifyWinnerShareSubmission(String(submission._id), "admin-1")
      ).rejects.toBeInstanceOf(ForumError);

      const points = await getUserLifetimePoints("winner-3");
      expect(points).toBe(0);
    });

    it("cannot reject an already-verified submission", async () => {
      const submission = await WinnerShareSubmissionModel.create({
        userId: "winner-4",
        campaignId: "campaign-1",
        postUrl: "https://example.com/post/4",
      });
      await verifyWinnerShareSubmission(String(submission._id), "admin-1");

      await expect(
        rejectWinnerShareSubmission(String(submission._id), "admin-1")
      ).rejects.toBeInstanceOf(ForumError);
    });
  });
});
