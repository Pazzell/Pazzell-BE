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
exports.getTransactionHistory = exports.getCampaignBudget = exports.paystackWebhook = exports.verifyPayment = exports.initializePayment = exports.calculateProration = void 0;
exports.computeProration = computeProration;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const transaction_model_1 = __importDefault(require("../models/transaction.model"));
const puzzleCampaign_model_1 = __importDefault(require("../models/puzzleCampaign.model"));
const payment_1 = require("../services/payment");
const queueFactory_1 = require("../services/queue/queueFactory");
const notificationFactory_1 = require("../services/notification/notificationFactory");
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
// Log payment configuration on startup
console.log("✅ Payment Gateway: Paystack");
console.log("✅ Frontend URL configured:", FRONTEND_URL);
if (process.env.PAYSTACK_SECRET_KEY) {
    console.log("✅ Paystack is configured");
}
else {
    console.warn("⚠️  Paystack is not configured - PAYSTACK_SECRET_KEY missing");
}
// Package pricing (monthly)
const PACKAGE_PRICES = {
    basic: 7000, // ₦7,000/month
    premium: 10000, // ₦10,000/month
};
// Shared proration calculation helper
function computeProration(packageType, endMonth // YYYY-MM
) {
    const basePrice = PACKAGE_PRICES[packageType];
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonthIdx = today.getMonth(); // 0-indexed
    const todayDay = today.getDate();
    const [endYear, endMonthNum] = endMonth.split("-").map(Number);
    const endMonthIdx = endMonthNum - 1; // 0-indexed
    // Validate: endMonth must be current month or in the future
    if (endYear < todayYear ||
        (endYear === todayYear && endMonthIdx < todayMonthIdx)) {
        throw new Error("endMonth cannot be in the past");
    }
    // Days in current month
    const daysInCurrentMonth = new Date(todayYear, todayMonthIdx + 1, 0).getDate();
    // Days remaining from tomorrow to end of current month
    const daysRemaining = daysInCurrentMonth - todayDay;
    const breakdown = [];
    const currentMonthLabel = `${todayYear}-${String(todayMonthIdx + 1).padStart(2, "0")}`;
    const proratedCurrentMonth = daysRemaining > 0
        ? Math.round((basePrice / daysInCurrentMonth) * daysRemaining)
        : 0;
    if (daysRemaining > 0) {
        breakdown.push({
            month: currentMonthLabel,
            days: daysRemaining,
            amount: proratedCurrentMonth,
            type: "prorated",
        });
    }
    // Same month — prorated only
    if (endYear === todayYear && endMonthIdx === todayMonthIdx) {
        return {
            packageType,
            baseMonthlyPrice: basePrice,
            proratedCurrentMonth,
            futureMonthsAmount: 0,
            totalAmount: proratedCurrentMonth,
            breakdown,
            timeLimitHours: Math.round((daysRemaining * 24)),
        };
    }
    // Add full months from next month to endMonth inclusive
    let futureMonthsAmount = 0;
    let curYear = todayYear;
    let curMonthIdx = todayMonthIdx + 1;
    if (curMonthIdx > 11) {
        curMonthIdx = 0;
        curYear++;
    }
    while (curYear < endYear ||
        (curYear === endYear && curMonthIdx <= endMonthIdx)) {
        const daysInMonth = new Date(curYear, curMonthIdx + 1, 0).getDate();
        const monthLabel = `${curYear}-${String(curMonthIdx + 1).padStart(2, "0")}`;
        breakdown.push({
            month: monthLabel,
            days: daysInMonth,
            amount: basePrice,
            type: "full",
        });
        futureMonthsAmount += basePrice;
        curMonthIdx++;
        if (curMonthIdx > 11) {
            curMonthIdx = 0;
            curYear++;
        }
    }
    // Total campaign hours from now to end of endMonth
    const endOfEndMonth = new Date(endYear, endMonthNum, 0, 23, 59, 59, 999);
    const timeLimitMs = endOfEndMonth.getTime() - today.getTime();
    const timeLimitHours = Math.max(1, Math.round(timeLimitMs / (1000 * 60 * 60)));
    return {
        packageType,
        baseMonthlyPrice: basePrice,
        proratedCurrentMonth,
        futureMonthsAmount,
        totalAmount: proratedCurrentMonth + futureMonthsAmount,
        breakdown,
        timeLimitHours,
    };
}
// GET /payments/calculate-proration?packageType=basic&endMonth=2026-07
exports.calculateProration = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { packageType, endMonth } = req.query;
        if (!packageType || !["basic", "premium"].includes(packageType)) {
            return next(new ErrorHandler_1.default("packageType must be 'basic' or 'premium'", 400));
        }
        if (!endMonth || !/^\d{4}-\d{2}$/.test(endMonth)) {
            return next(new ErrorHandler_1.default("endMonth must be in YYYY-MM format", 400));
        }
        let result;
        try {
            result = computeProration(packageType, endMonth);
        }
        catch (e) {
            return next(new ErrorHandler_1.default(e.message, 400));
        }
        res.status(200).json({ success: true, proration: result });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to calculate proration: ${error.message}`, 500));
    }
}));
// Initialize payment for campaign
exports.initializePayment = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { campaignId, email } = req.body;
        const user = req.user;
        if (!campaignId || !email) {
            return next(new ErrorHandler_1.default("Missing required fields: campaignId, email", 400));
        }
        // Check if Paystack is configured
        if (!process.env.PAYSTACK_SECRET_KEY) {
            return next(new ErrorHandler_1.default("Payment gateway is not configured", 400));
        }
        // Check if campaign exists
        const campaign = yield puzzleCampaign_model_1.default.findById(campaignId);
        if (!campaign) {
            return next(new ErrorHandler_1.default("Campaign not found", 404));
        }
        // Verify brand owns this campaign
        if (campaign.brandId !== String(user._id)) {
            return next(new ErrorHandler_1.default("You are not authorized to pay for this campaign", 403));
        }
        // Use the pre-calculated expectedChargeAmount (discounted) if available,
        // otherwise fallback to campaign.totalBudget or package base price
        const amount = campaign.expectedChargeAmount ||
            campaign.totalBudget ||
            PACKAGE_PRICES[campaign.packageType] ||
            0;
        const packageType = campaign.packageType || "basic";
        console.log("Payment Debug:", {
            expectedChargeAmount: campaign.expectedChargeAmount,
            totalBudget: campaign.totalBudget,
            packageType: campaign.packageType,
            calculatedAmount: amount,
        });
        if (amount <= 0) {
            return next(new ErrorHandler_1.default("Invalid payment amount. Please check campaign pricing.", 400));
        }
        const reference = `campaign_${campaignId}_${Date.now()}_${Math.random()
            .toString(36)
            .substring(7)}`;
        // Create transaction record
        const transaction = yield transaction_model_1.default.create({
            campaignId,
            brandId: user._id,
            packageType,
            amount,
            currency: "NGN",
            reference,
            status: "pending",
        });
        // Initialize payment with Paystack
        const paymentResponse = yield payment_1.paystackService.initialize({
            email,
            amount,
            reference,
            currency: "NGN",
            callbackUrl: `${FRONTEND_URL}/payment/verify?reference=${reference}`,
            metadata: {
                campaignId,
                brandId: user._id,
                packageType,
                transactionId: String(transaction._id),
            },
        });
        res.status(200).json({
            success: true,
            data: {
                authorization_url: paymentResponse.authorizationUrl,
                access_code: paymentResponse.accessCode,
                reference,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to initialize payment: ${error.message}`, 500));
    }
}));
// Verify payment
exports.verifyPayment = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { reference } = req.params;
        const user = req.user;
        if (!reference) {
            return next(new ErrorHandler_1.default("Payment reference is required", 400));
        }
        // Find transaction
        const transaction = yield transaction_model_1.default.findOne({ reference });
        if (!transaction) {
            return next(new ErrorHandler_1.default("Transaction not found", 404));
        }
        // Validate that the transaction belongs to the requesting brand
        if (String(transaction.brandId) !== String(user._id)) {
            return next(new ErrorHandler_1.default("You are not authorized to verify this payment reference", 403));
        }
        // Validate that the transaction belongs to the campaign
        const campaign = yield puzzleCampaign_model_1.default.findById(transaction.campaignId);
        if (!campaign) {
            return next(new ErrorHandler_1.default("Campaign not found", 404));
        }
        if (String(campaign.brandId) !== String(user._id)) {
            return next(new ErrorHandler_1.default("This payment reference does not belong to your campaign", 403));
        }
        // Verify with Paystack
        const verifyResponse = yield payment_1.paystackService.verify(reference);
        if (verifyResponse.success) {
            // Update transaction
            transaction.status = "success";
            transaction.paystackResponse = verifyResponse.rawResponse;
            yield transaction.save();
            // Update campaign with payment details and activate it
            const packageType = transaction.packageType;
            const now = new Date();
            const timeLimitInHours = campaign.timeLimit;
            const endDate = new Date(now.getTime() + timeLimitInHours * 60 * 60 * 1000);
            // Use the charged amount as the campaign's allocated budget
            const allocatedBudget = transaction.amount || 0;
            const days = Math.max(1, Math.ceil((campaign.timeLimit || 168) / 24));
            const dailyAllocation = Number((allocatedBudget / days).toFixed(2));
            campaign.packageType = packageType;
            campaign.totalBudget = allocatedBudget;
            campaign.dailyAllocation = dailyAllocation;
            campaign.budgetRemaining = allocatedBudget;
            campaign.budgetUsed = 0;
            campaign.paymentStatus = "paid";
            campaign.transactionId = String(transaction._id);
            campaign.status = "active";
            campaign.startDate = now;
            campaign.endDate = endDate;
            yield campaign.save();
            // Enqueue payment event (no-op when PAYMENT_QUEUE_PROVIDER=none)
            (0, queueFactory_1.getPaymentQueue)().enqueue({
                reference: transaction.reference,
                transactionId: String(transaction._id),
                campaignId: String(transaction.campaignId),
                brandId: String(transaction.brandId),
                amount: transaction.amount,
                currency: transaction.currency || "NGN",
                event: "payment.verified",
                timestamp: new Date().toISOString(),
            }).catch((e) => console.error("Queue enqueue error:", e));
            // Publish notification (no-op when NOTIFICATION_PROVIDER=none)
            (0, notificationFactory_1.getNotificationService)().publish({
                subject: "Payment Verified",
                message: `Payment ${transaction.reference} verified for campaign ${transaction.campaignId}`,
                topicKey: "payment",
                metadata: {
                    reference: transaction.reference,
                    campaignId: String(transaction.campaignId),
                },
            }).catch((e) => console.error("SNS publish error:", e));
            res.status(200).json({
                success: true,
                message: "Payment verified successfully",
                transaction: {
                    reference: transaction.reference,
                    amount: transaction.amount,
                    status: transaction.status,
                    packageType: transaction.packageType,
                },
            });
        }
        else {
            transaction.status = "failed";
            transaction.paystackResponse = verifyResponse.rawResponse;
            yield transaction.save();
            res.status(400).json({
                success: false,
                message: "Payment verification failed",
                status: verifyResponse.status,
            });
        }
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to verify payment: ${error.message}`, 500));
    }
}));
// Helper function to activate campaign after successful payment
function activateCampaignAfterPayment(transaction, paymentData) {
    return __awaiter(this, void 0, void 0, function* () {
        const campaign = yield puzzleCampaign_model_1.default.findById(transaction.campaignId);
        if (campaign) {
            const packageType = transaction.packageType;
            const now = new Date();
            const timeLimitInHours = campaign.timeLimit;
            const endDate = new Date(now.getTime() + timeLimitInHours * 60 * 60 * 1000);
            // Use the charged amount as the campaign's allocated budget
            const allocatedBudget = transaction.amount || 0;
            const days = Math.max(1, Math.ceil((campaign.timeLimit || 168) / 24));
            const dailyAllocation = Number((allocatedBudget / days).toFixed(2));
            campaign.packageType = packageType;
            campaign.totalBudget = allocatedBudget;
            campaign.dailyAllocation = dailyAllocation;
            campaign.budgetRemaining = allocatedBudget;
            campaign.budgetUsed = 0;
            campaign.paymentStatus = "paid";
            campaign.transactionId = String(transaction._id);
            campaign.status = "active";
            campaign.startDate = now;
            campaign.endDate = endDate;
            yield campaign.save();
        }
    });
}
// Paystack webhook for payment notifications
exports.paystackWebhook = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const validationResult = payment_1.paystackService.validateWebhook(req.headers, req.body);
        if (!validationResult.isValid) {
            return res.status(400).send("Invalid signature");
        }
        const event = req.body;
        if (event.event === "charge.success") {
            const { reference } = event.data;
            // Find and update transaction
            const transaction = yield transaction_model_1.default.findOne({ reference });
            if (transaction && transaction.status === "pending") {
                transaction.status = "success";
                transaction.paystackResponse = event.data;
                yield transaction.save();
                // Activate campaign
                yield activateCampaignAfterPayment(transaction, event.data);
                // Enqueue webhook payment event (no-op when PAYMENT_QUEUE_PROVIDER=none)
                (0, queueFactory_1.getPaymentQueue)().enqueue({
                    reference,
                    transactionId: String(transaction._id),
                    campaignId: String(transaction.campaignId),
                    brandId: String(transaction.brandId),
                    amount: transaction.amount,
                    currency: transaction.currency || "NGN",
                    event: "webhook.received",
                    rawPaystackData: event.data,
                    timestamp: new Date().toISOString(),
                }).catch((e) => console.error("Queue enqueue error:", e));
                // Publish notification (no-op when NOTIFICATION_PROVIDER=none)
                (0, notificationFactory_1.getNotificationService)().publish({
                    subject: "Webhook Payment Success",
                    message: `Webhook charge.success for reference ${reference}`,
                    topicKey: "payment",
                    metadata: { reference, campaignId: String(transaction.campaignId) },
                }).catch((e) => console.error("SNS publish error:", e));
            }
        }
        res.status(200).send("Webhook received");
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Webhook processing failed: ${error.message}`, 500));
    }
}));
// Get campaign budget status
exports.getCampaignBudget = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { campaignId } = req.params;
        const campaign = yield puzzleCampaign_model_1.default.findById(campaignId);
        if (!campaign) {
            return next(new ErrorHandler_1.default("Campaign not found", 404));
        }
        const daysRemaining = Math.ceil((new Date(campaign.endDate).getTime() - new Date().getTime()) /
            (1000 * 60 * 60 * 24));
        res.status(200).json({
            success: true,
            budget: {
                packageType: campaign.packageType,
                totalBudget: campaign.totalBudget,
                dailyAllocation: campaign.dailyAllocation,
                budgetUsed: campaign.budgetUsed,
                budgetRemaining: campaign.budgetRemaining,
                paymentStatus: campaign.paymentStatus,
                daysRemaining,
                startDate: campaign.startDate,
                endDate: campaign.endDate,
            },
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch campaign budget: ${error.message}`, 500));
    }
}));
// Get transaction history for a brand
exports.getTransactionHistory = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const transactions = yield transaction_model_1.default.find({ brandId: user._id })
            .sort({ createdAt: -1 })
            .lean();
        res.status(200).json({
            success: true,
            transactions,
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(`Failed to fetch transaction history: ${error.message}`, 500));
    }
}));
