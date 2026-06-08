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
const mongoose_1 = __importDefault(require("mongoose"));
const db_1 = __importDefault(require("./utils/db"));
const leaderboard_model_1 = __importDefault(require("./models/leaderboard.model"));
const scheduler_1 = require("./utils/scheduler");
const package_controller_1 = require("./controllers/package.controller");
//create server
const PORT = process.env.PORT || 4000;
app_1.app.listen(PORT, () => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`Server is connected http://localhost:${process.env.PORT}`);
    yield (0, db_1.default)();
    // Initialize packages after database connection
    yield (0, package_controller_1.initializePackages)();
    // schedule monthly leaderboard reset at the end of each month (midnight on 1st of next month)
    const scheduleMonthlyReset = () => {
        const now = new Date();
        const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const delay = firstOfNextMonth.getTime() - now.getTime();
        setTimeout(function resetAndSchedule() {
            return __awaiter(this, void 0, void 0, function* () {
                try {
                    if (mongoose_1.default.connection.readyState === 1) {
                        const now = new Date();
                        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
                        // keep current month's leaderboard; remove all older monthly leaderboards
                        yield leaderboard_model_1.default.deleteMany({
                            type: "monthly",
                            date: { $ne: currentMonthKey },
                        });
                        console.log(`Monthly leaderboard reset completed. Current month: ${currentMonthKey}`);
                    }
                }
                catch (err) {
                    console.error("Error resetting monthly leaderboard:", err);
                }
                // schedule next run for the 1st of the following month
                const next = new Date();
                const nextRun = new Date(next.getFullYear(), next.getMonth() + 1, 1);
                setTimeout(resetAndSchedule, nextRun.getTime() - Date.now());
            });
        }, delay);
    };
    scheduleMonthlyReset();
    // start instant event scheduler
    (0, scheduler_1.startScheduler)();
}));
