import mongoose from "mongoose";
import "dotenv/config";

const dbUrl: string = process.env.DB_URI || "";

// Add connection event listeners
mongoose.connection.on("connected", () => {
  console.log("MongoDB connection established");
});

mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("MongoDB disconnected");
});

//connect database
const connectDB = async () => {
  if (!dbUrl) {
    // in test mode we skip connecting; otherwise warn and skip
    if (process.env.NODE_ENV === "test") return;
    console.warn("DB_URI not set, skipping database connection");
    return;
  }

  try {
    const data: any = await mongoose.connect(dbUrl, {
      serverSelectionTimeoutMS: 30000, // 30 seconds timeout for initial connection
      socketTimeoutMS: 45000, // 45 seconds for socket operations
    });
    console.log(`Database connected with ${data.connection.host}`);
  } catch (error: any) {
    console.error("Database connection error:", error.message);
    // retry after 5s
    setTimeout(connectDB, 5000).unref();
  }
};

export default connectDB;
