import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import { api, createUser, resetState, allKeys, TestUser } from "./helpers";
import MatchQuestionModel from "../models/matchQuestion.model";
import MatchAttemptModel from "../models/matchAttempt.model";
import { DEFAULT_LEVELS } from "../services/match/levels";
import { generateQuestions } from "../services/match/questionGenerator";
import { getArtifact, listArtifacts } from "../services/match/artifacts";
import { renderArtifactSvg } from "../services/match/artifactSvg";

const start = (user: TestUser, level: number, body: any = { timerSeconds: 5 }) =>
  api().post(`/api/v1/match/levels/${level}/attempts`).set(user.auth).send(body);
const question = (user: TestUser, id: string) =>
  api().get(`/api/v1/match/attempts/${id}/question`).set(user.auth);
const answer = (user: TestUser, id: string, questionIndex: number, optionId: string) =>
  api().post(`/api/v1/match/attempts/${id}/answer`).set(user.auth).send({ questionIndex, optionId });

/** Plays a whole attempt; `wrongAt` is the question index to answer incorrectly. */
async function playLevel(user: TestUser, level: number, wrongAt = -1) {
  const started = await start(user, level, { timerSeconds: 5, restart: true });
  const id = started.body.attempt.id;
  let last: any;
  for (let i = 0; i < started.body.attempt.questionCount; i++) {
    const q = await question(user, id);
    const stored = await MatchQuestionModel.findOne({ attemptId: id, index: i }).lean();
    const wrong = stored!.optionIds.find((o) => o !== stored!.correctOptionId)!;
    last = await answer(user, id, q.body.question.index, i === wrongAt ? wrong : stored!.correctOptionId);
  }
  return { id, result: last.body.result };
}

describe("Match", () => {
  beforeAll(connectTestDB);
  afterEach(resetState);
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  describe("artifact library and question generator", () => {
    it("covers every required category with stable ids and renders each as SVG", () => {
      const artifacts = listArtifacts();
      const ids = new Set(artifacts.map((a) => a.id));
      expect(ids.size).toBe(artifacts.length);
      for (const id of [
        "shape:circle", "shape:arrow", "color:grey", "letter:upper:A", "letter:lower:z",
        "number:0", "number:20", "dots:3", "figure:apple", "shape:triangle:red",
      ]) {
        expect(ids.has(id)).toBe(true);
      }
      for (const artifact of artifacts) {
        expect(artifact.name).toBeTruthy();
        expect(renderArtifactSvg(artifact)).toMatch(/^<svg .*<\/svg>$/);
      }
      expect(getArtifact("shape:triangle:red@r90")!.attributes.rotation).toBe(90);
      expect(getArtifact("letter:lower:b@mirror")).toBeNull(); // would read as "d"
      expect(getArtifact("shape:nope")).toBeNull();
    });

    it("ships at least 10 levels whose difficulty grows with the level number", () => {
      expect(DEFAULT_LEVELS.length).toBeGreaterThanOrEqual(10);
      for (let i = 1; i < DEFAULT_LEVELS.length; i++) {
        expect(DEFAULT_LEVELS[i].questionCount).toBeGreaterThanOrEqual(DEFAULT_LEVELS[i - 1].questionCount);
        expect(DEFAULT_LEVELS[i].optionCount).toBeGreaterThanOrEqual(DEFAULT_LEVELS[i - 1].optionCount);
      }
      for (const level of DEFAULT_LEVELS) expect(level).not.toHaveProperty("timerSeconds");
    });

    it("puts the correct option in every question exactly once, with no duplicates", () => {
      for (const level of DEFAULT_LEVELS) {
        for (let run = 0; run < 20; run++) {
          const questions = generateQuestions(level);
          expect(questions).toHaveLength(level.questionCount);
          const signatures = new Set<string>();
          for (const q of questions) {
            expect(q.optionIds).toHaveLength(level.optionCount);
            expect(new Set(q.optionIds).size).toBe(level.optionCount);
            expect(q.optionIds.filter((o) => o === q.correctOptionId)).toHaveLength(1);
            for (const id of [q.targetId, ...q.optionIds]) expect(getArtifact(id)).not.toBeNull();
            signatures.add(`${q.targetId}|${[...q.optionIds].sort().join(",")}`);
          }
          expect(signatures.size).toBe(questions.length);
        }
      }
    });
  });

  describe("timer", () => {
    it.each([0, 8, -1, 2.5, "5", null])("rejects timerSeconds=%p", async (timerSeconds) => {
      const user = await createUser();
      const res = await start(user, 1, { timerSeconds });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_TIMER");
      expect(res.body.details).toEqual({ minSeconds: 1, maxSeconds: 7 });
    });

    it.each([1, 7])("accepts timerSeconds=%p", async (timerSeconds) => {
      const user = await createUser();
      const res = await start(user, 1, { timerSeconds });
      expect(res.status).toBe(201);
      expect(res.body.attempt.timerSeconds).toBe(timerSeconds);
    });

    it("applies the player's chosen timer to every question of the attempt", async () => {
      const user = await createUser();
      const started = await start(user, 1, { timerSeconds: 3 });
      const id = started.body.attempt.id;
      for (let i = 0; i < started.body.attempt.questionCount; i++) {
        const q = await question(user, id);
        expect(q.body.question.timerSeconds).toBe(3);
        expect(q.body.question.remainingMs).toBeLessThanOrEqual(3000);
        const stored = await MatchQuestionModel.findOne({ attemptId: id, index: i }).lean();
        expect(stored!.deadlineAt!.getTime() - stored!.servedAt!.getTime()).toBe(3000);
        await answer(user, id, i, stored!.correctOptionId);
      }
    });

    it("counts a timeout as a wrong answer and moves to the next question", async () => {
      const user = await createUser();
      const started = await start(user, 1);
      const id = started.body.attempt.id;
      await question(user, id);
      const stored = await MatchQuestionModel.findOne({ attemptId: id, index: 0 });
      stored!.deadlineAt = new Date(Date.now() - 5000);
      await stored!.save();

      // Even the correct option is too late.
      const late = await answer(user, id, 0, stored!.correctOptionId);
      expect(late.body.outcome).toBe("timeout");
      expect(late.body.nextQuestionIndex).toBe(1);

      // A question left unanswered past its deadline is timed out on the next read.
      await question(user, id);
      await MatchQuestionModel.updateOne({ attemptId: id, index: 1 }, { deadlineAt: new Date(Date.now() - 5000) });
      const next = await question(user, id);
      expect(next.body.question.index).toBe(2);
      const second = await MatchQuestionModel.findOne({ attemptId: id, index: 1 }).lean();
      expect(second!.outcome).toBe("timeout");
    });

    it("accepts an answer inside the network grace window", async () => {
      const user = await createUser();
      const started = await start(user, 1);
      const id = started.body.attempt.id;
      await question(user, id);
      const stored = await MatchQuestionModel.findOne({ attemptId: id, index: 0 });
      stored!.deadlineAt = new Date(Date.now() - 300); // inside the 1000ms grace
      await stored!.save();
      const res = await answer(user, id, 0, stored!.correctOptionId);
      expect(res.body.outcome).toBe("correct");
    });
  });

  describe("server-side validation", () => {
    it("never sends the correct option with a question", async () => {
      const user = await createUser();
      const started = await start(user, 9); // locked
      expect(started.status).toBe(403);
      const ok = await start(user, 1);
      const q = await question(user, ok.body.attempt.id);
      const keys = allKeys(q.body);
      expect(keys.has("correctOptionId")).toBe(false);
      expect(keys.has("correct")).toBe(false);
      expect(q.body.question.target.svg).toContain("<svg");
      expect(q.body.question.options.length).toBe(2);
      expect(q.headers["cache-control"]).toBe("no-store");
    });

    it("decides the outcome from the stored answer, and keeps it on a repeat submit", async () => {
      const user = await createUser();
      const started = await start(user, 1);
      const id = started.body.attempt.id;
      await question(user, id);
      const stored = await MatchQuestionModel.findOne({ attemptId: id, index: 0 }).lean();
      const wrong = stored!.optionIds.find((o) => o !== stored!.correctOptionId)!;

      const first = await answer(user, id, 0, wrong);
      expect(first.body.outcome).toBe("wrong");
      // Trying to change the answer afterwards changes nothing.
      const again = await answer(user, id, 0, stored!.correctOptionId);
      expect(again.body.outcome).toBe("wrong");
      const attempt = await MatchAttemptModel.findById(id).lean();
      expect(attempt!.correctCount).toBe(0);
      expect(attempt!.currentIndex).toBe(1);
    });

    it("rejects answers for a question that is not current or was never served", async () => {
      const user = await createUser();
      const started = await start(user, 1);
      const id = started.body.attempt.id;
      const stored = await MatchQuestionModel.findOne({ attemptId: id, index: 0 }).lean();

      const unserved = await answer(user, id, 0, stored!.correctOptionId);
      expect(unserved.status).toBe(409);
      expect(unserved.body.code).toBe("QUESTION_NOT_SERVED");

      const ahead = await answer(user, id, 2, stored!.correctOptionId);
      expect(ahead.status).toBe(409);
      expect(ahead.body.code).toBe("NOT_CURRENT_QUESTION");

      await question(user, id);
      const bogus = await answer(user, id, 0, "shape:not-an-option");
      expect(bogus.status).toBe(400);
      expect(bogus.body.code).toBe("INVALID_OPTION");
    });

    it("keeps one active attempt per level and returns it on a second start", async () => {
      const user = await createUser();
      const first = await start(user, 1, { timerSeconds: 4 });
      const second = await start(user, 1, { timerSeconds: 6 });
      expect(second.status).toBe(200);
      expect(second.body.resumed).toBe(true);
      expect(second.body.attempt.id).toBe(first.body.attempt.id);
      expect(second.body.attempt.timerSeconds).toBe(4);
      expect(await MatchAttemptModel.countDocuments({ userId: user.id, active: true })).toBe(1);
    });

    it("refuses to finish an attempt that still has questions outstanding", async () => {
      const user = await createUser();
      const started = await start(user, 1);
      const res = await api().post(`/api/v1/match/attempts/${started.body.attempt.id}/finish`).set(user.auth);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ATTEMPT_IN_PROGRESS");
    });
  });

  describe("levels and progress", () => {
    it("unlocks only level 1 by default and rejects a locked level", async () => {
      const user = await createUser();
      const levels = await api().get("/api/v1/match/levels").set(user.auth);
      expect(levels.body.levels.length).toBeGreaterThanOrEqual(10);
      expect(levels.body.levels.map((l: any) => l.unlocked).slice(0, 3)).toEqual([true, false, false]);
      expect(levels.body.timer).toEqual({ minSeconds: 1, maxSeconds: 7, defaultSeconds: 5 });

      const locked = await start(user, 2);
      expect(locked.status).toBe(403);
      expect(locked.body.code).toBe("LEVEL_LOCKED");
    });

    it("unlocks the next level only when every question is answered correctly", async () => {
      const user = await createUser();

      const failed = await playLevel(user, 1, 1);
      expect(failed.result).toMatchObject({ correct: 2, total: 3, passed: false, nextLevelUnlocked: false });
      expect((await start(user, 2)).status).toBe(403);

      const passed = await playLevel(user, 1);
      expect(passed.result).toMatchObject({ correct: 3, total: 3, passed: true, nextLevel: 2, nextLevelUnlocked: true });
      expect((await start(user, 2)).status).toBe(201);
      expect((await start(user, 3)).status).toBe(403);

      const finish = await api().post(`/api/v1/match/attempts/${passed.id}/finish`).set(user.auth);
      expect(finish.body.result).toMatchObject({ correct: 3, total: 3, passed: true });

      const progress = await api().get("/api/v1/match/progress").set(user.auth);
      expect(progress.body.progress.highestUnlockedLevel).toBe(2);
      const level1 = progress.body.progress.levels.find((l: any) => l.level === 1);
      expect(level1).toMatchObject({ attempts: 2, passed: true, best: { correct: 3, total: 3 } });
    });

    it("gives freshly generated questions on a retry", async () => {
      const user = await createUser();
      const first = await playLevel(user, 1, 0);
      const second = await start(user, 1);
      expect(second.status).toBe(201);
      expect(second.body.attempt.id).not.toBe(first.id);
      expect(await MatchQuestionModel.countDocuments({ attemptId: second.body.attempt.id })).toBe(3);
    });
  });

  describe("authorization", () => {
    it("requires a session and hides other players' attempts", async () => {
      const owner = await createUser();
      const other = await createUser();
      const started = await start(owner, 1);
      const id = started.body.attempt.id;

      expect((await api().get("/api/v1/match/levels")).status).toBe(401);
      expect((await question(other, id)).status).toBe(404);
      expect((await answer(other, id, 0, "shape:circle")).status).toBe(404);
    });

    it("lets only admins read and edit level configs, and never accepts a timer in one", async () => {
      const player = await createUser();
      const admin = await createUser({ role: "admin" });
      const config = { questionCount: 4, optionCount: 3, categories: ["shapes"], similarity: "medium" };

      expect((await api().get("/api/v1/admin/match/levels").set(player.auth)).status).toBe(403);
      expect((await api().put("/api/v1/admin/match/levels/1").set(player.auth).send(config)).status).toBe(403);
      expect((await api().get("/api/v1/admin/match/levels")).status).toBe(401);

      const saved = await api().put("/api/v1/admin/match/levels/1").set(admin.auth).send(config);
      expect(saved.status).toBe(200);
      expect(saved.body.level).toMatchObject({ level: 1, questionCount: 4, optionCount: 3 });
      const started = await start(player, 1);
      expect(started.body.attempt.questionCount).toBe(4);

      const withTimer = await api()
        .put("/api/v1/admin/match/levels/1")
        .set(admin.auth)
        .send({ ...config, timerSeconds: 3 });
      expect(withTimer.status).toBe(400);
      expect(withTimer.body.code).toBe("TIMER_NOT_IN_LEVEL_CONFIG");

      const tooMany = await api()
        .put("/api/v1/admin/match/levels/1")
        .set(admin.auth)
        .send({ ...config, optionCount: 20 });
      expect(tooMany.status).toBe(400);
    });
  });
});
