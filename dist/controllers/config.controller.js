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
exports.updateConfig = exports.listConfig = void 0;
const catchAsyncError_1 = require("../middlewares/catchAsyncError");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const config_service_1 = require("../services/config/config.service");
// GET /admin/config — list all effective config values (DB overrides merged over defaults)
exports.listConfig = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const config = yield (0, config_service_1.getAllConfig)();
        res.status(200).json({ success: true, config });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
// PUT /admin/config/:key  body: { value, description? }
exports.updateConfig = (0, catchAsyncError_1.CatchAsyncError)((req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { key } = req.params;
        const { value, description } = req.body;
        if (value === undefined) {
            return next(new ErrorHandler_1.default("value is required", 400));
        }
        if (!(key in config_service_1.CONFIG_DEFAULTS)) {
            return next(new ErrorHandler_1.default(`Unknown config key "${key}" — no default exists for it`, 400));
        }
        const updatedBy = String(((_a = req.user) === null || _a === void 0 ? void 0 : _a._id) || "");
        yield (0, config_service_1.setConfigValue)(key, value, updatedBy, description);
        res.status(200).json({ success: true, key, value });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 400));
    }
}));
