import { createServer } from "node:http";

import express from "express";
import { Server } from "socket.io";

import {
  pingSchema,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from "@songster/shared/events";

import { serverHost, serverPort } from "./config.js";
import { initializeDatabase } from "./db.js";
import { logger } from "./logger.js";
import { getPublicClientOrigin } from "./public-origin.js";

initializeDatabase();

const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, serverNow: Date.now() });
});

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: { origin: true },
});

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "client connected");
  socket.emit("hello", { message: "songster-online", serverNow: Date.now() });

  socket.on("ping", (payload) => {
    const parsed = pingSchema.safeParse(payload);
    if (!parsed.success) {
      logger.warn({ socketId: socket.id }, "rejected invalid ping payload");
      return;
    }
    socket.emit("pong", { sentAt: parsed.data.sentAt, serverNow: Date.now() });
  });

  socket.on("disconnect", (reason) => {
    logger.info({ socketId: socket.id, reason }, "client disconnected");
  });
});

httpServer.listen(serverPort, serverHost, () => {
  logger.info(
    { serverPort, serverHost, clientOrigin: getPublicClientOrigin() },
    "songster server listening",
  );
});
