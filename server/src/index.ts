import { createServer } from "node:http";

import express from "express";
import { Server } from "socket.io";

import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@songster/shared/events";

import { registerAudioRoutes } from "./audio-stream.js";
import { serverHost, serverPort } from "./config.js";
import { initializeDatabase } from "./db.js";
import { createLibraryRouter } from "./library/routes.js";
import { logger } from "./logger.js";
import { getPublicClientOrigin } from "./public-origin.js";
import { RoomManager } from "./room-service.js";
import { registerSockets } from "./socket.js";

const db = initializeDatabase();
const manager = new RoomManager(db);

const app = express();
app.use(express.json());
app.use("/api/library", createLibraryRouter(db));
registerAudioRoutes(app, db);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, serverNow: Date.now() });
});

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: { origin: true },
});

registerSockets(io, manager);

httpServer.listen(serverPort, serverHost, () => {
  logger.info(
    { serverPort, serverHost, clientOrigin: getPublicClientOrigin() },
    "songster server listening",
  );
});
