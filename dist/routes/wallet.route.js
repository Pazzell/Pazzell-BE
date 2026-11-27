"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const wallet_controller_1 = require("../controllers/wallet.controller");
const auth_1 = require("../utils/auth");
const router = express_1.default.Router();
router.get("/wallet/balance", auth_1.isAuthenticated, wallet_controller_1.getWalletBalance);
router.get("/wallet/transactions", auth_1.isAuthenticated, wallet_controller_1.getWalletTransactions);
router.post("/wallet/bank-accounts", auth_1.isAuthenticated, wallet_controller_1.addBankAccount);
router.get("/wallet/bank-accounts", auth_1.isAuthenticated, wallet_controller_1.listBankAccounts);
router.delete("/wallet/bank-accounts/:id", auth_1.isAuthenticated, wallet_controller_1.deleteBankAccount);
router.post("/wallet/withdrawals", auth_1.isAuthenticated, wallet_controller_1.createWithdrawal);
router.get("/wallet/withdrawals", auth_1.isAuthenticated, wallet_controller_1.listWithdrawals);
router.get("/wallet/withdrawals/:id", auth_1.isAuthenticated, wallet_controller_1.getWithdrawal);
// Paystack transfer webhook — no auth, called by Paystack
router.post("/payments/webhook/paystack-transfer", wallet_controller_1.paystackTransferWebhook);
exports.default = router;
