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
exports.findReferrer = findReferrer;
exports.captureReferralAtSignup = captureReferralAtSignup;
exports.checkReferralQualification = checkReferralQualification;
const mongoose_1 = __importDefault(require("mongoose"));
const user_model_1 = __importDefault(require("../models/user.model"));
const referral_model_1 = __importDefault(require("../models/referral.model"));
const referralEvent_model_1 = __importDefault(require("../models/referralEvent.model"));
const config_service_1 = require("./config/config.service");
/**
 * Resolves a referrer from a lookup string that may be a Mongo _id, a
 * username, or an email. Previously duplicated 3x inline in auth.controller.ts
 * (googleAuth, registerGamer, activateUser).
 */
function findReferrer(refLookup) {
    const conditions = [{ username: refLookup }, { email: refLookup }];
    if (mongoose_1.default.isValidObjectId(refLookup))
        conditions.unshift({ _id: refLookup });
    return user_model_1.default.findOne({ $or: conditions });
}
/**
 * Captures a referral relationship at signup time. Safe to call for every
 * signup path — swallows duplicate/invalid errors the same way the inline
 * implementations did (referredUserId is unique, so a second capture attempt
 * for the same user is a silent no-op).
 */
function captureReferralAtSignup(refLookup, newUserId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!refLookup)
            return;
        try {
            const refUser = yield findReferrer(refLookup);
            if (!refUser || String(refUser._id) === String(newUserId))
                return;
            yield referral_model_1.default.create({
                referrerId: String(refUser._id),
                referredUserId: String(newUserId),
            });
            yield referralEvent_model_1.default.create({
                referrerId: String(refUser._id),
                referredUserId: String(newUserId),
                eventType: "signup",
            });
        }
        catch (e) {
            // ignore duplicate referral (unique index on referredUserId) or lookup errors
        }
    });
}
/**
 * Called after every points-ledger award (see pointsLedger.service.ts
 * awardPoints). If `refereeUserId` has a pending referral and their lifetime
 * points have now crossed the configured threshold (default 21 — ~3 session
 * completions at 7pts each), credits the referrer's bonus points (default 5)
 * and marks the referral successful. A no-op if there's no pending referral
 * or the threshold hasn't been reached yet.
 */
function checkReferralQualification(refereeUserId) {
    return __awaiter(this, void 0, void 0, function* () {
        const referral = yield referral_model_1.default.findOne({
            referredUserId: refereeUserId,
            successful: false,
        });
        if (!referral)
            return;
        // Lazy require to avoid a circular top-level import with pointsLedger.service.ts
        // (that module calls checkReferralQualification, this one calls its awardPoints/
        // getUserLifetimePoints — both are only invoked inside async function bodies,
        // well after both modules have finished loading, so this is safe).
        const { getUserLifetimePoints, awardPoints, } = require("./points/pointsLedger.service");
        const threshold = yield (0, config_service_1.getReferralPointsThreshold)();
        const refereeTotal = yield getUserLifetimePoints(refereeUserId);
        if (refereeTotal < threshold)
            return;
        const bonusPoints = yield (0, config_service_1.getReferrerBonusPoints)();
        referral.successful = true;
        referral.successfulAt = new Date();
        referral.pointsAwarded = bonusPoints;
        yield referral.save();
        yield referralEvent_model_1.default.create({
            referrerId: referral.referrerId,
            referredUserId: referral.referredUserId,
            eventType: "points_threshold_reached",
        });
        yield awardPoints({
            userId: referral.referrerId,
            points: bonusPoints,
            source: "referral_bonus",
            sourceRefId: String(referral._id),
        });
    });
}
