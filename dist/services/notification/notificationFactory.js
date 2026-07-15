"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNotificationService = void 0;
const NoOpNotificationService_1 = require("./NoOpNotificationService");
const SNSNotificationService_1 = require("./SNSNotificationService");
let _instance = null;
const getNotificationService = () => {
    var _a;
    if (_instance)
        return _instance;
    const provider = ((_a = process.env.NOTIFICATION_PROVIDER) !== null && _a !== void 0 ? _a : "none").toLowerCase();
    _instance =
        provider === "aws"
            ? new SNSNotificationService_1.SNSNotificationService()
            : new NoOpNotificationService_1.NoOpNotificationService();
    return _instance;
};
exports.getNotificationService = getNotificationService;
