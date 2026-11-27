"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmailService = void 0;
const LegacyEmailService_1 = require("./LegacyEmailService");
const SESEmailService_1 = require("./SESEmailService");
let _instance = null;
const getEmailService = () => {
    var _a;
    if (_instance)
        return _instance;
    const provider = ((_a = process.env.EMAIL_PROVIDER) !== null && _a !== void 0 ? _a : "gmail").toLowerCase();
    _instance =
        provider === "aws" ? new SESEmailService_1.SESEmailService() : new LegacyEmailService_1.LegacyEmailService();
    return _instance;
};
exports.getEmailService = getEmailService;
