"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStorageService = void 0;
const FirebaseStorageService_1 = require("./FirebaseStorageService");
const S3StorageService_1 = require("./S3StorageService");
let _instance = null;
const getStorageService = () => {
    var _a;
    if (_instance)
        return _instance;
    const provider = ((_a = process.env.STORAGE_PROVIDER) !== null && _a !== void 0 ? _a : "firebase").toLowerCase();
    _instance =
        provider === "aws" ? new S3StorageService_1.S3StorageService() : new FirebaseStorageService_1.FirebaseStorageService();
    return _instance;
};
exports.getStorageService = getStorageService;
