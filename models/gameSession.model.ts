import mongoose, { Document, Model, Schema } from "mongoose";

export type GameType =
  | "sliding_puzzle"
  | "card_matching"
  | "spot_the_difference"
  | "word_hunt";

export interface IGameStage {
  gameType: GameType;
  startedAt?: Date;
  completedAt?: Date;
  clientMovesTaken?: number;
  clientTimeTakenMs?: number; // client-reported, informational only — never trusted for scoring
}

export interface IQuizAttempt {
  answers: number[];
  score: number;
  allCorrect: boolean;
  submittedAt: Date;
}

export interface IGameSession extends Document {
  userId: string;
  campaignId: string;
  status: "in_progress" | "completed" | "abandoned" | "flagged" | "voided";
  startedAt: Date;

  games: IGameStage[];
  video: { startedAt?: Date; completedAt?: Date };
  quiz: {
    firstAttempt: IQuizAttempt | null;
    attempts: IQuizAttempt[];
  };

  completedAt?: Date;
  totalCompletionTimeMs?: number; // server-computed = completedAt - startedAt, authoritative
  isFirstCompletionForUser?: boolean; // only true on the DB row that "won" the race for first completion
  pointsAwarded: number;
  raffleTicketAwarded: boolean;

  anticheat: {
    flagged: boolean;
    flaggedReasons: string[];
    voided: boolean;
    voidReason?: string;
  };
}

const quizAttemptSchema = new Schema<IQuizAttempt>(
  {
    answers: [{ type: Number }],
    score: { type: Number, required: true },
    allCorrect: { type: Boolean, required: true },
    submittedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const gameStageSchema = new Schema<IGameStage>(
  {
    gameType: {
      type: String,
      enum: [
        "sliding_puzzle",
        "card_matching",
        "spot_the_difference",
        "word_hunt",
      ],
      required: true,
    },
    startedAt: { type: Date },
    completedAt: { type: Date },
    clientMovesTaken: { type: Number },
    clientTimeTakenMs: { type: Number },
  },
  { _id: false }
);

const gameSessionSchema: Schema<IGameSession> = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    campaignId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["in_progress", "completed", "abandoned", "flagged", "voided"],
      default: "in_progress",
      required: true,
    },
    startedAt: { type: Date, default: Date.now, required: true },

    games: { type: [gameStageSchema], default: [] },
    video: {
      startedAt: { type: Date },
      completedAt: { type: Date },
    },
    quiz: {
      firstAttempt: { type: quizAttemptSchema, default: null },
      attempts: { type: [quizAttemptSchema], default: [] },
    },

    completedAt: { type: Date },
    totalCompletionTimeMs: { type: Number },
    isFirstCompletionForUser: { type: Boolean },
    pointsAwarded: { type: Number, default: 0 },
    raffleTicketAwarded: { type: Boolean, default: false },

    anticheat: {
      flagged: { type: Boolean, default: false },
      flaggedReasons: { type: [String], default: [] },
      voided: { type: Boolean, default: false },
      voidReason: { type: String },
    },
  },
  { timestamps: true }
);

// Race-safe first-completion guard: at most one document per user+campaign can
// have isFirstCompletionForUser:true. A concurrent duplicate write throws
// E11000, which gameSession.service.ts catches and treats as "not first".
gameSessionSchema.index(
  { userId: 1, campaignId: 1 },
  {
    unique: true,
    partialFilterExpression: { isFirstCompletionForUser: true },
  }
);

gameSessionSchema.index({ userId: 1, campaignId: 1, status: 1 });

const GameSessionModel: Model<IGameSession> = mongoose.model(
  "GameSession",
  gameSessionSchema
);
export default GameSessionModel;
