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
exports.closeTestDB = exports.clearTestDB = exports.connectTestDB = void 0;
const mongodb_memory_server_1 = require("mongodb-memory-server");
const mongoose_1 = __importDefault(require("mongoose"));
let mongo = null;
const connectTestDB = () => __awaiter(void 0, void 0, void 0, function* () {
    process.env.NODE_ENV = "test";
    process.env.ACCESS_TOKEN = process.env.ACCESS_TOKEN || "testaccesssecret";
    process.env.REFRESH_TOKEN = process.env.REFRESH_TOKEN || "testrefreshsecret";
    mongo = yield mongodb_memory_server_1.MongoMemoryServer.create();
    const uri = mongo.getUri();
    yield mongoose_1.default.connect(uri);
    // Mongoose builds indexes in the background after a model is first
    // registered — without waiting for them, tests that exercise a unique
    // index (e.g. race-condition/duplicate guards) can flake because the
    // index isn't ready yet when the first writes land. Wait for every
    // currently-registered model's indexes to finish building.
    yield Promise.all(Object.values(mongoose_1.default.connection.models).map((model) => model.init()));
});
exports.connectTestDB = connectTestDB;
const clearTestDB = () => __awaiter(void 0, void 0, void 0, function* () {
    if (!mongoose_1.default.connection.readyState)
        return;
    const collections = mongoose_1.default.connection.collections;
    for (const key in collections) {
        const collection = collections[key];
        yield collection.deleteMany({});
    }
});
exports.clearTestDB = clearTestDB;
const closeTestDB = () => __awaiter(void 0, void 0, void 0, function* () {
    yield mongoose_1.default.connection.dropDatabase();
    yield mongoose_1.default.connection.close();
    if (mongo)
        yield mongo.stop();
});
exports.closeTestDB = closeTestDB;
