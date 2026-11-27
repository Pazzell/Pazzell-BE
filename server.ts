import http from "http";
import { app } from "./app";
import "dotenv/config";
import { attachRealtime } from "./services/teamGame/realtime";
import { rearmTeamGameTimers, watchTeamGame } from "./services/teamGame/teamGame.service";
import connectDB from "./utils/db";
import { startScheduler } from "./services/scheduler";
import { initConfigCache, migrateRetiredPricing } from "./services/config/config.service";

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
  // Stored dollar prices from an earlier seed become the naira prices
  const repriced = await migrateRetiredPricing();
  if (repriced.length > 0) console.log(`Updated stored pricing to naira: ${repriced.join(", ")}`);
  // Warm the Config cache (falls back to CONFIG_DEFAULTS for any unseeded key)
  await initConfigCache();

  // Team games push live updates over socket.io, served on the same port as the API.
  const server = http.createServer(app);
  attachRealtime(server, watchTeamGame);
  // Questions that were open when the server stopped still close on time.
  await rearmTeamGameTimers();

  server.listen(PORT, () => {
    console.log(`Server is connected http://localhost:${PORT}`);
    // node-cron scheduler: campaign auto-end, Pro-expiry quiz locking and stale attempt
    // cleanup (see services/scheduler/index.ts)
    startScheduler();
  });
}

start();
