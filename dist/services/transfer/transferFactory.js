"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTransferService = void 0;
const PaystackTransferService_1 = require("./PaystackTransferService");
const NoOpTransferService_1 = require("./NoOpTransferService");
let _instance = null;
const getTransferService = () => {
    var _a;
    if (_instance)
        return _instance;
    const provider = ((_a = process.env.TRANSFER_PROVIDER) !== null && _a !== void 0 ? _a : "paystack").toLowerCase();
    _instance =
        provider === "paystack" && process.env.PAYSTACK_SECRET_KEY
            ? new PaystackTransferService_1.PaystackTransferService()
            : new NoOpTransferService_1.NoOpTransferService();
    return _instance;
};
exports.getTransferService = getTransferService;
