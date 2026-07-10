import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import BankAccountModel from "../models/bankAccount.model";
import WithdrawalModel from "../models/withdrawal.model";
import {
  getBalance,
  listTransactions,
  debit,
  credit,
  InsufficientBalanceError,
} from "../services/wallet/wallet.service";
import { getTransferService } from "../services/transfer/transferFactory";

// GET /wallet/balance
export const getWalletBalance = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const balance = await getBalance(userId);
      res.status(200).json({ success: true, balance, currency: "NGN" });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// GET /wallet/transactions
export const getWalletTransactions = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const limit = parseInt((req.query.limit as string) || "50", 10);
      const transactions = await listTransactions(userId, limit);
      res.status(200).json({ success: true, transactions });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// POST /wallet/bank-accounts  { accountNumber, bankCode, bankName }
export const addBankAccount = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { accountNumber, bankCode, bankName } = req.body;
      if (!accountNumber || !bankCode || !bankName) {
        return next(
          new ErrorHandler("accountNumber, bankCode, and bankName are required", 400)
        );
      }

      const transferService = getTransferService();
      if (!transferService.isEnabled()) {
        return next(new ErrorHandler("Bank verification is temporarily unavailable", 503));
      }

      let resolved;
      try {
        resolved = await transferService.resolveAccount(accountNumber, bankCode);
      } catch (e: any) {
        return next(new ErrorHandler(e.message, 400));
      }

      const existingCount = await BankAccountModel.countDocuments({ userId });

      const bankAccount = await BankAccountModel.create({
        userId,
        bankCode,
        bankName,
        accountNumber: resolved.accountNumber,
        accountName: resolved.accountName,
        verified: true,
        isDefault: existingCount === 0,
      });

      res.status(201).json({ success: true, bankAccount });
    } catch (error: any) {
      if (error.code === 11000) {
        return next(new ErrorHandler("This bank account is already saved", 409));
      }
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// GET /wallet/bank-accounts
export const listBankAccounts = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const bankAccounts = await BankAccountModel.find({ userId }).sort({ createdAt: -1 }).lean();
      res.status(200).json({ success: true, bankAccounts });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// DELETE /wallet/bank-accounts/:id
export const deleteBankAccount = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { id } = req.params;
      const result = await BankAccountModel.deleteOne({ _id: id, userId });
      if (result.deletedCount === 0) {
        return next(new ErrorHandler("Bank account not found", 404));
      }
      res.status(200).json({ success: true });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

async function reverseWithdrawalDebit(withdrawal: {
  _id: any;
  userId: string;
  amount: number;
}) {
  await credit({
    userId: withdrawal.userId,
    amount: withdrawal.amount,
    reason: "withdrawal_reversal",
    referenceId: String(withdrawal._id),
    idempotencyKey: `withdrawal-reversal:${withdrawal._id}`,
  });
}

// POST /wallet/withdrawals  { bankAccountId, amount, idempotencyKey }
export const createWithdrawal = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { bankAccountId, amount, idempotencyKey } = req.body;

      if (!bankAccountId || !amount || Number(amount) <= 0 || !idempotencyKey) {
        return next(
          new ErrorHandler(
            "bankAccountId, a positive amount, and idempotencyKey are required",
            400
          )
        );
      }

      const existing = await WithdrawalModel.findOne({ idempotencyKey });
      if (existing) {
        return res.status(200).json({ success: true, withdrawal: existing });
      }

      const bankAccount = await BankAccountModel.findOne({ _id: bankAccountId, userId });
      if (!bankAccount) {
        return next(new ErrorHandler("Bank account not found", 404));
      }

      const withdrawal = await WithdrawalModel.create({
        userId,
        bankAccountId,
        amount: Number(amount),
        status: "pending",
        idempotencyKey,
      });

      try {
        await debit({
          userId,
          amount: Number(amount),
          reason: "withdrawal",
          referenceId: String(withdrawal._id),
          idempotencyKey: `withdrawal:${withdrawal._id}`,
        });
      } catch (e: any) {
        withdrawal.status = "failed";
        withdrawal.failureReason =
          e instanceof InsufficientBalanceError ? "Insufficient balance" : e.message;
        await withdrawal.save();
        return next(new ErrorHandler(withdrawal.failureReason!, 400));
      }

      const transferService = getTransferService();
      if (!transferService.isEnabled()) {
        withdrawal.status = "failed";
        withdrawal.failureReason = "Transfer provider not configured";
        await withdrawal.save();
        await reverseWithdrawalDebit(withdrawal);
        return next(new ErrorHandler("Withdrawals are temporarily unavailable", 503));
      }

      try {
        let recipientCode = bankAccount.recipientCode;
        if (!recipientCode) {
          const recipient = await transferService.createRecipient({
            accountNumber: bankAccount.accountNumber,
            bankCode: bankAccount.bankCode,
            accountName: bankAccount.accountName,
          });
          recipientCode = recipient.recipientCode;
          bankAccount.recipientCode = recipientCode;
          await bankAccount.save();
        }

        const transferReference = `withdrawal_${withdrawal._id}_${Date.now()}`;
        const transferResult = await transferService.initiateTransfer({
          amount: Number(amount),
          recipientCode,
          reference: transferReference,
        });

        withdrawal.status = "processing";
        withdrawal.paystackTransferCode = transferResult.transferCode;
        withdrawal.paystackTransferReference = transferReference;
        await withdrawal.save();
      } catch (e: any) {
        withdrawal.status = "failed";
        withdrawal.failureReason = e.message;
        await withdrawal.save();
        await reverseWithdrawalDebit(withdrawal);
        return next(new ErrorHandler(`Withdrawal failed: ${e.message}`, 502));
      }

      res.status(201).json({ success: true, withdrawal });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// GET /wallet/withdrawals
export const listWithdrawals = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const withdrawals = await WithdrawalModel.find({ userId })
        .sort({ createdAt: -1 })
        .lean();
      res.status(200).json({ success: true, withdrawals });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// GET /wallet/withdrawals/:id
export const getWithdrawal = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.user!._id);
      const { id } = req.params;
      const withdrawal = await WithdrawalModel.findOne({ _id: id, userId }).lean();
      if (!withdrawal) return next(new ErrorHandler("Withdrawal not found", 404));
      res.status(200).json({ success: true, withdrawal });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);

// POST /payments/webhook/paystack-transfer (no auth — called by Paystack)
export const paystackTransferWebhook = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const transferService = getTransferService();
      const validation = transferService.validateWebhook(req.headers, req.body);
      if (!validation.isValid) {
        return res.status(400).send("Invalid signature");
      }

      const event = req.body;
      const reference = event?.data?.reference;
      if (!reference) return res.status(200).send("Webhook received");

      const withdrawal = await WithdrawalModel.findOne({
        paystackTransferReference: reference,
      });
      if (!withdrawal) return res.status(200).send("Webhook received");

      if (event.event === "transfer.success") {
        withdrawal.status = "paid";
        await withdrawal.save();
      } else if (event.event === "transfer.failed" || event.event === "transfer.reversed") {
        if (withdrawal.status !== "failed") {
          withdrawal.status = "failed";
          withdrawal.failureReason = event.data?.message || event.event;
          await withdrawal.save();
          await reverseWithdrawalDebit(withdrawal);
        }
      }

      res.status(200).send("Webhook received");
    } catch (error: any) {
      return next(new ErrorHandler(`Webhook processing failed: ${error.message}`, 500));
    }
  }
);
