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
exports.rejectSubmission = exports.verifySubmission = exports.listWinnerShareSubmissions = exports.getMyWinnerShareSubmissions = exports.createWinnerShareSubmission = exports.resolveFlag = exports.listFlags = exports.flagForumPost = exports.unlikeForumPost = exports.likeForumPost = exports.listPosts = exports.createPost = exports.listThreads = exports.createThread = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const forumThread_model_1 = __importDefault(require("../models/forumThread.model"));
const forumPost_model_1 = __importDefault(require("../models/forumPost.model"));
const forumFlag_model_1 = __importDefault(require("../models/forumFlag.model"));
const winnerShareSubmission_model_1 = __importDefault(require("../models/winnerShareSubmission.model"));
const forum_service_1 = require("../services/forum.service");
function handleForumError(error, next) {
    if (error instanceof forum_service_1.ForumError) {
        return next(new ErrorHandler_1.default(error.message, error.statusCode));
    }
    return next(new ErrorHandler_1.default(error.message || "Forum operation failed", 500));
}
// POST /forum/threads  { title, category? }
exports.createThread = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { title, category } = req.body;
        if (!title || typeof title !== "string" || !title.trim()) {
            return next(new ErrorHandler_1.default("title is required", 400));
        }
        const thread = yield forumThread_model_1.default.create({
            title: title.trim(),
            createdBy: userId,
            category,
        });
        res.status(201).json({ success: true, thread });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// GET /forum/threads
exports.listThreads = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const threads = yield forumThread_model_1.default.find({})
            .sort({ pinned: -1, createdAt: -1 })
            .lean();
        res.status(200).json({ success: true, threads });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// POST /forum/threads/:id/posts  { body, imageUrls? }
exports.createPost = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { id: threadId } = req.params;
        const { body, imageUrls } = req.body;
        if (!body || typeof body !== "string" || !body.trim()) {
            return next(new ErrorHandler_1.default("body is required", 400));
        }
        const thread = yield forumThread_model_1.default.findById(threadId);
        if (!thread)
            return next(new ErrorHandler_1.default("Thread not found", 404));
        if (thread.locked)
            return next(new ErrorHandler_1.default("This thread is locked", 400));
        const post = yield forumPost_model_1.default.create({
            threadId,
            userId,
            body: body.trim(),
            imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
        });
        res.status(201).json({ success: true, post });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// GET /forum/threads/:id/posts
exports.listPosts = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id: threadId } = req.params;
        const posts = yield forumPost_model_1.default.find({
            threadId,
            moderationStatus: { $ne: "removed" },
        })
            .sort({ createdAt: 1 })
            .lean();
        res.status(200).json({ success: true, posts });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// POST /forum/posts/:id/like
exports.likeForumPost = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { id: postId } = req.params;
        const liked = yield (0, forum_service_1.likePost)(postId, userId);
        res.status(200).json({ success: true, liked });
    }
    catch (error) {
        handleForumError(error, next);
    }
}));
// DELETE /forum/posts/:id/like
exports.unlikeForumPost = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { id: postId } = req.params;
        const unliked = yield (0, forum_service_1.unlikePost)(postId, userId);
        res.status(200).json({ success: true, unliked });
    }
    catch (error) {
        handleForumError(error, next);
    }
}));
// POST /forum/posts/:id/flag  { reason }
exports.flagForumPost = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { id: postId } = req.params;
        const { reason } = req.body;
        if (!reason)
            return next(new ErrorHandler_1.default("reason is required", 400));
        const flag = yield forumFlag_model_1.default.create({ postId, flaggedBy: userId, reason });
        res.status(201).json({ success: true, flag });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// GET /forum/moderation/flags?status=open (admin)
exports.listFlags = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const status = req.query.status || "open";
        const flags = yield forumFlag_model_1.default.find({ status }).sort({ createdAt: -1 }).lean();
        res.status(200).json({ success: true, flags });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// PATCH /forum/moderation/flags/:id  { status, hidePost? } (admin)
exports.resolveFlag = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status, hidePost } = req.body;
        if (!status || !["resolved", "dismissed"].includes(status)) {
            return next(new ErrorHandler_1.default("status must be 'resolved' or 'dismissed'", 400));
        }
        const flag = yield forumFlag_model_1.default.findById(id);
        if (!flag)
            return next(new ErrorHandler_1.default("Flag not found", 404));
        flag.status = status;
        yield flag.save();
        if (hidePost && status === "resolved") {
            yield forumPost_model_1.default.findByIdAndUpdate(flag.postId, {
                moderationStatus: "hidden",
            });
        }
        res.status(200).json({ success: true, flag });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// POST /forum/winner-submissions  { campaignId, postUrl, claimedLikeCount? }
exports.createWinnerShareSubmission = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const { campaignId, postUrl, claimedLikeCount } = req.body;
        if (!campaignId || !postUrl) {
            return next(new ErrorHandler_1.default("campaignId and postUrl are required", 400));
        }
        const submission = yield winnerShareSubmission_model_1.default.create({
            userId,
            campaignId,
            postUrl,
            claimedLikeCount,
        });
        res.status(201).json({ success: true, submission });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// GET /forum/winner-submissions/mine
exports.getMyWinnerShareSubmissions = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.user._id);
        const submissions = yield winnerShareSubmission_model_1.default.find({ userId })
            .sort({ createdAt: -1 })
            .lean();
        res.status(200).json({ success: true, submissions });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// GET /forum/winner-submissions?status=submitted (admin)
exports.listWinnerShareSubmissions = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const status = req.query.status;
        const filter = status ? { status } : {};
        const submissions = yield winnerShareSubmission_model_1.default.find(filter)
            .sort({ createdAt: -1 })
            .lean();
        res.status(200).json({ success: true, submissions });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
}));
// POST /forum/winner-submissions/:id/verify  { adminNotes? } (admin)
exports.verifySubmission = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const adminId = String(req.user._id);
        const { id } = req.params;
        const { adminNotes } = req.body;
        const submission = yield (0, forum_service_1.verifyWinnerShareSubmission)(id, adminId, adminNotes);
        res.status(200).json({ success: true, submission });
    }
    catch (error) {
        handleForumError(error, next);
    }
}));
// POST /forum/winner-submissions/:id/reject  { adminNotes? } (admin)
exports.rejectSubmission = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const adminId = String(req.user._id);
        const { id } = req.params;
        const { adminNotes } = req.body;
        const submission = yield (0, forum_service_1.rejectWinnerShareSubmission)(id, adminId, adminNotes);
        res.status(200).json({ success: true, submission });
    }
    catch (error) {
        handleForumError(error, next);
    }
}));
