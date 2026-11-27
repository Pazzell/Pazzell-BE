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
exports.ForumError = void 0;
exports.likePost = likePost;
exports.unlikePost = unlikePost;
exports.verifyWinnerShareSubmission = verifyWinnerShareSubmission;
exports.rejectWinnerShareSubmission = rejectWinnerShareSubmission;
const forumPost_model_1 = __importDefault(require("../models/forumPost.model"));
const forumLike_model_1 = __importDefault(require("../models/forumLike.model"));
const winnerShareSubmission_model_1 = __importDefault(require("../models/winnerShareSubmission.model"));
const pointsLedger_service_1 = require("./points/pointsLedger.service");
const config_service_1 = require("./config/config.service");
class ForumError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}
exports.ForumError = ForumError;
function likePost(postId, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield forumLike_model_1.default.create({ postId, userId });
        }
        catch (e) {
            if (e.code === 11000)
                return false; // already liked — no-op
            throw e;
        }
        yield forumPost_model_1.default.findByIdAndUpdate(postId, { $inc: { likeCount: 1 } });
        return true;
    });
}
function unlikePost(postId, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const result = yield forumLike_model_1.default.deleteOne({ postId, userId });
        if (result.deletedCount === 0)
            return false;
        yield forumPost_model_1.default.findByIdAndUpdate(postId, { $inc: { likeCount: -1 } });
        return true;
    });
}
/**
 * Admin verifies a winner-share submission — credits the flat bonus (config-
 * driven, default 5) into the currently-open week via the points ledger.
 * Idempotent: verifying an already-verified submission does not re-credit.
 */
function verifyWinnerShareSubmission(submissionId, adminReviewerId, adminNotes) {
    return __awaiter(this, void 0, void 0, function* () {
        const submission = yield winnerShareSubmission_model_1.default.findById(submissionId);
        if (!submission)
            throw new ForumError("Submission not found", 404);
        if (submission.status === "verified")
            return submission; // idempotent no-op
        if (submission.status === "rejected") {
            throw new ForumError("Cannot verify a previously rejected submission", 400);
        }
        const bonusPoints = yield (0, config_service_1.getWinnerShareBonusPoints)();
        submission.status = "verified";
        submission.adminReviewerId = adminReviewerId;
        submission.adminNotes = adminNotes;
        submission.reviewedAt = new Date();
        submission.bonusPointsGranted = bonusPoints;
        yield submission.save();
        yield (0, pointsLedger_service_1.awardPoints)({
            userId: submission.userId,
            points: bonusPoints,
            source: "winner_share_bonus",
            sourceRefId: String(submission._id),
            campaignId: submission.campaignId,
        });
        return submission;
    });
}
function rejectWinnerShareSubmission(submissionId, adminReviewerId, adminNotes) {
    return __awaiter(this, void 0, void 0, function* () {
        const submission = yield winnerShareSubmission_model_1.default.findById(submissionId);
        if (!submission)
            throw new ForumError("Submission not found", 404);
        if (submission.status === "verified") {
            throw new ForumError("Cannot reject an already-verified submission", 400);
        }
        submission.status = "rejected";
        submission.adminReviewerId = adminReviewerId;
        submission.adminNotes = adminNotes;
        submission.reviewedAt = new Date();
        yield submission.save();
        return submission;
    });
}
