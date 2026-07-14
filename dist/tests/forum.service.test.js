"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const setup_1 = require("./setup");
const forumThread_model_1 = __importDefault(require("../models/forumThread.model"));
const forumPost_model_1 = __importDefault(require("../models/forumPost.model"));
const winnerShareSubmission_model_1 = __importDefault(require("../models/winnerShareSubmission.model"));
const forum_service_1 = require("../services/forum.service");
const pointsLedger_service_1 = require("../services/points/pointsLedger.service");
function createPost() {
    return __awaiter(this, void 0, void 0, function* () {
        const thread = yield forumThread_model_1.default.create({ title: "t", createdBy: "user-1" });
        return forumPost_model_1.default.create({ threadId: String(thread._id), userId: "user-1", body: "hello" });
    });
}
describe("Forum service", () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.connectTestDB)();
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.clearTestDB)();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield (0, setup_1.closeTestDB)();
    }));
    describe("likes", () => {
        it("increments a post's like count and is idempotent on repeat likes", () => __awaiter(void 0, void 0, void 0, function* () {
            const post = yield createPost();
            const first = yield (0, forum_service_1.likePost)(String(post._id), "liker-1");
            const second = yield (0, forum_service_1.likePost)(String(post._id), "liker-1"); // duplicate
            expect(first).toBe(true);
            expect(second).toBe(false);
            const updated = yield forumPost_model_1.default.findById(post._id).lean();
            expect(updated.likeCount).toBe(1);
        }));
        it("decrements the like count on unlike, no-ops if never liked", () => __awaiter(void 0, void 0, void 0, function* () {
            const post = yield createPost();
            yield (0, forum_service_1.likePost)(String(post._id), "liker-1");
            const unliked = yield (0, forum_service_1.unlikePost)(String(post._id), "liker-1");
            const noop = yield (0, forum_service_1.unlikePost)(String(post._id), "liker-1");
            expect(unliked).toBe(true);
            expect(noop).toBe(false);
            const updated = yield forumPost_model_1.default.findById(post._id).lean();
            expect(updated.likeCount).toBe(0);
        }));
    });
    describe("winner-share verification", () => {
        it("credits 5 bonus points to the submitter on verification", () => __awaiter(void 0, void 0, void 0, function* () {
            const submission = yield winnerShareSubmission_model_1.default.create({
                userId: "winner-1",
                campaignId: "campaign-1",
                postUrl: "https://example.com/post/1",
                claimedLikeCount: 25,
            });
            const verified = yield (0, forum_service_1.verifyWinnerShareSubmission)(String(submission._id), "admin-1");
            expect(verified.status).toBe("verified");
            expect(verified.bonusPointsGranted).toBe(5);
            const points = yield (0, pointsLedger_service_1.getUserLifetimePoints)("winner-1");
            expect(points).toBe(5);
        }));
        it("is idempotent — verifying an already-verified submission does not re-credit", () => __awaiter(void 0, void 0, void 0, function* () {
            const submission = yield winnerShareSubmission_model_1.default.create({
                userId: "winner-2",
                campaignId: "campaign-1",
                postUrl: "https://example.com/post/2",
            });
            yield (0, forum_service_1.verifyWinnerShareSubmission)(String(submission._id), "admin-1");
            yield (0, forum_service_1.verifyWinnerShareSubmission)(String(submission._id), "admin-1");
            const points = yield (0, pointsLedger_service_1.getUserLifetimePoints)("winner-2");
            expect(points).toBe(5);
        }));
        it("rejects a submission and prevents later verification", () => __awaiter(void 0, void 0, void 0, function* () {
            const submission = yield winnerShareSubmission_model_1.default.create({
                userId: "winner-3",
                campaignId: "campaign-1",
                postUrl: "https://example.com/post/3",
            });
            const rejected = yield (0, forum_service_1.rejectWinnerShareSubmission)(String(submission._id), "admin-1", "not enough likes");
            expect(rejected.status).toBe("rejected");
            yield expect((0, forum_service_1.verifyWinnerShareSubmission)(String(submission._id), "admin-1")).rejects.toBeInstanceOf(forum_service_1.ForumError);
            const points = yield (0, pointsLedger_service_1.getUserLifetimePoints)("winner-3");
            expect(points).toBe(0);
        }));
        it("cannot reject an already-verified submission", () => __awaiter(void 0, void 0, void 0, function* () {
            const submission = yield winnerShareSubmission_model_1.default.create({
                userId: "winner-4",
                campaignId: "campaign-1",
                postUrl: "https://example.com/post/4",
            });
            yield (0, forum_service_1.verifyWinnerShareSubmission)(String(submission._id), "admin-1");
            yield expect((0, forum_service_1.rejectWinnerShareSubmission)(String(submission._id), "admin-1")).rejects.toBeInstanceOf(forum_service_1.ForumError);
        }));
    });
});
