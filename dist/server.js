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
const app_1 = require("./app");
require("dotenv/config");
const db_1 = __importDefault(require("./utils/db"));
const scheduler_1 = require("./services/scheduler");
const package_controller_1 = require("./controllers/package.controller");
const config_service_1 = require("./services/config/config.service");
//create server
const PORT = process.env.PORT || 4000;
app_1.app.listen(PORT, () => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`Server is connected http://localhost:${process.env.PORT}`);
    yield (0, db_1.default)();
    // Initialize packages after database connection
    yield (0, package_controller_1.initializePackages)();
    // Warm the Config cache (falls back to CONFIG_DEFAULTS for any unseeded key)
    yield (0, config_service_1.initConfigCache)();
    // node-cron scheduler: hourly campaign-expiry, Monday weekly payout/raffle
    // rollover, nightly wallet reconciliation (see services/scheduler/index.ts)
    (0, scheduler_1.startScheduler)();
}));
