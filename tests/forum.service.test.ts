import { connectTestDB, clearTestDB, closeTestDB } from "./setup";
import ForumThreadModel from "../models/forumThread.model";
import ForumPostModel from "../models/forumPost.model";
import { likePost, unlikePost } from "../services/forum.service";

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
});
