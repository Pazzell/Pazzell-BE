import { Request, Response } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import {
  answerQuestion,
  createTeamGame,
  endTeamGame,
  getTeamGame,
  getTeamGameResult,
  joinTeam,
  leaveGame,
  listHostedGames,
  listTeamMessages,
  movePlayer,
  pickCell,
  sendTeamMessage,
  setLeader,
  startTeamGame,
  updateTeamGameSettings,
} from "../services/teamGame/teamGame.service";

const code = (req: Request) => String(req.params.code || "");

// POST /team-games  { quizId, teamCount?, timerSeconds? } — host a game from your own quiz,
// or { topicId, teamCount?, timerSeconds? } — a self-serve game from a General Trivia topic
export const createGame = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(201).json({ success: true, game: await createTeamGame(req.user!, req.body) });
});

// GET /team-games — games you host, newest first
export const listMyGames = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, games: await listHostedGames(req.user!) });
});

// GET /team-games/:code — the live state (also pushed over the socket)
export const getGame = CatchAsyncError(async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  res.status(200).json({ success: true, game: await getTeamGame(code(req)) });
});

// POST /team-games/:code/join  { teamId? }
export const join = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, game: await joinTeam(code(req), req.user!, req.body?.teamId) });
});

// POST /team-games/:code/leave
export const leave = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, game: await leaveGame(code(req), req.user!) });
});

// PATCH /team-games/:code  { teamCount?, timerSeconds?, teams?: [{ id, name }] } — host, lobby only
export const updateSettings = CatchAsyncError(async (req: Request, res: Response) => {
  res
    .status(200)
    .json({ success: true, game: await updateTeamGameSettings(code(req), req.user!, req.body) });
});

// POST /team-games/:code/players/:userId/team  { teamId | null } — host
export const assignPlayer = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    game: await movePlayer(code(req), req.user!, String(req.params.userId), req.body?.teamId),
  });
});

// POST /team-games/:code/teams/:teamId/leader  { userId } — host
export const assignLeader = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    game: await setLeader(code(req), req.user!, String(req.params.teamId), req.body?.userId),
  });
});

// POST /team-games/:code/start — host
export const start = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, game: await startTeamGame(code(req), req.user!) });
});

// POST /team-games/:code/pick  { cellIndex } — leader of the team in turn
export const pick = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, game: await pickCell(code(req), req.user!, req.body?.cellIndex) });
});

// POST /team-games/:code/answer  { optionIndex } — leader of the team in turn
export const answer = CatchAsyncError(async (req: Request, res: Response) => {
  res
    .status(200)
    .json({ success: true, game: await answerQuestion(code(req), req.user!, req.body?.optionIndex) });
});

// POST /team-games/:code/end — host
export const end = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, game: await endTeamGame(code(req), req.user!) });
});

// GET /team-games/:code/messages — your team's chat
export const listMessages = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, ...(await listTeamMessages(code(req), req.user!)) });
});

// POST /team-games/:code/messages  { text }
export const sendMessage = CatchAsyncError(async (req: Request, res: Response) => {
  res
    .status(201)
    .json({ success: true, message: await sendTeamMessage(code(req), req.user!, req.body?.text) });
});

// GET /team-games/:code/result — PUBLIC once the game has finished: the shareable card
export const getResult = CatchAsyncError(async (req: Request, res: Response) => {
  res.status(200).json({ success: true, result: await getTeamGameResult(code(req)) });
});
