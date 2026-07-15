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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoOpTransferService = void 0;
// Fallback when no transfer provider is configured (e.g. local dev/test without
// a Paystack key) — mirrors NoOpNotificationService/InMemoryPaymentQueue's role.
class NoOpTransferService {
    isEnabled() {
        return false;
    }
    resolveAccount() {
        return __awaiter(this, void 0, void 0, function* () {
            throw new Error("No transfer provider configured");
        });
    }
    createRecipient() {
        return __awaiter(this, void 0, void 0, function* () {
            throw new Error("No transfer provider configured");
        });
    }
    initiateTransfer() {
        return __awaiter(this, void 0, void 0, function* () {
            throw new Error("No transfer provider configured");
        });
    }
    verifyTransfer() {
        return __awaiter(this, void 0, void 0, function* () {
            throw new Error("No transfer provider configured");
        });
    }
    validateWebhook() {
        return { isValid: false };
    }
}
exports.NoOpTransferService = NoOpTransferService;
