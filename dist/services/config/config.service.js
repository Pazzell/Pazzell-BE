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
exports.getAntiCheatFloors = exports.getVideoLimits = exports.getQuizQuestionCount = exports.getWinnerShareBonusPoints = exports.getSessionCompletionPoints = exports.getReferrerBonusPoints = exports.getReferralPointsThreshold = exports.getRaffleEligibilityFloorCap = exports.getRankDistribution = exports.getPayoutSplit = exports.getWeeklyPrice = exports.CONFIG_DEFAULTS = void 0;
exports.initConfigCache = initConfigCache;
exports.getConfigValue = getConfigValue;
exports.setConfigValue = setConfigValue;
exports.getAllConfig = getAllConfig;
const config_model_1 = __importDefault(require("../../models/config.model"));
/**
 * Default values used when a key is missing from the DB (fresh install,
 * or a key that was never explicitly seeded/overridden by an admin).
 * Keep this in sync with the keys documented in the migration plan.
 */
exports.CONFIG_DEFAULTS = {
    "pricing.basic.weeklyPrice": 7000, // NGN
    "pricing.premium.weeklyPrice": 10000, // NGN
    "payout.playerSharePercent": 50,
    "payout.platformSharePercent": 50,
    "payout.rankDistribution": [
        { position: 1, percentage: 20 },
        { position: 2, percentage: 15 },
        { position: 3, percentage: 10 },
        { position: 4, percentage: 7.875 },
        { position: 5, percentage: 7.875 },
        { position: 6, percentage: 7.875 },
        { position: 7, percentage: 7.875 },
        { position: 8, percentage: 7.875 },
        { position: 9, percentage: 7.875 },
        { position: 10, percentage: 7.875 },
    ],
    "raffle.eligibilityFloorCap": 3,
    "referral.pointsThreshold": 21,
    "referral.referrerBonusPoints": 5,
    "points.sessionCompletionPoints": 7,
    "forum.winnerShareBonusPoints": 5,
    "campaign.quizQuestionCount": 3,
    "video.maxDurationSeconds": 130, // ~2 minutes + small buffer
    "video.maxSizeBytes": 10 * 1024 * 1024, // 10MB
    "anticheat.softFloorMs": {
        sliding_puzzle: 3000,
        card_matching: 3000,
        spot_the_difference: 3000,
        word_hunt: 3000,
        video: 0, // set per-campaign at read time (fraction of videoDurationSeconds)
        quiz: 1000,
    },
    "anticheat.hardFloorMs": {
        sliding_puzzle: 500,
        card_matching: 500,
        spot_the_difference: 500,
        word_hunt: 500,
        video: 0,
        quiz: 200,
    },
    "anticheat.videoMinWatchFraction": 0.8, // below this fraction of video length watched -> soft flag
    "anticheat.videoHardWatchFraction": 0.2, // below this fraction -> hard void
};
let _cache = null;
let _loadingPromise = null;
function loadCache() {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield config_model_1.default.find({}).lean();
        const map = new Map();
        for (const row of rows) {
            map.set(row.key, row.value);
        }
        return map;
    });
}
/**
 * Loads all Config rows into an in-process cache. Missing keys fall back to
 * CONFIG_DEFAULTS so a fresh/empty DB never crashes a scheduled job.
 */
function initConfigCache() {
    return __awaiter(this, void 0, void 0, function* () {
        _cache = yield loadCache();
    });
}
function ensureCache() {
    return __awaiter(this, void 0, void 0, function* () {
        if (_cache)
            return _cache;
        if (!_loadingPromise) {
            _loadingPromise = loadCache().then((map) => {
                _cache = map;
                _loadingPromise = null;
                return map;
            });
        }
        return _loadingPromise;
    });
}
function getConfigValue(key) {
    return __awaiter(this, void 0, void 0, function* () {
        const cache = yield ensureCache();
        if (cache.has(key))
            return cache.get(key);
        if (key in exports.CONFIG_DEFAULTS)
            return exports.CONFIG_DEFAULTS[key];
        throw new Error(`Config key "${key}" has no stored value and no default`);
    });
}
/** Admin write path: upserts the value, then invalidates/reloads the cache. */
function setConfigValue(key, value, updatedBy, description) {
    return __awaiter(this, void 0, void 0, function* () {
        yield config_model_1.default.findOneAndUpdate({ key }, Object.assign({ key, value, updatedBy }, (description ? { description } : {})), { upsert: true, new: true });
        _cache = null; // force reload on next access
    });
}
function getAllConfig() {
    return __awaiter(this, void 0, void 0, function* () {
        const cache = yield ensureCache();
        const merged = Object.assign({}, exports.CONFIG_DEFAULTS);
        for (const [k, v] of cache.entries())
            merged[k] = v;
        return merged;
    });
}
// Typed convenience getters -------------------------------------------------
const getWeeklyPrice = (packageType) => __awaiter(void 0, void 0, void 0, function* () { return getConfigValue(`pricing.${packageType}.weeklyPrice`); });
exports.getWeeklyPrice = getWeeklyPrice;
const getPayoutSplit = () => __awaiter(void 0, void 0, void 0, function* () {
    return ({
        playerSharePercent: yield getConfigValue("payout.playerSharePercent"),
        platformSharePercent: yield getConfigValue("payout.platformSharePercent"),
    });
});
exports.getPayoutSplit = getPayoutSplit;
const getRankDistribution = () => __awaiter(void 0, void 0, void 0, function* () { return getConfigValue("payout.rankDistribution"); });
exports.getRankDistribution = getRankDistribution;
const getRaffleEligibilityFloorCap = () => __awaiter(void 0, void 0, void 0, function* () { return getConfigValue("raffle.eligibilityFloorCap"); });
exports.getRaffleEligibilityFloorCap = getRaffleEligibilityFloorCap;
const getReferralPointsThreshold = () => __awaiter(void 0, void 0, void 0, function* () { return getConfigValue("referral.pointsThreshold"); });
exports.getReferralPointsThreshold = getReferralPointsThreshold;
const getReferrerBonusPoints = () => __awaiter(void 0, void 0, void 0, function* () { return getConfigValue("referral.referrerBonusPoints"); });
exports.getReferrerBonusPoints = getReferrerBonusPoints;
const getSessionCompletionPoints = () => __awaiter(void 0, void 0, void 0, function* () { return getConfigValue("points.sessionCompletionPoints"); });
exports.getSessionCompletionPoints = getSessionCompletionPoints;
const getWinnerShareBonusPoints = () => __awaiter(void 0, void 0, void 0, function* () { return getConfigValue("forum.winnerShareBonusPoints"); });
exports.getWinnerShareBonusPoints = getWinnerShareBonusPoints;
const getQuizQuestionCount = () => __awaiter(void 0, void 0, void 0, function* () { return getConfigValue("campaign.quizQuestionCount"); });
exports.getQuizQuestionCount = getQuizQuestionCount;
const getVideoLimits = () => __awaiter(void 0, void 0, void 0, function* () {
    return ({
        maxDurationSeconds: yield getConfigValue("video.maxDurationSeconds"),
        maxSizeBytes: yield getConfigValue("video.maxSizeBytes"),
    });
});
exports.getVideoLimits = getVideoLimits;
const getAntiCheatFloors = () => __awaiter(void 0, void 0, void 0, function* () {
    return ({
        softFloorMs: yield getConfigValue("anticheat.softFloorMs"),
        hardFloorMs: yield getConfigValue("anticheat.hardFloorMs"),
        videoMinWatchFraction: yield getConfigValue("anticheat.videoMinWatchFraction"),
        videoHardWatchFraction: yield getConfigValue("anticheat.videoHardWatchFraction"),
    });
});
exports.getAntiCheatFloors = getAntiCheatFloors;
