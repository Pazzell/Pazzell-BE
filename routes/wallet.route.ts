import express from "express";
import {
  getWalletBalance,
  getWalletTransactions,
  addBankAccount,
  listBankAccounts,
  deleteBankAccount,
  createWithdrawal,
  listWithdrawals,
  getWithdrawal,
  paystackTransferWebhook,
} from "../controllers/wallet.controller";
import { isAuthenticated } from "../utils/auth";

const router = express.Router();

router.get("/wallet/balance", isAuthenticated, getWalletBalance);
router.get("/wallet/transactions", isAuthenticated, getWalletTransactions);

router.post("/wallet/bank-accounts", isAuthenticated, addBankAccount);
router.get("/wallet/bank-accounts", isAuthenticated, listBankAccounts);
router.delete("/wallet/bank-accounts/:id", isAuthenticated, deleteBankAccount);

router.post("/wallet/withdrawals", isAuthenticated, createWithdrawal);
router.get("/wallet/withdrawals", isAuthenticated, listWithdrawals);
router.get("/wallet/withdrawals/:id", isAuthenticated, getWithdrawal);

// Paystack transfer webhook — no auth, called by Paystack
router.post("/payments/webhook/paystack-transfer", paystackTransferWebhook);

export default router;
