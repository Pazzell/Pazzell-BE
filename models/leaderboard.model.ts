import mongoose, { Document, Model, Schema } from "mongoose";

export interface ILeaderboard extends Document {
  type: "weekly" | "monthly";
  date: string; // week range string (e.g., "2025-01-06_to_2025-01-12") or monthKey (e.g., "2026-04")
  entries: {
    userId: string;
    puzzlesSolved?: number;
    points: number;
  }[];
}

const leaderboardSchema: Schema<ILeaderboard> = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["weekly", "monthly"],
      required: true,
      default: "weekly",
    },
    date: { type: String, required: true },
    entries: [
      {
        userId: { type: String, required: true },
        puzzlesSolved: { type: Number },
        points: { type: Number, default: 0 },
      },
    ],
  },
  { timestamps: true }
);

leaderboardSchema.index({ type: 1, date: 1 });

const LeaderboardModel: Model<ILeaderboard> = mongoose.model(
  "Leaderboard",
  leaderboardSchema
);

export default LeaderboardModel;
