import mongoose, { Document, Model, Schema } from "mongoose";
import { ICardContent, cardContentFields } from "./cardFields";

// A team game: a host's custom quiz played as tic-tac-toe between teams.
//   lobby -> playing -> finished   (or lobby -> cancelled)
// Teams take turns. The leader of the team in turn picks a numbered cell, which serves a
// question; the team deliberates in its own chat and the leader answers. A correct answer
// scores the team a point and claims the cell. A full line wins; a full board goes to the
// highest score. See services/teamGame/teamGame.service.ts.
export type TeamGameStatus = "lobby" | "playing" | "finished" | "cancelled";
export type TeamGameEndReason = "line" | "board_full" | "host_ended";
export type TeamPlayOutcome = "correct" | "wrong" | "timeout";

export interface ITeam {
  id: string; // "t1".."t6", stable for the life of the game
  name: string;
  color: string;
  leaderId: string | null;
  score: number;
}

export interface ITeamPlayer {
  userId: string;
  name: string;
  avatar?: string;
  teamId: string | null; // null: joined the game but not on a team yet
  joinedAt: Date;
}

export interface ICurrentQuestion {
  cellIndex: number;
  teamId: string;
  cardId: string;
  card: ICardContent; // a copy, so an edit to the quiz mid-game cannot change it
  servedAt: Date;
  deadlineAt: Date;
}

export interface ITeamPlay {
  cellIndex: number;
  teamId: string;
  cardId: string;
  outcome: TeamPlayOutcome;
  optionIndex?: number;
  correctOptionIndex: number;
  answeredBy?: string;
  at: Date;
}

export interface ITeamGame extends Document {
  code: string; // unguessable join token used in the link
  hostId: string;
  hostName: string;
  hostAvatar?: string;
  quizId: string;
  quizTitle: string;
  coverImageUrl?: string;
  status: TeamGameStatus;
  timerSeconds: number;
  teams: ITeam[];
  players: ITeamPlayer[];
  // Set at start, from the number of teams that have players.
  boardSize?: number;
  lineLength?: number;
  cells: (string | null)[]; // the owning team id per cell, row by row
  turnTeamId?: string | null;
  current?: ICurrentQuestion | null;
  plays: ITeamPlay[];
  winnerTeamId?: string | null;
  winningLine?: number[];
  isDraw?: boolean;
  endReason?: TeamGameEndReason;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const teamSchema = new Schema<ITeam>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, maxlength: 30 },
    color: { type: String, required: true },
    leaderId: { type: String, default: null },
    score: { type: Number, default: 0 },
  },
  { _id: false }
);

const playerSchema = new Schema<ITeamPlayer>(
  {
    userId: { type: String, required: true },
    name: { type: String, required: true },
    avatar: { type: String },
    teamId: { type: String, default: null },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const currentSchema = new Schema<ICurrentQuestion>(
  {
    cellIndex: { type: Number, required: true },
    teamId: { type: String, required: true },
    cardId: { type: String, required: true },
    card: { type: new Schema(cardContentFields, { _id: false }), required: true },
    servedAt: { type: Date, required: true },
    deadlineAt: { type: Date, required: true },
  },
  { _id: false }
);

const playSchema = new Schema<ITeamPlay>(
  {
    cellIndex: { type: Number, required: true },
    teamId: { type: String, required: true },
    cardId: { type: String, required: true },
    outcome: { type: String, enum: ["correct", "wrong", "timeout"], required: true },
    optionIndex: { type: Number },
    correctOptionIndex: { type: Number, required: true },
    answeredBy: { type: String },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const teamGameSchema: Schema<ITeamGame> = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    hostId: { type: String, required: true, index: true },
    hostName: { type: String, required: true },
    hostAvatar: { type: String },
    quizId: { type: String, required: true },
    quizTitle: { type: String, required: true },
    coverImageUrl: { type: String },
    status: {
      type: String,
      enum: ["lobby", "playing", "finished", "cancelled"],
      default: "lobby",
    },
    timerSeconds: { type: Number, required: true },
    teams: { type: [teamSchema], default: [] },
    players: { type: [playerSchema], default: [] },
    boardSize: { type: Number },
    lineLength: { type: Number },
    cells: { type: [{ type: String, default: null }], default: [] },
    turnTeamId: { type: String, default: null },
    current: { type: currentSchema, default: null },
    plays: { type: [playSchema], default: [] },
    winnerTeamId: { type: String, default: null },
    winningLine: { type: [Number], default: undefined },
    isDraw: { type: Boolean },
    endReason: { type: String, enum: ["line", "board_full", "host_ended"] },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  // Every change goes through a load -> check -> save cycle; a concurrent change makes
  // the save fail with a VersionError and the action is retried on fresh state.
  { timestamps: true, optimisticConcurrency: true }
);

// Games still running when the server restarts get their question clock back.
teamGameSchema.index({ status: 1 });

const TeamGameModel: Model<ITeamGame> = mongoose.model("TeamGame", teamGameSchema);
export default TeamGameModel;
