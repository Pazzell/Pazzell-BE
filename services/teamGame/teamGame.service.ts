import { randomBytes } from "crypto";
import mongoose from "mongoose";
import ErrorHandler from "../../utils/ErrorHandler";
import { assertObjectId, cleanString, requireString, toInt } from "../../utils/validators";
import CustomQuizModel from "../../models/customQuiz.model";
import CustomQuizCardModel from "../../models/customQuizCard.model";
import TriviaTopicModel from "../../models/triviaTopic.model";
import TriviaCardModel from "../../models/triviaCard.model";
import TeamGameModel, { ITeamGame, ITeamPlayer, TeamGameEndReason, TeamPlayOutcome } from "../../models/teamGame.model";
import TeamGameMessageModel, { TEAM_MESSAGE_MAX } from "../../models/teamGameMessage.model";
import { ensureQuizLocks } from "../customQuiz/quizLock.service";
import { getSubmitGraceMs } from "../config/config.service";
import { isPastDeadline } from "../game/timing";
import { frontendUrl } from "../config/frontendUrl";
import { boardFor, findWinningLine, MAX_TEAMS, MIN_TEAMS } from "./board";
import { emitGameState, emitTeamMessage, moveToTeamRoom, WatchAccess } from "./realtime";
import { shuffle } from "../trivia/mix";

// The team game engine. Every change runs through `mutate`: load the game, settle a
// question whose clock ran out, apply the change, save (retrying on a concurrent save),
// then push the new state to everyone watching. The server owns the clock and the
// correct answers; clients only ever see the current question without its answer.

// Seconds to answer in a team game: 5, 10, 15, 20, 25 or 30.
export const TEAM_TIMER = { minSeconds: 5, maxSeconds: 30, stepSeconds: 5, defaultSeconds: 30 };
export const MAX_TEAM_SIZE = 20;
const MAX_PLAYERS = MAX_TEAMS * MAX_TEAM_SIZE;
const TEAM_NAME_MAX = 30;
const CHAT_HISTORY = 50;

const TEAM_NAMES = ["Team A", "Team B", "Team C", "Team D", "Team E", "Team F"];
const TEAM_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899"];

const joinUrlFor = (code: string) => `${frontendUrl()}/team/${code}`;
const resultUrlFor = (code: string) => `${frontendUrl()}/team/${code}/result`;

// 72 bits, URL-safe: enough that join links cannot be guessed.
const newCode = () => randomBytes(9).toString("base64url");

type Actor = { _id: any; username?: string; firstName?: string; name?: string; avatar?: string };

const displayName = (user: Actor) =>
  user.username || user.firstName || user.name || "A Pazzell player";

const newTeam = (i: number) => ({
  id: `t${i + 1}`,
  name: TEAM_NAMES[i],
  color: TEAM_COLORS[i],
  leaderId: null,
  score: 0,
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

// Games made before topic games existed have no kind: they are quiz games.
const kindOf = (game: ITeamGame) => game.kind || "quiz";
// In a topic game the player who controls it plays too; a quiz host only runs it.
const hostPlays = (game: ITeamGame) => kindOf(game) === "topic";

const membersOf = (game: ITeamGame, teamId: string) =>
  game.players
    .filter((p) => p.teamId === teamId)
    .map((p) => ({ userId: p.userId, name: p.name, avatar: p.avatar || null }));

function shapeOf(game: ITeamGame) {
  if (game.boardSize && game.lineLength) return { size: game.boardSize, lineLength: game.lineLength };
  return boardFor(game.teams.length);
}

/** What every watcher sees. Never includes the open question's answer. */
export function publicState(game: ITeamGame, now = new Date()) {
  const shape = shapeOf(game);
  const cells = game.cells.length ? game.cells : Array(shape.size * shape.size).fill(null);
  const current = game.current;
  const lastPlay = game.plays.length ? game.plays[game.plays.length - 1] : null;
  return {
    code: game.code,
    status: game.status,
    kind: kindOf(game),
    quiz: { id: game.quizId ?? null, title: game.quizTitle, coverImageUrl: game.coverImageUrl || null },
    topic: game.topicId ? { id: game.topicId, name: game.quizTitle } : null,
    host: { userId: game.hostId, name: game.hostName, avatar: game.hostAvatar || null },
    timerSeconds: game.timerSeconds,
    board: {
      size: shape.size,
      lineLength: shape.lineLength,
      cells: cells.map((owner, index) => ({ index, number: index + 1, owner: owner ?? null })),
    },
    teams: game.teams.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      leaderId: t.leaderId ?? null,
      score: t.score,
      members: membersOf(game, t.id),
    })),
    unassigned: game.players
      .filter((p) => !p.teamId)
      .map((p) => ({ userId: p.userId, name: p.name, avatar: p.avatar || null })),
    turnTeamId: game.turnTeamId ?? null,
    current: current
      ? {
          cellIndex: current.cellIndex,
          number: current.cellIndex + 1,
          teamId: current.teamId,
          servedAt: current.servedAt,
          deadlineAt: current.deadlineAt,
          timerSeconds: game.timerSeconds,
          question: {
            type: current.card.type,
            imageUrl: current.card.imageUrl || null,
            text: current.card.text || null,
            attribution: current.card.attribution || null,
            options: current.card.options.map((text, index) => ({ index, text })),
          },
        }
      : null,
    lastPlay: lastPlay
      ? {
          cellIndex: lastPlay.cellIndex,
          number: lastPlay.cellIndex + 1,
          teamId: lastPlay.teamId,
          outcome: lastPlay.outcome,
          optionIndex: lastPlay.optionIndex ?? null,
          correctOptionIndex: lastPlay.correctOptionIndex,
          at: lastPlay.at,
        }
      : null,
    playCount: game.plays.length,
    winnerTeamId: game.winnerTeamId ?? null,
    winningLine: game.winningLine?.length ? game.winningLine : null,
    isDraw: !!game.isDraw,
    endReason: game.endReason ?? null,
    startedAt: game.startedAt ?? null,
    finishedAt: game.finishedAt ?? null,
    joinUrl: joinUrlFor(game.code),
    resultUrl: game.status === "finished" ? resultUrlFor(game.code) : null,
    serverTime: now,
  };
}

/** The shareable result card: who won, the final board and every team's line-up. */
export function resultSummary(game: ITeamGame) {
  const shape = shapeOf(game);
  const teams = game.teams
    .map((t) => {
      const plays = game.plays.filter((p) => p.teamId === t.id);
      return {
        id: t.id,
        name: t.name,
        color: t.color,
        score: t.score,
        cellsClaimed: game.cells.filter((owner) => owner === t.id).length,
        questionsAnswered: plays.length,
        correctAnswers: plays.filter((p) => p.outcome === "correct").length,
        leaderName: game.players.find((p) => p.userId === t.leaderId)?.name ?? null,
        // Names only: this card is public.
        members: membersOf(game, t.id).map((m) => ({
          name: m.name,
          avatar: m.avatar,
          isLeader: m.userId === t.leaderId,
        })),
        isWinner: t.id === game.winnerTeamId,
      };
    })
    .sort((a, b) => Number(b.isWinner) - Number(a.isWinner) || b.score - a.score);

  return {
    code: game.code,
    kind: kindOf(game),
    quiz: { title: game.quizTitle, coverImageUrl: game.coverImageUrl || null },
    host: { name: game.hostName, avatar: game.hostAvatar || null },
    endReason: game.endReason ?? null,
    isDraw: !!game.isDraw,
    winnerTeamId: game.winnerTeamId ?? null,
    board: {
      size: shape.size,
      lineLength: shape.lineLength,
      cells: game.cells.map((owner, index) => ({ index, number: index + 1, owner: owner ?? null })),
    },
    winningLine: game.winningLine?.length ? game.winningLine : null,
    teams,
    questionsPlayed: game.plays.length,
    startedAt: game.startedAt ?? null,
    finishedAt: game.finishedAt ?? null,
    resultUrl: resultUrlFor(game.code),
  };
}

// ---------------------------------------------------------------------------
// Loading, saving and the question clock
// ---------------------------------------------------------------------------

const notFound = () => new ErrorHandler("This team game is not available", 404, "TEAM_GAME_NOT_FOUND");

async function loadGame(code: string): Promise<ITeamGame> {
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{8,32}$/.test(code)) throw notFound();
  const game = await TeamGameModel.findOne({ code });
  if (!game) throw notFound();
  return game;
}

const timers = new Map<string, NodeJS.Timeout>();

/** Arms (or clears) the timer that closes the open question when its clock runs out. */
async function scheduleDeadline(game: ITeamGame) {
  const id = String(game._id);
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  timers.delete(id);
  if (game.status !== "playing" || !game.current) return;

  const delay = game.current.deadlineAt.getTime() - Date.now() + (await getSubmitGraceMs()) + 50;
  const timer = setTimeout(() => {
    timers.delete(id);
    mutate(game.code, () => undefined).catch(() => {});
  }, Math.max(0, delay));
  timer.unref?.();
  timers.set(id, timer);
}

/** After a restart: give every running game its question clock back. */
export async function rearmTeamGameTimers() {
  const running = await TeamGameModel.find({ status: "playing", current: { $ne: null } });
  for (const game of running) await scheduleDeadline(game);
}

// A change may need work after the save (moving sockets between team chats).
type Change = (game: ITeamGame, now: Date) => void | (() => void) | Promise<void | (() => void)>;

async function mutate(code: string, change: Change): Promise<ITeamGame> {
  for (let attempt = 0; ; attempt++) {
    const game = await loadGame(code);
    const now = new Date();
    await settleExpired(game, now);
    const after = await change(game, now);
    const changed = game.isModified();
    try {
      if (changed) await game.save();
    } catch (error) {
      if (error instanceof mongoose.Error.VersionError && attempt < 4) continue;
      throw error;
    }
    if (changed) {
      if (typeof after === "function") after();
      await scheduleDeadline(game);
      emitGameState(String(game._id), publicState(game));
    }
    return game;
  }
}

async function settleExpired(game: ITeamGame, now: Date) {
  if (game.status !== "playing" || !game.current) return;
  if (isPastDeadline(game.current.deadlineAt, now, await getSubmitGraceMs())) {
    resolvePlay(game, now, "timeout");
  }
}

// ---------------------------------------------------------------------------
// Game rules
// ---------------------------------------------------------------------------

function findTeam(game: ITeamGame, teamId: any) {
  const team = typeof teamId === "string" ? game.teams.find((t) => t.id === teamId) : undefined;
  if (!team) throw new ErrorHandler("That team is not in this game", 400, "TEAM_NOT_FOUND");
  return team;
}

const findPlayer = (game: ITeamGame, userId: string) => game.players.find((p) => p.userId === userId);

function assertHost(game: ITeamGame, user: Actor) {
  if (game.hostId !== String(user._id)) {
    throw new ErrorHandler("Only the host can do this", 403, "NOT_HOST");
  }
}

function assertOpen(game: ITeamGame) {
  if (game.status === "finished" || game.status === "cancelled") {
    throw new ErrorHandler("This game has ended", 409, "GAME_OVER");
  }
}

function assertPlaying(game: ITeamGame) {
  if (game.status !== "playing") {
    throw new ErrorHandler("The game is not in play", 409, "GAME_NOT_PLAYING");
  }
}

/** A team's members, longest-standing first: the order the lead passes in. */
const membersByJoin = (game: ITeamGame, teamId: string) =>
  game.players
    .filter((p) => p.teamId === teamId)
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

/** After a team's turn the lead passes to its next member, so everyone gets a go. */
function rotateLeader(game: ITeamGame, teamId: string) {
  const team = game.teams.find((t) => t.id === teamId);
  if (!team) return;
  const members = membersByJoin(game, teamId);
  if (!members.length) {
    team.leaderId = null;
    return;
  }
  const at = members.findIndex((m) => m.userId === team.leaderId);
  team.leaderId = members[(at + 1) % members.length].userId;
}

/** The leader goes to the longest-standing member left, or nobody. */
function refillLeader(game: ITeamGame, teamId: string) {
  const team = game.teams.find((t) => t.id === teamId);
  if (!team) return;
  if (team.leaderId && findPlayer(game, team.leaderId)?.teamId === teamId) return;
  const next = membersByJoin(game, teamId)[0];
  team.leaderId = next ? next.userId : null;
}

/** Puts a player on a team (or on none). Returns the socket move to run after the save. */
function placePlayer(game: ITeamGame, player: ITeamPlayer, teamId: string | null) {
  const from = player.teamId ?? null;
  if (from === teamId) return () => undefined;
  if (teamId) {
    const team = findTeam(game, teamId);
    if (game.players.filter((p) => p.teamId === teamId).length >= MAX_TEAM_SIZE) {
      throw new ErrorHandler(`${team.name} is full`, 409, "TEAM_FULL", { max: MAX_TEAM_SIZE });
    }
  }
  player.teamId = teamId;
  if (from) refillLeader(game, from);
  if (teamId) refillLeader(game, teamId);
  const gameId = String(game._id);
  return () => moveToTeamRoom(gameId, player.userId, from, teamId);
}

/** Teams that still have players, in turn order. */
const teamsInPlay = (game: ITeamGame) =>
  game.teams.filter((t) => game.players.some((p) => p.teamId === t.id));

function nextTurn(game: ITeamGame, afterTeamId: string): string {
  const order = game.teams.map((t) => t.id);
  const live = new Set(teamsInPlay(game).map((t) => t.id));
  const start = order.indexOf(afterTeamId);
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(start + step) % order.length];
    if (live.has(candidate)) return candidate;
  }
  return afterTeamId;
}

function finish(game: ITeamGame, now: Date, reason: TeamGameEndReason, winnerTeamId?: string, line?: number[]) {
  game.status = "finished";
  game.finishedAt = now;
  game.endReason = reason;
  game.current = null;
  game.turnTeamId = null;
  if (winnerTeamId) {
    game.winnerTeamId = winnerTeamId;
    game.winningLine = line;
    game.isDraw = false;
    return;
  }
  // No line: the highest score wins, and a tie at the top is a draw.
  const top = Math.max(...game.teams.map((t) => t.score));
  const leaders = game.teams.filter((t) => t.score === top);
  game.winnerTeamId = leaders.length === 1 ? leaders[0].id : null;
  game.isDraw = leaders.length !== 1;
}

function resolvePlay(
  game: ITeamGame,
  now: Date,
  outcome: TeamPlayOutcome,
  optionIndex?: number,
  answeredBy?: string
) {
  const current = game.current!;
  game.plays.push({
    cellIndex: current.cellIndex,
    teamId: current.teamId,
    cardId: current.cardId,
    outcome,
    optionIndex,
    correctOptionIndex: current.card.correctOptionIndex,
    answeredBy,
    at: now,
  });
  game.current = null;
  rotateLeader(game, current.teamId);

  if (outcome === "correct") {
    const team = game.teams.find((t) => t.id === current.teamId)!;
    team.score += 1;
    game.set(`cells.${current.cellIndex}`, team.id);
    const line = findWinningLine(game.cells, shapeOf(game), team.id);
    if (line) return finish(game, now, "line", team.id, line);
    if (game.cells.every((owner) => owner)) return finish(game, now, "board_full");
  }
  // A missed cell keeps its number and gets a fresh question next time.
  game.turnTeamId = nextTurn(game, current.teamId);
}

type CardSource = { kind?: string; quizId?: string; topicId?: string };

/** The cards a game draws from: the quiz's, or the General Trivia topic's. */
async function cardsFor(source: CardSource) {
  return source.topicId && source.kind === "topic"
    ? TriviaCardModel.find({ topicId: source.topicId }).lean()
    : CustomQuizCardModel.find({ quizId: source.quizId }).lean();
}

async function countCards(source: CardSource) {
  return source.topicId && source.kind === "topic"
    ? TriviaCardModel.countDocuments({ topicId: source.topicId })
    : CustomQuizCardModel.countDocuments({ quizId: source.quizId });
}

/** A General Trivia topic any player can start a team game from. */
async function playableTopic(topicId: string) {
  const topic = await TriviaTopicModel.findOne({ _id: topicId, isActive: true });
  if (!topic) throw new ErrorHandler("Topic not found", 404, "TOPIC_NOT_FOUND");
  return topic;
}

function assertEnoughCards(teamCount: number, available: number) {
  const { size } = boardFor(teamCount);
  const needed = size * size;
  if (available < needed) {
    throw new ErrorHandler(
      `A ${size}x${size} board needs at least ${needed} questions; there are ${available}`,
      400,
      "NOT_ENOUGH_CARDS",
      { needed, available, size }
    );
  }
}

function parseTeamCount(value: any): number {
  const count = toInt(value);
  if (count === undefined || !Number.isInteger(count) || count < MIN_TEAMS || count > MAX_TEAMS) {
    throw new ErrorHandler(
      `teamCount must be a whole number from ${MIN_TEAMS} to ${MAX_TEAMS}`,
      400,
      "INVALID_TEAM_COUNT",
      { min: MIN_TEAMS, max: MAX_TEAMS }
    );
  }
  return count;
}

function parseTimer(value: any): number {
  const seconds = toInt(value);
  const { minSeconds, maxSeconds, stepSeconds } = TEAM_TIMER;
  if (
    seconds === undefined ||
    !Number.isInteger(seconds) ||
    seconds < minSeconds ||
    seconds > maxSeconds ||
    seconds % stepSeconds !== 0
  ) {
    throw new ErrorHandler(
      `timerSeconds must be ${minSeconds} to ${maxSeconds} seconds in steps of ${stepSeconds}`,
      400,
      "INVALID_TIMER",
      { minSeconds, maxSeconds, stepSeconds }
    );
  }
  return seconds;
}

/** The host's own quiz, if it can still be played. */
async function playableQuiz(quizId: string, ownerId: string) {
  await ensureQuizLocks(ownerId);
  const quiz = await CustomQuizModel.findOne({ _id: quizId, ownerId, deletedAt: null });
  if (!quiz) throw new ErrorHandler("Quiz not found", 404, "QUIZ_NOT_FOUND");
  if (quiz.status === "locked") {
    throw new ErrorHandler("This quiz is locked on your current plan", 403, "QUIZ_LOCKED");
  }
  if (quiz.mode !== "team") {
    throw new ErrorHandler(
      "Only a team quiz can be hosted as a team game",
      409,
      "NOT_A_TEAM_QUIZ"
    );
  }
  if (quiz.status !== "live") {
    throw new ErrorHandler("Publish the quiz before hosting a game", 409, "QUIZ_NOT_LIVE");
  }
  return quiz;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function createTeamGame(user: Actor, body: any) {
  if (body?.topicId !== undefined) return createTopicGame(user, body);
  const ownerId = String(user._id);
  const quiz = await playableQuiz(assertObjectId(body?.quizId, "quiz id"), ownerId);
  const teamCount = body?.teamCount === undefined ? MIN_TEAMS : parseTeamCount(body.teamCount);
  const fallbackTimer =
    quiz.defaultTimerSeconds >= TEAM_TIMER.minSeconds &&
    quiz.defaultTimerSeconds <= TEAM_TIMER.maxSeconds &&
    quiz.defaultTimerSeconds % TEAM_TIMER.stepSeconds === 0
      ? quiz.defaultTimerSeconds
      : TEAM_TIMER.defaultSeconds;
  const timerSeconds = body?.timerSeconds === undefined ? fallbackTimer : parseTimer(body.timerSeconds);
  assertEnoughCards(teamCount, await countCards({ kind: "quiz", quizId: String(quiz._id) }));

  const game = await TeamGameModel.create({
    code: newCode(),
    kind: "quiz",
    hostId: ownerId,
    hostName: displayName(user),
    hostAvatar: user.avatar,
    quizId: String(quiz._id),
    quizTitle: quiz.title,
    coverImageUrl: quiz.coverImageUrl,
    timerSeconds,
    teams: Array.from({ length: teamCount }, (_, i) => newTeam(i)),
  });
  return publicState(game);
}

/**
 * A self-serve game from a General Trivia topic: any player creates it, shares the link,
 * plays in it (starting on the first team) and starts it when the teams are ready.
 */
async function createTopicGame(user: Actor, body: any) {
  const userId = String(user._id);
  const topic = await playableTopic(assertObjectId(body?.topicId, "topic id"));
  const teamCount = body?.teamCount === undefined ? MIN_TEAMS : parseTeamCount(body.teamCount);
  const timerSeconds =
    body?.timerSeconds === undefined ? TEAM_TIMER.defaultSeconds : parseTimer(body.timerSeconds);
  assertEnoughCards(teamCount, await countCards({ kind: "topic", topicId: String(topic._id) }));

  const teams = Array.from({ length: teamCount }, (_, i) => newTeam(i));
  teams[0].leaderId = userId as any;
  const game = await TeamGameModel.create({
    code: newCode(),
    kind: "topic",
    hostId: userId,
    hostName: displayName(user),
    hostAvatar: user.avatar,
    topicId: String(topic._id),
    quizTitle: topic.name,
    coverImageUrl: topic.coverImageUrl,
    timerSeconds,
    teams,
    players: [
      { userId, name: displayName(user), avatar: user.avatar, teamId: teams[0].id, joinedAt: new Date() },
    ],
  });
  return publicState(game);
}

export async function listHostedGames(user: Actor) {
  const games = await TeamGameModel.find({ hostId: String(user._id) })
    .sort({ createdAt: -1 })
    .limit(20);
  return games.map((g) => ({
    code: g.code,
    status: g.status,
    kind: kindOf(g),
    quizId: g.quizId ?? null,
    topicId: g.topicId ?? null,
    quizTitle: g.quizTitle,
    teamCount: g.teams.length,
    playerCount: g.players.length,
    joinUrl: joinUrlFor(g.code),
    createdAt: g.createdAt,
    finishedAt: g.finishedAt ?? null,
  }));
}

export async function getTeamGame(code: string) {
  return publicState(await mutate(code, () => undefined));
}

/** For the socket: the state and which team chat this user may join. */
export async function watchTeamGame(code: string, userId: string): Promise<WatchAccess> {
  const game = await mutate(code, () => undefined);
  return {
    gameId: String(game._id),
    teamId: findPlayer(game, userId)?.teamId ?? null,
    state: publicState(game),
  };
}

/** Joins the game, onto a team when `teamId` is given. Players can't switch once it is in play. */
export async function joinTeam(code: string, user: Actor, teamId: any) {
  const userId = String(user._id);
  const game = await mutate(code, (game) => {
    assertOpen(game);
    // A quiz host runs the game and knows every answer, so they never play in it.
    if (game.hostId === userId && !hostPlays(game)) {
      throw new ErrorHandler("The host runs the game and can't join a team", 403, "HOST_CANNOT_PLAY");
    }
    const target = teamId === null || teamId === undefined ? null : findTeam(game, teamId).id;
    let player = findPlayer(game, userId);
    if (!player) {
      if (game.players.length >= MAX_PLAYERS) {
        throw new ErrorHandler("This game is full", 409, "GAME_FULL", { max: MAX_PLAYERS });
      }
      game.players.push({ userId, name: displayName(user), avatar: user.avatar, teamId: null, joinedAt: new Date() });
      player = game.players[game.players.length - 1];
    }
    if (game.status === "playing" && player.teamId && player.teamId !== target) {
      throw new ErrorHandler("Teams are fixed once the game has started", 409, "TEAMS_LOCKED");
    }
    if (target === null && player.teamId) return;
    return placePlayer(game, player, target);
  });
  return publicState(game);
}

/** Leaves the game altogether. A leaving leader hands over to the next member. */
export async function leaveGame(code: string, user: Actor) {
  const userId = String(user._id);
  const game = await mutate(code, (game) => {
    assertOpen(game);
    const player = findPlayer(game, userId);
    if (!player) return;
    const from = player.teamId ?? null;
    game.players.splice(game.players.indexOf(player), 1);
    if (from) refillLeader(game, from);
    // A topic game's creator leaving hands control to the player who joined next; a
    // lobby nobody is left in is cancelled.
    if (hostPlays(game) && game.hostId === userId) {
      const next = [...game.players].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
      if (next) {
        game.hostId = next.userId;
        game.hostName = next.name;
        game.hostAvatar = next.avatar;
      } else if (game.status === "lobby") {
        game.status = "cancelled";
        game.finishedAt = new Date();
      }
    }
    const gameId = String(game._id);
    return () => moveToTeamRoom(gameId, userId, from, null);
  });
  return publicState(game);
}

/** Host, before start: number of teams, question timer and team names. */
export async function updateTeamGameSettings(code: string, user: Actor, body: any) {
  const teamCount = body?.teamCount === undefined ? undefined : parseTeamCount(body.teamCount);
  const timerSeconds = body?.timerSeconds === undefined ? undefined : parseTimer(body.timerSeconds);
  const available = teamCount === undefined ? 0 : await countCards(await loadGame(code));

  const game = await mutate(code, (game) => {
    assertHost(game, user);
    if (game.status !== "lobby") {
      throw new ErrorHandler("Settings are fixed once the game has started", 409, "GAME_STARTED");
    }
    const moves: (() => void)[] = [];
    if (teamCount !== undefined && teamCount !== game.teams.length) {
      assertEnoughCards(teamCount, available);
      for (let i = game.teams.length; i < teamCount; i++) game.teams.push(newTeam(i));
      const removed = game.teams.slice(teamCount).map((t) => t.id);
      for (const player of game.players) {
        if (player.teamId && removed.includes(player.teamId)) moves.push(placePlayer(game, player, null));
      }
      game.set("teams", game.teams.slice(0, teamCount).map((t: any) => t.toObject()));
    }
    if (timerSeconds !== undefined) game.timerSeconds = timerSeconds;
    if (Array.isArray(body?.teams)) {
      for (const entry of body.teams) {
        const name = cleanString(entry?.name, TEAM_NAME_MAX);
        if (name) findTeam(game, entry?.id).name = name;
      }
    }
    return () => moves.forEach((move) => move());
  });
  return publicState(game);
}

/** Host: put a player on a team, or take them off (teamId null). Works mid-game too. */
export async function movePlayer(code: string, user: Actor, userId: string, teamId: any) {
  const game = await mutate(code, (game) => {
    assertHost(game, user);
    assertOpen(game);
    const player = findPlayer(game, String(userId));
    if (!player) throw new ErrorHandler("That player is not in this game", 404, "PLAYER_NOT_FOUND");
    return placePlayer(game, player, teamId === null || teamId === undefined ? null : findTeam(game, teamId).id);
  });
  return publicState(game);
}

/** Host: hand a team's lead to one of its members. */
export async function setLeader(code: string, user: Actor, teamId: string, userId: any) {
  const game = await mutate(code, (game) => {
    assertHost(game, user);
    assertOpen(game);
    const team = findTeam(game, teamId);
    if (findPlayer(game, String(userId))?.teamId !== team.id) {
      throw new ErrorHandler("The leader must be on that team", 400, "NOT_ON_TEAM");
    }
    team.leaderId = String(userId);
  });
  return publicState(game);
}

export async function startTeamGame(code: string, user: Actor) {
  const existing = await loadGame(code);
  assertHost(existing, user);
  if (kindOf(existing) === "topic") await playableTopic(existing.topicId!);
  else await playableQuiz(existing.quizId!, existing.hostId);
  const available = await countCards(existing);

  const game = await mutate(code, (game, now) => {
    assertHost(game, user);
    if (game.status !== "lobby") {
      throw new ErrorHandler("This game has already started", 409, "GAME_STARTED");
    }
    const playing = teamsInPlay(game);
    if (playing.length < MIN_TEAMS) {
      throw new ErrorHandler("At least 2 teams need players to start", 400, "NOT_ENOUGH_TEAMS");
    }
    assertEnoughCards(playing.length, available);
    // Empty teams drop out, so the board is sized for the teams actually playing.
    game.set("teams", playing.map((t: any) => t.toObject()));
    for (const team of game.teams) refillLeader(game, team.id);

    const shape = boardFor(game.teams.length);
    game.boardSize = shape.size;
    game.lineLength = shape.lineLength;
    game.cells = Array(shape.size * shape.size).fill(null) as any;
    game.turnTeamId = game.teams[0].id;
    game.status = "playing";
    game.startedAt = now;
  });
  return publicState(game);
}

function assertLeaderOfTurn(game: ITeamGame, userId: string) {
  const team = game.teams.find((t) => t.id === game.turnTeamId);
  if (!team || findPlayer(game, userId)?.teamId !== team.id) {
    throw new ErrorHandler("It is not your team's turn", 403, "NOT_YOUR_TURN");
  }
  if (team.leaderId !== userId) {
    throw new ErrorHandler("Only your team leader can do this", 403, "NOT_LEADER");
  }
}

/** The leader of the team in turn opens a numbered cell, which serves its question. */
export async function pickCell(code: string, user: Actor, cellIndex: any) {
  const userId = String(user._id);
  const existing = await loadGame(code);
  // Cards answered correctly are spent; prefer ones nobody has seen yet.
  const cards = await cardsFor(existing);

  const game = await mutate(code, (game, now) => {
    assertPlaying(game);
    if (game.current) throw new ErrorHandler("A question is already open", 409, "QUESTION_OPEN");
    assertLeaderOfTurn(game, userId);
    const index = toInt(cellIndex);
    if (index === undefined || !Number.isInteger(index) || index < 0 || index >= game.cells.length) {
      throw new ErrorHandler("That cell is not on the board", 400, "INVALID_CELL");
    }
    if (game.cells[index]) throw new ErrorHandler("That cell is already taken", 409, "CELL_TAKEN");

    const spent = new Set(game.plays.filter((p) => p.outcome === "correct").map((p) => p.cardId));
    const seen = new Set(game.plays.map((p) => p.cardId));
    const left = cards.filter((c) => !spent.has(String(c._id)));
    const fresh = left.filter((c) => !seen.has(String(c._id)));
    const pool = fresh.length ? fresh : left;
    if (!pool.length) throw new ErrorHandler("This game has run out of questions", 409, "NO_QUESTIONS_LEFT");
    const card = pool[Math.floor(Math.random() * pool.length)];
    // Shown in a fresh random order, so the right answer is not always where it was typed.
    const order = shuffle(card.options.map((_, i) => i));

    game.current = {
      cellIndex: index,
      teamId: game.turnTeamId!,
      cardId: String(card._id),
      card: {
        type: card.type,
        imageUrl: card.imageUrl,
        text: card.text,
        options: order.map((i) => card.options[i]),
        correctOptionIndex: order.indexOf(card.correctOptionIndex),
        attribution: card.attribution,
      },
      servedAt: now,
      deadlineAt: new Date(now.getTime() + game.timerSeconds * 1000),
    };
  });
  return publicState(game);
}

/** The leader answers the open question; the point (and the cell) goes to the team. */
export async function answerQuestion(code: string, user: Actor, optionIndex: any) {
  const userId = String(user._id);
  const game = await mutate(code, (game, now) => {
    assertPlaying(game);
    const current = game.current;
    if (!current) throw new ErrorHandler("No question is open", 409, "NO_QUESTION_OPEN");
    assertLeaderOfTurn(game, userId);
    const pick = toInt(optionIndex);
    if (pick === undefined || !Number.isInteger(pick) || pick < 0 || pick >= current.card.options.length) {
      throw new ErrorHandler("optionIndex is not one of the options", 400, "INVALID_OPTION");
    }
    resolvePlay(game, now, pick === current.card.correctOptionIndex ? "correct" : "wrong", pick, userId);
  });
  return publicState(game);
}

/** Host: end the game now. Before start it is cancelled; mid-game the top score wins. */
export async function endTeamGame(code: string, user: Actor) {
  const game = await mutate(code, (game, now) => {
    assertHost(game, user);
    assertOpen(game);
    if (game.status === "lobby") {
      game.status = "cancelled";
      game.finishedAt = now;
      return;
    }
    finish(game, now, "host_ended");
  });
  return publicState(game);
}

export async function getTeamGameResult(code: string) {
  const game = await mutate(code, () => undefined);
  if (game.status !== "finished") throw notFound();
  return resultSummary(game);
}

// ---------------------------------------------------------------------------
// Team chat
// ---------------------------------------------------------------------------

function chatTeam(game: ITeamGame, userId: string): string {
  const teamId = findPlayer(game, userId)?.teamId;
  if (!teamId) throw new ErrorHandler("Join a team to use its chat", 403, "NOT_ON_TEAM");
  return teamId;
}

const publicMessage = (m: any) => ({
  id: String(m._id),
  teamId: m.teamId,
  userId: m.userId,
  name: m.name,
  text: m.text,
  createdAt: m.createdAt,
});

export async function listTeamMessages(code: string, user: Actor) {
  const game = await loadGame(code);
  const teamId = chatTeam(game, String(user._id));
  const messages = await TeamGameMessageModel.find({ gameId: String(game._id), teamId })
    .sort({ createdAt: -1 })
    .limit(CHAT_HISTORY)
    .lean();
  return { teamId, messages: messages.reverse().map(publicMessage) };
}

export async function sendTeamMessage(code: string, user: Actor, text: any) {
  const game = await loadGame(code);
  assertOpen(game);
  const userId = String(user._id);
  const teamId = chatTeam(game, userId);
  const message = await TeamGameMessageModel.create({
    gameId: String(game._id),
    teamId,
    userId,
    name: findPlayer(game, userId)!.name,
    text: requireString(text, "Message", TEAM_MESSAGE_MAX),
  });
  const view = publicMessage(message);
  emitTeamMessage(String(game._id), teamId, view);
  return view;
}
