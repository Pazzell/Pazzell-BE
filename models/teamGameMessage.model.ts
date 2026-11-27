import mongoose, { Document, Model, Schema } from "mongoose";

// A team's private chat line in a team game. Only that team's members can read it.
export const TEAM_MESSAGE_MAX = 300;

export interface ITeamGameMessage extends Document {
  gameId: string;
  teamId: string;
  userId: string;
  name: string;
  text: string;
  createdAt: Date;
}

const teamGameMessageSchema: Schema<ITeamGameMessage> = new mongoose.Schema(
  {
    gameId: { type: String, required: true },
    teamId: { type: String, required: true },
    userId: { type: String, required: true },
    name: { type: String, required: true },
    text: { type: String, required: true, maxlength: TEAM_MESSAGE_MAX },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

teamGameMessageSchema.index({ gameId: 1, teamId: 1, createdAt: -1 });
// Chat is only useful while a game is fresh.
teamGameMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const TeamGameMessageModel: Model<ITeamGameMessage> = mongoose.model(
  "TeamGameMessage",
  teamGameMessageSchema
);
export default TeamGameMessageModel;
