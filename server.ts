import { app } from "./app";
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "./utils/db";
import LeaderboardModel from "./models/leaderboard.model";
import { startScheduler } from "./utils/scheduler";
import { initializePackages } from "./controllers/package.controller";

//create server
const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  console.log(`Server is connected http://localhost:${process.env.PORT}`);
  await connectDB();
  // Initialize packages after database connection
  await initializePackages();
  // schedule monthly leaderboard reset at the end of each month (midnight on 1st of next month)
  const scheduleMonthlyReset = () => {
    const now = new Date();
    const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const delay = firstOfNextMonth.getTime() - now.getTime();

    setTimeout(async function resetAndSchedule() {
      try {
        if (mongoose.connection.readyState === 1) {
          const now = new Date();
          const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          // keep current month's leaderboard; remove all older monthly leaderboards
          await LeaderboardModel.deleteMany({
            type: "monthly",
            date: { $ne: currentMonthKey },
          });
          console.log(`Monthly leaderboard reset completed. Current month: ${currentMonthKey}`);
        }
      } catch (err) {
        console.error("Error resetting monthly leaderboard:", err);
      }
      // schedule next run for the 1st of the following month
      const next = new Date();
      const nextRun = new Date(next.getFullYear(), next.getMonth() + 1, 1);
      setTimeout(resetAndSchedule, nextRun.getTime() - Date.now());
    }, delay);
  };

  scheduleMonthlyReset();
  // start instant event scheduler
  startScheduler();
});
