"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymentQueue = void 0;
const InMemoryPaymentQueue_1 = require("./InMemoryPaymentQueue");
const SQSPaymentQueue_1 = require("./SQSPaymentQueue");
let _instance = null;
const getPaymentQueue = () => {
    var _a;
    if (_instance)
        return _instance;
    const provider = ((_a = process.env.PAYMENT_QUEUE_PROVIDER) !== null && _a !== void 0 ? _a : "none").toLowerCase();
    _instance =
        provider === "aws" ? new SQSPaymentQueue_1.SQSPaymentQueue() : new InMemoryPaymentQueue_1.InMemoryPaymentQueue();
    return _instance;
};
exports.getPaymentQueue = getPaymentQueue;
