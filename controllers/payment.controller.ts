import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import TransactionModel from "../models/transaction.model";
import PuzzleCampaignModel from "../models/puzzleCampaign.model";
import { paystackService } from "../services/payment";
import { getPaymentQueue } from "../services/queue/queueFactory";
import { getNotificationService } from "../services/notification/notificationFactory";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Log payment configuration on startup
console.log("✅ Payment Gateway: Paystack");
console.log("✅ Frontend URL configured:", FRONTEND_URL);

if (process.env.PAYSTACK_SECRET_KEY) {
  console.log("✅ Paystack is configured");
} else {
  console.warn("⚠️  Paystack is not configured - PAYSTACK_SECRET_KEY missing");
}

// Package pricing
const PACKAGE_PRICES = {
  basic: 7000, // ₦7,000
  premium: 10000, // ₦10,000
};

// Initialize payment for campaign
export const initializePayment = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { campaignId, email } = req.body;
      const user = req.user as any;

      if (!campaignId || !email) {
        return next(
          new ErrorHandler("Missing required fields: campaignId, email", 400)
        );
      }

      // Check if Paystack is configured
      if (!process.env.PAYSTACK_SECRET_KEY) {
        return next(
          new ErrorHandler("Payment gateway is not configured", 400)
        );
      }

      // Check if campaign exists
      const campaign = await PuzzleCampaignModel.findById(campaignId);
      if (!campaign) {
        return next(new ErrorHandler("Campaign not found", 404));
      }

      // Verify brand owns this campaign
      if (campaign.brandId !== String(user._id)) {
        return next(
          new ErrorHandler(
            "You are not authorized to pay for this campaign",
            403
          )
        );
      }

      // Use the pre-calculated expectedChargeAmount (discounted) if available,
      // otherwise fallback to campaign.totalBudget or package base price
      const amount =
        campaign.expectedChargeAmount ||
        campaign.totalBudget ||
        PACKAGE_PRICES[campaign.packageType as "basic" | "premium"] ||
        0;
      const packageType = campaign.packageType || "basic";

      console.log("Payment Debug:", {
        expectedChargeAmount: campaign.expectedChargeAmount,
        totalBudget: campaign.totalBudget,
        packageType: campaign.packageType,
        calculatedAmount: amount,
      });

      if (amount <= 0) {
        return next(
          new ErrorHandler("Invalid payment amount. Please check campaign pricing.", 400)
        );
      }

      const reference = `campaign_${campaignId}_${Date.now()}_${Math.random()
        .toString(36)
        .substring(7)}`;

      // Create transaction record
      const transaction = await TransactionModel.create({
        campaignId,
        brandId: user._id,
        packageType,
        amount,
        currency: "NGN",
        reference,
        status: "pending",
      });

      // Initialize payment with Paystack
      const paymentResponse = await paystackService.initialize({
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
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to initialize payment: ${error.message}`, 500)
      );
    }
  }
);

// Verify payment
export const verifyPayment = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reference } = req.params;
      const user = req.user as any;

      if (!reference) {
        return next(new ErrorHandler("Payment reference is required", 400));
      }

      // Find transaction
      const transaction = await TransactionModel.findOne({ reference });
      if (!transaction) {
        return next(new ErrorHandler("Transaction not found", 404));
      }

      // Validate that the transaction belongs to the requesting brand
      if (String(transaction.brandId) !== String(user._id)) {
        return next(
          new ErrorHandler(
            "You are not authorized to verify this payment reference",
            403
          )
        );
      }

      // Validate that the transaction belongs to the campaign
      const campaign = await PuzzleCampaignModel.findById(
        transaction.campaignId
      );
      if (!campaign) {
        return next(new ErrorHandler("Campaign not found", 404));
      }

      if (String(campaign.brandId) !== String(user._id)) {
        return next(
          new ErrorHandler(
            "This payment reference does not belong to your campaign",
            403
          )
        );
      }

      // Verify with Paystack
      const verifyResponse = await paystackService.verify(reference);

      if (verifyResponse.success) {
        // Update transaction
        transaction.status = "success";
        transaction.paystackResponse = verifyResponse.rawResponse;
        await transaction.save();

        // Update campaign with payment details and activate it
        const packageType = transaction.packageType as "basic" | "premium";
        const now = new Date();
        const timeLimitInHours = campaign.timeLimit;
        const endDate = new Date(
          now.getTime() + timeLimitInHours * 60 * 60 * 1000
        );

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
        await campaign.save();

        // Enqueue payment event (no-op when PAYMENT_QUEUE_PROVIDER=none)
        getPaymentQueue().enqueue({
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
        getNotificationService().publish({
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
      } else {
        transaction.status = "failed";
        transaction.paystackResponse = verifyResponse.rawResponse;
        await transaction.save();

        res.status(400).json({
          success: false,
          message: "Payment verification failed",
          status: verifyResponse.status,
        });
      }
    } catch (error: any) {
      return next(
        new ErrorHandler(`Failed to verify payment: ${error.message}`, 500)
      );
    }
  }
);

// Helper function to activate campaign after successful payment
async function activateCampaignAfterPayment(
  transaction: any,
  paymentData: any
) {
  const campaign = await PuzzleCampaignModel.findById(transaction.campaignId);

  if (campaign) {
    const packageType = transaction.packageType as "basic" | "premium";
    const now = new Date();
    const timeLimitInHours = campaign.timeLimit;
    const endDate = new Date(
      now.getTime() + timeLimitInHours * 60 * 60 * 1000
    );

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
    await campaign.save();
  }
}

// Paystack webhook for payment notifications
export const paystackWebhook = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = paystackService.validateWebhook(
        req.headers,
        req.body
      );

      if (!validationResult.isValid) {
        return res.status(400).send("Invalid signature");
      }

      const event = req.body;

      if (event.event === "charge.success") {
        const { reference } = event.data;

        // Find and update transaction
        const transaction = await TransactionModel.findOne({ reference });
        if (transaction && transaction.status === "pending") {
          transaction.status = "success";
          transaction.paystackResponse = event.data;
          await transaction.save();

          // Activate campaign
          await activateCampaignAfterPayment(transaction, event.data);

          // Enqueue webhook payment event (no-op when PAYMENT_QUEUE_PROVIDER=none)
          getPaymentQueue().enqueue({
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
          getNotificationService().publish({
            subject: "Webhook Payment Success",
            message: `Webhook charge.success for reference ${reference}`,
            topicKey: "payment",
            metadata: { reference, campaignId: String(transaction.campaignId) },
          }).catch((e) => console.error("SNS publish error:", e));
        }
      }

      res.status(200).send("Webhook received");
    } catch (error: any) {
      return next(
        new ErrorHandler(`Webhook processing failed: ${error.message}`, 500)
      );
    }
  }
);

// Get campaign budget status
export const getCampaignBudget = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { campaignId } = req.params;

      const campaign = await PuzzleCampaignModel.findById(campaignId);
      if (!campaign) {
        return next(new ErrorHandler("Campaign not found", 404));
      }

      const daysRemaining = Math.ceil(
        (new Date(campaign.endDate).getTime() - new Date().getTime()) /
          (1000 * 60 * 60 * 24)
      );

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
    } catch (error: any) {
      return next(
        new ErrorHandler(
          `Failed to fetch campaign budget: ${error.message}`,
          500
        )
      );
    }
  }
);

// Get transaction history for a brand
export const getTransactionHistory = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;

      const transactions = await TransactionModel.find({ brandId: user._id })
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({
        success: true,
        transactions,
      });
    } catch (error: any) {
      return next(
        new ErrorHandler(
          `Failed to fetch transaction history: ${error.message}`,
          500
        )
      );
    }
  }
);
