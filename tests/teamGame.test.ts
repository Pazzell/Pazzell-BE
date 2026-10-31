import http from "http";
import { AddressInfo } from "net";
import { io as connectClient, Socket } from "socket.io-client";
import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import { api, createUser, createTopic, resetState, addQuizCards, TestUser } from "./helpers";
import TriviaTopicModel from "../models/triviaTopic.model";
import { app } from "../app";
import TeamGameModel from "../models/teamGame.model";
import CustomQuizCardModel from "../models/customQuizCard.model";
import CustomQuizModel from "../models/customQuiz.model";
import { boardFor, findWinningLine, winningLines } from "../services/teamGame/board";
import { attachRealtime, closeRealtime } from "../services/teamGame/realtime";
import { watchTeamGame } from "../services/teamGame/teamGame.service";

const base = "/api/v1/team-games";

/** A live team quiz of the host's. `cards` below 9 is set live directly, as publish refuses it. */
async function hostQuiz(host: TestUser, cards = 9, fields: Record<string, any> = {}) {
  const created = await api()
    .post("/api/v1/custom-quizzes")
    .set(host.auth)
    .send({ title: "Team quiz", mode: "team", ...fields });
  const quizId = created.body.quiz.id as string;
  await addQuizCards(quizId, cards);
  await CustomQuizModel.updateOne({ _id: quizId }, { status: "live" });
  return quizId;
}

async function createGame(host: TestUser, extra: Record<string, any> = {}, cards = 9) {
  const quizId = await hostQuiz(host, cards);
  const res = await api().post(base).set(host.auth).send({ quizId, ...extra });
  expect(res.status).toBe(201);
  return res.body.game.code as string;
}

const join = (user: TestUser, code: string, teamId?: string | null) =>
  api().post(`${base}/${code}/join`).set(user.auth).send({ teamId });
const start = (user: TestUser, code: string) => api().post(`${base}/${code}/start`).set(user.auth);
const pick = (user: TestUser, code: string, cellIndex: number) =>
  api().post(`${base}/${code}/pick`).set(user.auth).send({ cellIndex });
const answer = (user: TestUser, code: string, optionIndex: number) =>
  api().post(`${base}/${code}/answer`).set(user.auth).send({ optionIndex });

/** The answer the open question needs, read straight from the database. */
async function correctOption(code: string) {
  const game = await TeamGameModel.findOne({ code }).lean();
  return game!.current!.card.correctOptionIndex;
}

// Players by id, so a test can act as whoever leads the team in turn: the lead moves to
// the next member after every turn.
const players = new Map<string, TestUser>();
const remember = (...users: TestUser[]) => users.forEach((u) => players.set(u.id, u));

/** The current leader of the team in turn, from the database. */
async function leaderInTurn(code: string): Promise<TestUser> {
  const game = (await TeamGameModel.findOne({ code }).lean())!;
  const team = game.teams.find((t) => t.id === game.turnTeamId)!;
  return players.get(team.leaderId!)!;
}

/**
 * The team of `member` plays its turn: its current leader opens a cell and answers it
 * right or wrong. `member` only says which team is meant.
 */
async function play(member: TestUser, code: string, cell: number, right: boolean) {
  const leader = (await leaderInTurn(code)) ?? member;
  expect((await pick(leader, code, cell)).status).toBe(200);
  const correct = await correctOption(code);
  const res = await answer(leader, code, right ? correct : 1 - correct);
  expect(res.status).toBe(200);
  return res.body.game;
}

/** A started 2-team game: A leads t1 (with member a2), B leads t2. */
async function startedGame() {
  const host = await createUser();
  const a = await createUser();
  const a2 = await createUser();
  const b = await createUser();
  remember(host, a, a2, b);
  const code = await createGame(host);
  await join(a, code, "t1");
  await join(a2, code, "t1");
  await join(b, code, "t2");
  expect((await start(host, code)).status).toBe(200);
  return { host, a, a2, b, code };
}

describe("Team game board", () => {
  it("grows the board with the number of teams", () => {
    expect(boardFor(2)).toEqual({ size: 3, lineLength: 3 });
    expect(boardFor(3)).toEqual({ size: 4, lineLength: 3 });
    expect(boardFor(4)).toEqual({ size: 5, lineLength: 4 });
    expect(boardFor(6)).toEqual({ size: 5, lineLength: 4 });
  });

  it("finds every winning line", () => {
    // 3x3: 3 rows, 3 columns, 2 diagonals
    expect(winningLines(boardFor(2))).toHaveLength(8);
    // 4x4, 3 in a row: 8 across, 8 down, 4 + 4 diagonals
    expect(winningLines(boardFor(3))).toHaveLength(24);
  });

  it("only reports a line the team fully owns", () => {
    const shape = boardFor(2);
    const owners = ["t1", "t1", "t2", null, "t1", null, null, null, "t1"];
    expect(findWinningLine(owners, shape, "t1")).toEqual([0, 4, 8]);
    expect(findWinningLine(owners, shape, "t2")).toBeNull();
  });
});

describe("Team games", () => {
  beforeAll(connectTestDB);
  afterEach(resetState);
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  describe("hosting", () => {
    it("creates a lobby from the host's own quiz with a join link", async () => {
      const host = await createUser();
      const quizId = await hostQuiz(host);
      const res = await api().post(base).set(host.auth).send({ quizId, teamCount: 2, timerSeconds: 20 });
      expect(res.status).toBe(201);
      expect(res.body.game).toMatchObject({
        status: "lobby",
        timerSeconds: 20,
        board: { size: 3, lineLength: 3 },
        teams: [
          { id: "t1", name: "Team A", leaderId: null, score: 0, members: [] },
          { id: "t2", name: "Team B", leaderId: null, score: 0, members: [] },
        ],
      });
      expect(res.body.game.joinUrl).toBe(`https://app.pazzell.test/team/${res.body.game.code}`);
      expect(res.body.game.board.cells).toHaveLength(9);
    });

    it("only hosts a published team quiz", async () => {
      // Pro, so the host can own several quizzes
      const host = await createUser({ proUntil: new Date(Date.now() + 86400000) });
      const broadcast = await hostQuiz(host, 9, { mode: "broadcast" });
      const refused = await api().post(base).set(host.auth).send({ quizId: broadcast });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe("NOT_A_TEAM_QUIZ");

      const draft = await hostQuiz(host);
      await CustomQuizModel.updateOne({ _id: draft }, { status: "draft" });
      expect((await api().post(base).set(host.auth).send({ quizId: draft })).body.code).toBe("QUIZ_NOT_LIVE");
    });

    it("refuses someone else's quiz", async () => {
      const owner = await createUser();
      const other = await createUser();
      const quizId = await hostQuiz(owner);
      const res = await api().post(base).set(other.auth).send({ quizId });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("QUIZ_NOT_FOUND");
    });

    it("needs a question for every cell", async () => {
      // Pro, so the host can own the second quiz below
      const host = await createUser({ proUntil: new Date(Date.now() + 86400000) });
      const quizId = await hostQuiz(host, 8);
      const res = await api().post(base).set(host.auth).send({ quizId });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("NOT_ENOUGH_CARDS");
      expect(res.body.details).toMatchObject({ needed: 9, available: 8, size: 3 });

      const bigger = await api()
        .post(base)
        .set(host.auth)
        .send({ quizId: await hostQuiz(host, 16), teamCount: 4 });
      expect(bigger.body.details).toMatchObject({ needed: 25, size: 5 });
    });

    it("validates team count and timer", async () => {
      const host = await createUser();
      const quizId = await hostQuiz(host);
      expect((await api().post(base).set(host.auth).send({ quizId, teamCount: 7 })).body.code).toBe(
        "INVALID_TEAM_COUNT"
      );
      expect((await api().post(base).set(host.auth).send({ quizId, timerSeconds: 0 })).body.code).toBe(
        "INVALID_TIMER"
      );
    });

    it("lets the host change teams, timer and names in the lobby only", async () => {
      const host = await createUser();
      const player = await createUser();
      const code = await createGame(host, {}, 16);
      await join(player, code, "t2");

      const res = await api()
        .patch(`${base}/${code}`)
        .set(host.auth)
        .send({ teamCount: 3, timerSeconds: 25, teams: [{ id: "t1", name: "Owls" }] });
      expect(res.status).toBe(200);
      expect(res.body.game.teams.map((t: any) => t.name)).toEqual(["Owls", "Team B", "Team C"]);
      expect(res.body.game.board).toMatchObject({ size: 4, lineLength: 3 });
      expect(res.body.game.timerSeconds).toBe(25);
      for (const timerSeconds of [5, 10, 15, 20, 30]) {
        const ok = await api().patch(`${base}/${code}`).set(host.auth).send({ timerSeconds });
        expect(ok.body.game.timerSeconds).toBe(timerSeconds);
      }
      for (const timerSeconds of [0, 4, 12, 35, 60, 120]) {
        const bad = await api().patch(`${base}/${code}`).set(host.auth).send({ timerSeconds });
        expect(bad.body.code).toBe("INVALID_TIMER");
      }

      // Shrinking takes the dropped team's players off it.
      const shrunk = await api().patch(`${base}/${code}`).set(host.auth).send({ teamCount: 2 });
      expect(shrunk.body.game.teams).toHaveLength(2);
      expect(shrunk.body.game.teams[1].members).toHaveLength(1);

      expect((await api().patch(`${base}/${code}`).set(player.auth).send({ timerSeconds: 20 })).status).toBe(403);
    });
  });

  describe("lobby", () => {
    it("keeps the host off the teams", async () => {
      const host = await createUser();
      const code = await createGame(host);
      for (const teamId of ["t1", null]) {
        const res = await join(host, code, teamId);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("HOST_CANNOT_PLAY");
      }
      expect((await api().get(`${base}/${code}`).set(host.auth)).body.game.unassigned).toEqual([]);
    });

    it("makes the first player on a team its leader, and hands over when they leave", async () => {
      const host = await createUser();
      const a = await createUser();
      const b = await createUser();
      const code = await createGame(host);

      expect((await join(a, code, "t1")).body.game.teams[0].leaderId).toBe(a.id);
      const both = (await join(b, code, "t1")).body.game;
      expect(both.teams[0].leaderId).toBe(a.id);
      expect(both.teams[0].members.map((m: any) => m.userId)).toEqual([a.id, b.id]);

      // Switching team in the lobby is fine; the old team's lead moves on.
      const switched = (await join(a, code, "t2")).body.game;
      expect(switched.teams[0].leaderId).toBe(b.id);
      expect(switched.teams[1].leaderId).toBe(a.id);

      const left = (await api().post(`${base}/${code}/leave`).set(a.auth)).body.game;
      expect(left.teams[1]).toMatchObject({ leaderId: null, members: [] });
    });

    it("lets the host move players and choose leaders", async () => {
      const host = await createUser();
      const a = await createUser();
      const b = await createUser();
      const code = await createGame(host);
      await join(a, code, "t1");
      await join(b, code); // in the game, not on a team yet

      const moved = await api().post(`${base}/${code}/players/${b.id}/team`).set(host.auth).send({ teamId: "t1" });
      expect(moved.body.game.unassigned).toEqual([]);
      expect(moved.body.game.teams[0].members).toHaveLength(2);

      const led = await api().post(`${base}/${code}/teams/t1/leader`).set(host.auth).send({ userId: b.id });
      expect(led.body.game.teams[0].leaderId).toBe(b.id);

      expect(
        (await api().post(`${base}/${code}/teams/t2/leader`).set(host.auth).send({ userId: a.id })).body.code
      ).toBe("NOT_ON_TEAM");
      expect(
        (await api().post(`${base}/${code}/teams/t1/leader`).set(a.auth).send({ userId: a.id })).status
      ).toBe(403);
    });

    it("needs two teams with players to start, and drops empty teams", async () => {
      const host = await createUser();
      const a = await createUser();
      const b = await createUser();
      const code = await createGame(host, { teamCount: 3 }, 16);
      await join(a, code, "t1");
      expect((await start(host, code)).body.code).toBe("NOT_ENOUGH_TEAMS");

      await join(b, code, "t3");
      expect((await start(a, code)).status).toBe(403);
      const started = (await start(host, code)).body.game;
      expect(started.status).toBe("playing");
      expect(started.teams.map((t: any) => t.id)).toEqual(["t1", "t3"]);
      // Two teams left, so the board is the 3x3 one.
      expect(started.board).toMatchObject({ size: 3, lineLength: 3 });
      expect(started.turnTeamId).toBe("t1");
    });
  });

  describe("play", () => {
    it("only lets the leader of the team in turn pick and answer", async () => {
      const { a, a2, b, code } = await startedGame();
      expect((await pick(b, code, 0)).body.code).toBe("NOT_YOUR_TURN");
      expect((await pick(a2, code, 0)).body.code).toBe("NOT_LEADER");

      const opened = (await pick(a, code, 4)).body.game;
      expect(opened.current).toMatchObject({ cellIndex: 4, number: 5, teamId: "t1", timerSeconds: expect.any(Number) });
      expect(opened.current.question.options).toHaveLength(2);
      // The answer never leaves the server while the question is open.
      expect(JSON.stringify(opened)).not.toContain("correctOptionIndex");

      expect((await pick(a, code, 5)).body.code).toBe("QUESTION_OPEN");
      expect((await answer(a2, code, 0)).body.code).toBe("NOT_LEADER");
    });

    it("gives the point and the cell to the team, then passes the turn", async () => {
      const { a, b, code } = await startedGame();
      const after = await play(a, code, 4, true);
      expect(after.teams[0].score).toBe(1);
      expect(after.board.cells[4].owner).toBe("t1");
      expect(after.lastPlay).toMatchObject({ cellIndex: 4, teamId: "t1", outcome: "correct" });
      expect(after.turnTeamId).toBe("t2");

      expect((await pick(b, code, 4)).body.code).toBe("CELL_TAKEN");
    });

    it("leaves a missed cell open with a fresh question", async () => {
      const { a, b, code } = await startedGame();
      await pick(a, code, 0);
      const firstCard = (await TeamGameModel.findOne({ code }).lean())!.current!.cardId;
      const correct = await correctOption(code);
      const missed = (await answer(a, code, 1 - correct)).body.game;
      expect(missed.board.cells[0].owner).toBeNull();
      expect(missed.teams[0].score).toBe(0);
      expect(missed.lastPlay).toMatchObject({ outcome: "wrong", optionIndex: 1 - correct, correctOptionIndex: correct });
      expect(missed.turnTeamId).toBe("t2");

      await pick(b, code, 0);
      expect((await TeamGameModel.findOne({ code }).lean())!.current!.cardId).not.toBe(firstCard);
    });

    it("times out a question when its clock runs out", async () => {
      const { a, code } = await startedGame();
      await pick(a, code, 2);
      await TeamGameModel.updateOne({ code }, { "current.deadlineAt": new Date(Date.now() - 5000) });

      const state = (await api().get(`${base}/${code}`).set(a.auth)).body.game;
      expect(state.current).toBeNull();
      expect(state.lastPlay).toMatchObject({ cellIndex: 2, outcome: "timeout" });
      expect(state.turnTeamId).toBe("t2");
      expect((await answer(a, code, 0)).body.code).toBe("NO_QUESTION_OPEN");
    });

    it("ends the game when a team completes a line", async () => {
      const { a, b, code } = await startedGame();
      await play(a, code, 0, true);
      await play(b, code, 3, true);
      await play(a, code, 1, true);
      await play(b, code, 4, true);
      const won = await play(a, code, 2, true);
      expect(won).toMatchObject({
        status: "finished",
        endReason: "line",
        winnerTeamId: "t1",
        winningLine: [0, 1, 2],
        isDraw: false,
        current: null,
      });
      expect(won.resultUrl).toBe(`https://app.pazzell.test/team/${code}/result`);
      expect((await pick(b, code, 5)).body.code).toBe("GAME_NOT_PLAYING");
    });

    it("gives a full board with no line to the highest score", async () => {
      const { a, b, code } = await startedGame();
      // A: 0 1 5 6 8   B: 2 3 4 7  -> no line for either
      const moves: [TestUser, number][] = [
        [a, 0], [b, 2], [a, 1], [b, 3], [a, 5], [b, 4], [a, 6], [b, 7], [a, 8],
      ];
      let state: any;
      for (const [leader, cell] of moves) state = await play(leader, code, cell, true);
      expect(state).toMatchObject({ status: "finished", endReason: "board_full", winnerTeamId: "t1", isDraw: false });
    });

    it("lets the host end the game: top score wins, a tie is a draw", async () => {
      const { host, a, code } = await startedGame();
      const draw = await api().post(`${base}/${code}/end`).set(host.auth);
      expect(draw.body.game).toMatchObject({ status: "finished", endReason: "host_ended", isDraw: true, winnerTeamId: null });

      const second = await startedGame();
      await play(second.a, second.code, 4, true);
      const ended = await api().post(`${base}/${second.code}/end`).set(second.host.auth);
      expect(ended.body.game).toMatchObject({ winnerTeamId: "t1", isDraw: false });
      expect((await api().post(`${base}/${code}/end`).set(a.auth)).status).toBe(403);
    });

    it("cancels a game ended in the lobby", async () => {
      const host = await createUser();
      const code = await createGame(host);
      const res = await api().post(`${base}/${code}/end`).set(host.auth);
      expect(res.body.game.status).toBe("cancelled");
      expect((await api().get(`${base}/${code}/result`)).status).toBe(404);
    });

    it("fixes teams once play starts but lets newcomers join one", async () => {
      const { a, code } = await startedGame();
      expect((await join(a, code, "t2")).body.code).toBe("TEAMS_LOCKED");
      const late = await createUser();
      const joined = (await join(late, code, "t2")).body.game;
      expect(joined.teams[1].members).toHaveLength(2);
    });

    it("passes the lead to the next team member after each turn", async () => {
      const { a, a2, b, code } = await startedGame();
      const leaderOf = async (teamId: string) =>
        (await TeamGameModel.findOne({ code }).lean())!.teams.find((t) => t.id === teamId)!.leaderId;

      expect(await leaderOf("t1")).toBe(a.id);
      await play(a, code, 0, false); // a leads A's first turn, wrong or right
      expect(await leaderOf("t1")).toBe(a2.id);
      expect(await leaderOf("t2")).toBe(b.id);

      await play(b, code, 3, true); // a team of one keeps its only member as leader
      expect(await leaderOf("t2")).toBe(b.id);

      // A's next turn is a2's: a can no longer pick.
      expect((await pick(a, code, 1)).body.code).toBe("NOT_LEADER");
      await play(a2, code, 1, true);
      expect(await leaderOf("t1")).toBe(a.id); // and round again
    });

    it("uses the copied question even if the quiz is edited mid-game", async () => {
      const { a, code } = await startedGame();
      await pick(a, code, 0);
      const correct = await correctOption(code);
      await CustomQuizCardModel.deleteMany({});
      expect((await answer(a, code, correct)).body.game.lastPlay.outcome).toBe("correct");
    });
  });

  describe("topic games", () => {
    /** A self-serve game from a General Trivia topic, created by `creator`. */
    async function topicGame(creator: TestUser, extra: Record<string, any> = {}, cards = 12) {
      const topicId = await createTopic(cards, "Capitals");
      const res = await api().post(base).set(creator.auth).send({ topicId, ...extra });
      return { res, topicId, code: res.body.game?.code as string };
    }

    it("lets any player create one, play in it and start it", async () => {
      const creator = await createUser();
      const friend = await createUser();
      const stranger = await createUser();
      remember(creator, friend, stranger);

      const { res, topicId, code } = await topicGame(creator, { teamCount: 2, timerSeconds: 15 });
      expect(res.status).toBe(201);
      expect(res.body.game).toMatchObject({
        kind: "topic",
        status: "lobby",
        quiz: { id: null, title: "Capitals" },
        topic: { id: topicId, name: "Capitals" },
        host: { userId: creator.id },
        timerSeconds: 15,
        joinUrl: `https://app.pazzell.test/team/${code}`,
      });
      // The creator plays: already on Team A, as its leader.
      expect(res.body.game.teams[0]).toMatchObject({ leaderId: creator.id });
      expect(res.body.game.teams[0].members.map((m: any) => m.userId)).toEqual([creator.id]);

      // They can switch team like anyone else.
      expect((await join(creator, code, "t2")).body.game.teams[1].leaderId).toBe(creator.id);
      expect((await join(creator, code, "t1")).status).toBe(200);

      await join(friend, code, "t2");
      expect((await start(friend, code)).body.code).toBe("NOT_HOST");
      const started = (await start(creator, code)).body.game;
      expect(started.status).toBe("playing");

      // Questions come from the topic; nobody sees an answer before it is settled.
      const opened = (await pick(creator, code, 4)).body.game;
      expect(opened.current.question.text).toMatch(/^Statement number/);
      expect(JSON.stringify(opened)).not.toContain("correctOptionIndex");
      const correct = await correctOption(code);
      expect((await answer(creator, code, correct)).body.game.teams[0].score).toBe(1);
    });

    it("needs an active topic with a question for every cell", async () => {
      const creator = await createUser();
      expect((await topicGame(creator, {}, 5)).res.body.code).toBe("NOT_ENOUGH_CARDS");
      expect((await topicGame(creator, { teamCount: 3 }, 12)).res.body.code).toBe("NOT_ENOUGH_CARDS");

      const hidden = await createTopic(12, "Hidden");
      await TriviaTopicModel.updateOne({ _id: hidden }, { isActive: false });
      const res = await api().post(base).set(creator.auth).send({ topicId: hidden });
      expect(res.body.code).toBe("TOPIC_NOT_FOUND");
      expect((await topicGame(creator, { timerSeconds: 45 })).res.body.code).toBe("INVALID_TIMER");
    });

    it("hands control to the next player when the creator leaves, and cancels an empty lobby", async () => {
      const creator = await createUser();
      const friend = await createUser();
      const { code } = await topicGame(creator);
      await join(friend, code, "t2");

      const left = (await api().post(`${base}/${code}/leave`).set(creator.auth)).body.game;
      expect(left.host).toMatchObject({ userId: friend.id });
      expect(left.status).toBe("lobby");
      expect((await start(friend, code)).body.code).toBe("NOT_ENOUGH_TEAMS"); // friend is host now

      const empty = (await api().post(`${base}/${code}/leave`).set(friend.auth)).body.game;
      expect(empty.status).toBe("cancelled");
    });

    /** A started 2-team topic game: the creator leads Team A, friend leads Team B. */
    async function startedTopicGame() {
      const creator = await createUser();
      const friend = await createUser();
      remember(creator, friend);
      const { code } = await topicGame(creator);
      await join(friend, code, "t2");
      expect((await start(creator, code)).status).toBe(200);
      return { creator, friend, code };
    }

    it("can't be stopped mid-game by its creator, only cancelled before it starts", async () => {
      const creator = await createUser();
      const { code: lobby } = await topicGame(creator);
      expect((await api().post(`${base}/${lobby}/end`).set(creator.auth)).body.game.status).toBe("cancelled");

      const { creator: host, code } = await startedTopicGame();
      const res = await api().post(`${base}/${code}/end`).set(host.auth);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("GAME_CANNOT_END");
      expect((await api().get(`${base}/${code}`).set(host.auth)).body.game.status).toBe("playing");
    });

    it("gives the team in turn 30 seconds to choose, and the clock stops once it does", async () => {
      const { creator, code } = await startedTopicGame();
      const state = (await api().get(`${base}/${code}`).set(creator.auth)).body.game;
      const left = new Date(state.pickDeadlineAt).getTime() - Date.now();
      expect(left).toBeGreaterThan(25_000);
      expect(left).toBeLessThanOrEqual(30_000);

      const opened = (await pick(creator, code, 4)).body.game;
      expect(opened.pickDeadlineAt).toBeNull();
      const correct = await correctOption(code);
      const after = (await answer(creator, code, correct)).body.game;
      // Team B's turn now, with its own 30 seconds.
      expect(after.turnTeamId).toBe("t2");
      expect(new Date(after.pickDeadlineAt).getTime()).toBeGreaterThan(Date.now() + 25_000);
    });

    it("hands the game to the waiting team when the team in turn doesn't choose in time", async () => {
      const { creator, friend, code } = await startedTopicGame();
      // Team A scores first, then Team B lets its 30 seconds run out.
      await play(creator, code, 4, true);
      await TeamGameModel.updateOne({ code }, { pickDeadlineAt: new Date(Date.now() - 5000) });

      const state = (await api().get(`${base}/${code}`).set(friend.auth)).body.game;
      expect(state).toMatchObject({
        status: "finished",
        endReason: "forfeit",
        forfeitTeamId: "t2",
        winnerTeamId: "t1",
        isDraw: false,
        pickDeadlineAt: null,
      });
      expect((await pick(friend, code, 0)).body.code).toBe("GAME_NOT_PLAYING");
      const result = (await api().get(`${base}/${code}/result`)).body.result;
      expect(result).toMatchObject({ endReason: "forfeit", forfeitTeamId: "t2", winnerTeamId: "t1" });

      // The waiting team wins even when the team that ran out of time was ahead.
      const second = await startedTopicGame();
      await play(second.creator, second.code, 0, false); // A misses
      await play(second.friend, second.code, 4, true); // B leads 1-0
      await play(second.creator, second.code, 1, false); // A misses; B to choose
      await TeamGameModel.updateOne({ code: second.code }, { pickDeadlineAt: new Date(Date.now() - 5000) });
      const won = (await api().get(`${base}/${second.code}`).set(second.creator.auth)).body.game;
      expect(won.teams.find((t: any) => t.id === "t2").score).toBe(1);
      expect(won).toMatchObject({ endReason: "forfeit", forfeitTeamId: "t2", winnerTeamId: "t1" });
    });

    it("leaves hosted quiz games without a choosing clock", async () => {
      const { host, code } = await startedGame();
      const state = (await api().get(`${base}/${code}`).set(host.auth)).body.game;
      expect(state.pickDeadlineAt).toBeNull();
      expect((await api().post(`${base}/${code}/end`).set(host.auth)).body.game.status).toBe("finished");
    });

    it("has a public result anyone can share", async () => {
      const creator = await createUser();
      const friend = await createUser();
      remember(creator, friend);
      const { code } = await topicGame(creator);
      await join(friend, code, "t2");
      await start(creator, code);
      await play(creator, code, 0, true);
      await play(friend, code, 3, true);
      await play(creator, code, 1, true);
      await play(friend, code, 4, true);
      await play(creator, code, 2, true);

      const res = await api().get(`${base}/${code}/result`);
      expect(res.status).toBe(200);
      expect(res.body.result).toMatchObject({ kind: "topic", quiz: { title: "Capitals" }, winnerTeamId: "t1" });
    });
  });

  describe("result card", () => {
    it("is public once finished and lists every team's players", async () => {
      const { a, a2, b, code } = await startedGame();
      expect((await api().get(`${base}/${code}/result`)).status).toBe(404);

      await play(a, code, 0, true);
      await play(b, code, 3, true);
      await play(a, code, 1, true);
      await play(b, code, 4, false);
      await play(a, code, 2, true);

      const res = await api().get(`${base}/${code}/result`);
      expect(res.status).toBe(200);
      const { result } = res.body;
      expect(result).toMatchObject({
        quiz: { title: "Team quiz" },
        winnerTeamId: "t1",
        endReason: "line",
        winningLine: [0, 1, 2],
        questionsPlayed: 5,
      });
      expect(result.teams[0]).toMatchObject({
        id: "t1",
        isWinner: true,
        score: 3,
        cellsClaimed: 3,
        questionsAnswered: 3,
        correctAnswers: 3,
      });
      expect(result.teams[0].members).toHaveLength(2);
      expect(result.teams[0].members.filter((m: any) => m.isLeader)).toHaveLength(1);
      expect(result.teams[1]).toMatchObject({ id: "t2", score: 1, questionsAnswered: 2, correctAnswers: 1 });
      // Public: names, never account ids.
      expect(JSON.stringify(result)).not.toContain(a2.id);
    });
  });

  describe("team chat", () => {
    it("is only readable by the team", async () => {
      const { a, a2, b, code } = await startedGame();
      const sent = await api().post(`${base}/${code}/messages`).set(a2.auth).send({ text: "It's the second one" });
      expect(sent.status).toBe(201);

      const mine = await api().get(`${base}/${code}/messages`).set(a.auth);
      expect(mine.body.messages.map((m: any) => m.text)).toEqual(["It's the second one"]);
      const theirs = await api().get(`${base}/${code}/messages`).set(b.auth);
      expect(theirs.body.messages).toEqual([]);

      const outsider = await createUser();
      expect((await api().get(`${base}/${code}/messages`).set(outsider.auth)).body.code).toBe("NOT_ON_TEAM");
      expect((await api().post(`${base}/${code}/messages`).set(a.auth).send({ text: "  " })).status).toBe(400);
    });
  });

  describe("live updates", () => {
    let server: http.Server;
    let url: string;
    const sockets: Socket[] = [];

    beforeAll(async () => {
      server = http.createServer(app);
      attachRealtime(server, watchTeamGame);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      url = `http://localhost:${(server.address() as AddressInfo).port}`;
    });
    afterEach(() => sockets.splice(0).forEach((s) => s.close()));
    afterAll(async () => {
      closeRealtime();
      await new Promise((resolve) => server.close(resolve));
    });

    const connect = (user: TestUser) => {
      const socket = connectClient(url, { auth: { token: user.token }, transports: ["websocket"] });
      sockets.push(socket);
      return socket;
    };
    const watch = (socket: Socket, code: string) =>
      new Promise<any>((resolve) => socket.emit("team-game:watch", { code }, resolve));
    const next = (socket: Socket, event: string) => new Promise<any>((resolve) => socket.once(event, resolve));

    it("refuses a socket without a valid session", async () => {
      const socket = connectClient(url, { auth: { token: "nope" }, transports: ["websocket"] });
      sockets.push(socket);
      const error = await new Promise<Error>((resolve) => socket.once("connect_error", resolve));
      expect(error.message).toBeTruthy();
    });

    it("pushes state to everyone and chat to the team only", async () => {
      const { a, a2, b, code } = await startedGame();
      const sa = connect(a);
      const sa2 = connect(a2);
      const sb = connect(b);
      const watched = await Promise.all([watch(sa, code), watch(sa2, code), watch(sb, code)]);
      expect(watched.every((r) => r.ok && r.state.code === code)).toBe(true);

      const stateForB = next(sb, "team-game:state");
      await pick(a, code, 4);
      expect((await stateForB).current).toMatchObject({ cellIndex: 4, teamId: "t1" });

      const heardByTeammate = next(sa2, "team-game:message");
      let leaked = false;
      sb.on("team-game:message", () => (leaked = true));
      await api().post(`${base}/${code}/messages`).set(a.auth).send({ text: "Pick option one" });
      expect((await heardByTeammate).text).toBe("Pick option one");
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(leaked).toBe(false);
    });

    it("moves a watching player into their new team's chat", async () => {
      const host = await createUser();
      const a = await createUser();
      const b = await createUser();
      const code = await createGame(host);
      await join(a, code, "t1");
      await join(b, code); // watching, not on a team yet
      const sb = connect(b);
      await watch(sb, code);

      await join(b, code, "t1");
      const heard = next(sb, "team-game:message");
      await api().post(`${base}/${code}/messages`).set(a.auth).send({ text: "Welcome" });
      expect((await heard).text).toBe("Welcome");
    });
  });
});
