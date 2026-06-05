import type { Server, Socket } from "socket.io";

import {
  pingSchema,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from "@songster/shared/events";
import { placeCardSchema } from "@songster/shared/game";
import { createRoomSchema, joinRoomSchema, removeBotSchema, roomCodeSchema, setTeamSchema } from "@songster/shared/room";

import { logger } from "./logger.js";
import type { RoomManager } from "./room-service.js";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerSockets(io: AppServer, manager: RoomManager): void {
  io.on("connection", (socket: AppSocket) => {
    logger.info({ socketId: socket.id }, "client connected");
    socket.emit("hello", { message: "songster-online", serverNow: Date.now() });

    socket.on("ping", (payload) => {
      const parsed = pingSchema.safeParse(payload);
      if (parsed.success) socket.emit("pong", { sentAt: parsed.data.sentAt, serverNow: Date.now() });
    });

    socket.on("room:create", (payload, ack) => {
      const parsed = createRoomSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: "Invalid room configuration." });
        return;
      }
      const room = manager.createRoom(parsed.data.config);
      socket.data.role = "admin";
      socket.data.roomCode = room.code;
      void socket.join(room.code);
      logger.info({ code: room.code, config: room.config }, "room created");
      ack({ ok: true, code: room.code });
      manager.broadcast(room.code);
    });

    socket.on("room:join", (payload, ack) => {
      const parsed = joinRoomSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: "Enter a 4-letter code and a name." });
        return;
      }
      const result = manager.join(parsed.data.code, socket.id, parsed.data.name);
      if (!result.ok) {
        ack({ ok: false, error: result.error });
        return;
      }
      socket.data.role = "player";
      socket.data.roomCode = result.room.code;
      socket.data.playerId = result.player.id;
      void socket.join(result.room.code);
      logger.info({ code: result.room.code, player: result.player.name }, "player joined");
      ack({ ok: true, playerId: result.player.id, teamId: result.player.teamId ?? "" });
      manager.broadcast(result.room.code);
    });

    socket.on("room:setTeam", (payload) => {
      const parsed = setTeamSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = manager.setTeam(socket.id, parsed.data.teamId);
      if (room !== undefined) manager.broadcast(room.code);
    });

    socket.on("room:start", (payload) => {
      const parsed = roomCodeSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = manager.startGame(parsed.data.code);
      if (room !== undefined) logger.info({ code: room.code }, "game started");
    });

    socket.on("admin:addBot", (payload) => {
      const parsed = roomCodeSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = manager.addBot(parsed.data.code);
      if (room !== undefined) manager.broadcast(room.code);
    });

    socket.on("admin:removeBot", (payload) => {
      const parsed = removeBotSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = manager.removeBot(parsed.data.code, parsed.data.playerId);
      if (room !== undefined) manager.broadcast(room.code);
    });

    socket.on("player:placeCard", (payload) => {
      const parsed = placeCardSchema.safeParse(payload);
      if (!parsed.success) return;
      manager.placeCard(socket.id, parsed.data.index);
    });

    socket.on("player:useSkip", () => {
      manager.useSkip(socket.id);
    });

    socket.on("player:stealPlace", (payload) => {
      const parsed = placeCardSchema.safeParse(payload);
      if (!parsed.success) return;
      manager.stealPlace(socket.id, parsed.data.index);
    });

    socket.on("hub:join", (payload, ack) => {
      const parsed = roomCodeSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: "Invalid code." });
        return;
      }
      const room = manager.registerHub(parsed.data.code, socket.id);
      if (room === undefined) {
        ack({ ok: false, error: "Room not found." });
        return;
      }
      socket.data.role = "hub";
      socket.data.roomCode = room.code;
      void socket.join(room.code);
      ack({ ok: true });
      socket.emit("room:state", manager.stateView(room));
    });

    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, reason }, "client disconnected");
      const room = manager.handleDisconnect(socket.id);
      if (room !== undefined) manager.broadcast(room.code);
    });
  });
}
