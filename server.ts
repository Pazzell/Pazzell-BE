import { app } from "./app";
import "dotenv/config";
import connectDB from "./utils/db";
import { startScheduler } from "./services/scheduler";
import { initializePackages } from "./controllers/package.controller";
import { initConfigCache } from "./services/config/config.service";

//create server
const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  console.log(`Server is connected http://localhost:${process.env.PORT}`);
  await connectDB();
  // Initialize packages after database connection
  await initializePackages();
  // Warm the Config cache (falls back to CONFIG_DEFAULTS for any unseeded key)
  await initConfigCache();
  // node-cron scheduler: hourly campaign-expiry, Monday weekly payout/raffle
  // rollover, nightly wallet reconciliation (see services/scheduler/index.ts)
  startScheduler();
});
