import type { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { userFromAccessToken } from "../../utils/auth";

// Live updates for team games over socket.io. Every change is made through the REST
// endpoints; this only pushes the result out, so a client that misses an event can
// always re-sync with GET /team-games/:code.
//
// Rooms:  tg:<gameId>                 everyone watching the game (state updates)
//         tg:<gameId>:team:<teamId>   one team's members (its private chat)
//         tg:<gameId>:user:<userId>   one player's sockets, to move them between teams
//
// With more than one API instance, add the socket.io Redis adapter so rooms span them.

export interface WatchAccess {
  gameId: string;
  teamId: string | null; // the team chat this user may read, if any
  state: unknown;
}

type WatchHandler = (code: string, userId: string) => Promise<WatchAccess>;

let io: Server | null = null;

const gameRoom = (gameId: string) => `tg:${gameId}`;
const teamRoom = (gameId: string, teamId: string) => `tg:${gameId}:team:${teamId}`;
const userRoom = (gameId: string, userId: string) => `tg:${gameId}:user:${userId}`;

export function attachRealtime(server: HttpServer, onWatch: WatchHandler): Server {
  io = new Server(server, {
    // Same as the REST API: auth travels in the token, not in cookies.
    cors: { origin: "*" },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string" || !token) throw new Error("Authentication Failed");
      const user = await userFromAccessToken(token);
      socket.data.userId = String(user._id);
      next();
    } catch (error: any) {
      next(new Error(error?.message || "Authentication Failed"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const userId: string = socket.data.userId;

    // ack({ ok, state }) or ack({ ok: false, message, code })
    socket.on("team-game:watch", async (payload: any, ack?: (reply: unknown) => void) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const code = String(payload?.code || "");
        const access = await onWatch(code, userId);
        for (const room of socket.rooms) {
          if (room.startsWith("tg:")) socket.leave(room);
        }
        socket.join([gameRoom(access.gameId), userRoom(access.gameId, userId)]);
        if (access.teamId) socket.join(teamRoom(access.gameId, access.teamId));
        reply({ ok: true, state: access.state });
      } catch (error: any) {
        reply({ ok: false, message: error?.message || "Could not open the game", code: error?.code });
      }
    });

    socket.on("team-game:unwatch", () => {
      for (const room of socket.rooms) {
        if (room.startsWith("tg:")) socket.leave(room);
      }
    });
  });

  return io;
}

/** Sends the new game state to everyone watching it. */
export function emitGameState(gameId: string, state: unknown) {
  io?.to(gameRoom(gameId)).emit("team-game:state", state);
}

/** Sends a chat line to one team only. */
export function emitTeamMessage(gameId: string, teamId: string, message: unknown) {
  io?.to(teamRoom(gameId, teamId)).emit("team-game:message", message);
}

/** Moves a player's open sockets to their new team's chat (or out of every team chat). */
export function moveToTeamRoom(gameId: string, userId: string, from: string | null, to: string | null) {
  if (!io || from === to) return;
  const sockets = io.in(userRoom(gameId, userId));
  if (from) sockets.socketsLeave(teamRoom(gameId, from));
  if (to) sockets.socketsJoin(teamRoom(gameId, to));
}

export function closeRealtime() {
  io?.close();
  io = null;
}
