import { app } from "./app";
import "dotenv/config";
import connectDB from "./utils/db";
import { startScheduler } from "./services/scheduler";
import { initializePackages } from "./controllers/package.controller";
import { initConfigCache } from "./services/config/config.service";

//create server
const PORT = process.env.PORT || 4000;

// Connect to the DB (and warm dependent caches) BEFORE accepting HTTP traffic.
// Previously app.listen() bound the port synchronously while connectDB() ran
// in its callback, so requests could land on DB-dependent routes (e.g.
// session start) before Mongo was connected and fail once Mongoose's
// operation-buffering timeout was hit — the classic "works on retry" bug on
// every cold start.
async function start() {
  await connectDB();
  // Initialize packages after database connection
  await initializePackages();
  // Warm the Config cache (falls back to CONFIG_DEFAULTS for any unseeded key)
  await initConfigCache();

  app.listen(PORT, () => {
    console.log(`Server is connected http://localhost:${process.env.PORT}`);
    // node-cron scheduler: hourly campaign-expiry, Monday weekly payout/raffle
    // rollover, nightly wallet reconciliation (see services/scheduler/index.ts)
    startScheduler();
  });
}

start();
