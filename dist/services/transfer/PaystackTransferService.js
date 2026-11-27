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
exports.PaystackTransferService = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_BASE_URL = "https://api.paystack.co";
/**
 * Paystack Transfers integration for player withdrawals — the charge side
 * (services/payment/paystack.service.ts) already existed; this is the payout
 * side, following the same plain-axios style.
 */
class PaystackTransferService {
    isEnabled() {
        return !!PAYSTACK_SECRET_KEY;
    }
    resolveAccount(accountNumber, bankCode) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                const response = yield axios_1.default.get(`${PAYSTACK_BASE_URL}/bank/resolve`, {
                    params: { account_number: accountNumber, bank_code: bankCode },
                    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
                });
                const data = response.data.data;
                return {
                    accountNumber: data.account_number,
                    accountName: data.account_name,
                    bankCode,
                };
            }
            catch (error) {
                const message = ((_b = (_a = error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.message) || error.message;
                throw new Error(`Account resolution failed: ${message}`);
            }
        });
    }
    createRecipient(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                const response = yield axios_1.default.post(`${PAYSTACK_BASE_URL}/transferrecipient`, {
                    type: "nuban",
                    name: params.accountName,
                    account_number: params.accountNumber,
                    bank_code: params.bankCode,
                    currency: "NGN",
                }, {
                    headers: {
                        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                        "Content-Type": "application/json",
                    },
                });
                const data = response.data.data;
                return { recipientCode: data.recipient_code };
            }
            catch (error) {
                const message = ((_b = (_a = error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.message) || error.message;
                throw new Error(`Recipient creation failed: ${message}`);
            }
        });
    }
    initiateTransfer(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                const response = yield axios_1.default.post(`${PAYSTACK_BASE_URL}/transfer`, {
                    source: "balance",
                    amount: Math.round(params.amount * 100), // NGN -> kobo
                    recipient: params.recipientCode,
                    reference: params.reference,
                    reason: params.reason || "Pazzell weekly reward withdrawal",
                }, {
                    headers: {
                        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                        "Content-Type": "application/json",
                    },
                });
                const data = response.data.data;
                return {
                    transferCode: data.transfer_code,
                    reference: params.reference,
                    status: data.status,
                };
            }
            catch (error) {
                const message = ((_b = (_a = error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.message) || error.message;
                throw new Error(`Transfer initiation failed: ${message}`);
            }
        });
    }
    verifyTransfer(reference) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const response = yield axios_1.default.get(`${PAYSTACK_BASE_URL}/transfer/verify/${reference}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
                const data = response.data.data;
                return {
                    status: data.status,
                    reference,
                    rawResponse: data,
                };
            }
            catch (error) {
                throw new Error(`Transfer verification failed: ${error.message}`);
            }
        });
    }
    validateWebhook(headers, body) {
        const hash = crypto_1.default
            .createHmac("sha512", PAYSTACK_SECRET_KEY)
            .update(JSON.stringify(body))
            .digest("hex");
        if (hash !== headers["x-paystack-signature"]) {
            return { isValid: false };
        }
        return { isValid: true, event: body.event, data: body.data };
    }
}
exports.PaystackTransferService = PaystackTransferService;
