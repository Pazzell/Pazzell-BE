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
exports.paystackService = exports.PaystackService = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_BASE_URL = "https://api.paystack.co";
class PaystackService {
    initialize(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            try {
                const response = yield axios_1.default.post(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
                    email: params.email,
                    amount: params.amount * 100, // Convert to kobo
                    reference: params.reference,
                    currency: params.currency,
                    callback_url: params.callbackUrl,
                    metadata: params.metadata,
                }, {
                    headers: {
                        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                        "Content-Type": "application/json",
                    },
                });
                const data = response.data;
                return {
                    success: true,
                    authorizationUrl: data.data.authorization_url,
                    accessCode: data.data.access_code,
                    reference: params.reference,
                    rawResponse: data,
                };
            }
            catch (error) {
                const errorMessage = ((_b = (_a = error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.message) || error.message;
                console.error("Paystack Error:", ((_c = error.response) === null || _c === void 0 ? void 0 : _c.data) || error.message);
                throw new Error(`Paystack initialization failed: ${errorMessage}`);
            }
        });
    }
    verify(reference) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const response = yield axios_1.default.get(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
                    headers: {
                        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                    },
                });
                const data = response.data;
                const paymentData = data.data;
                return {
                    success: paymentData.status === "success",
                    status: paymentData.status === "success" ? "success" : "failed",
                    reference,
                    amount: paymentData.amount / 100, // Convert from kobo to naira
                    rawResponse: paymentData,
                };
            }
            catch (error) {
                throw new Error(`Paystack verification failed: ${error.message}`);
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
        return {
            isValid: true,
            event: body.event,
            data: body.data,
        };
    }
}
exports.PaystackService = PaystackService;
exports.paystackService = new PaystackService();
