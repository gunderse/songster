process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { createServer } from "node:http";
import path from "node:path";

import express from "express";
import { Server } from "socket.io";

import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@songster/shared/events";

import { getRevealAudioCacheDir } from "./ai/voice-generator-service.js";
import { registerAudioRoutes } from "./audio-stream.js";
import { serverHost, serverPort } from "./config.js";
import { initializeDatabase } from "./db.js";
import { createLibraryRouter } from "./library/routes.js";
import { healCorruptedArt } from "./library/scan.js";
import { logger } from "./logger.js";
import { getPublicClientOrigin } from "./public-origin.js";
import { RoomManager } from "./room-service.js";
import { registerSockets } from "./socket.js";
import { createAdminRouter } from "./admin-routes.js";

const db = initializeDatabase();
healCorruptedArt(db).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "Failed to heal corrupted art on startup");
});

const app = express();
app.use(express.json());
app.use("/api/library", createLibraryRouter(db));
registerAudioRoutes(app, db);
app.use("/reveal-audio", express.static(getRevealAudioCacheDir()));
app.use("/effects", express.static(path.resolve(import.meta.dirname, "../../assets/effects")));
app.use("/showcase", express.static(path.resolve(import.meta.dirname, "../../assets/showcase")));
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, serverNow: Date.now() });
});

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: { origin: true },
});

const manager = new RoomManager(db, {
  broadcast: (code) => {
    const room = manager.getRoom(code);
    if (room !== undefined) io.to(code).emit("room:state", manager.stateView(room));
  },
  playAudioToHubs: (code, audio) => {
    const hubs = manager.hubSocketIds(code);
    if (hubs.length > 0) io.to(hubs).emit("audio:play", audio);
  },
  playDistractionToHubs: (code, payload) => {
    const hubs = manager.hubSocketIds(code);
    if (hubs.length > 0) io.to(hubs).emit("audio:distraction", payload);
  },
  emceeToHubs: (code, payload) => {
    const hubs = manager.hubSocketIds(code);
    if (hubs.length > 0) io.to(hubs).emit("emcee:play", payload);
  },
  showcaseToHubs: (code, payload) => {
    const hubs = manager.hubSocketIds(code);
    if (hubs.length > 0) io.to(hubs).emit("showcase:play", payload);
  },
  roomDestroyed: (code) => {
    io.to(code).emit("room:destroyed");
  },
});

app.use("/api/admin", createAdminRouter(manager));
registerSockets(io, manager);

httpServer.listen(serverPort, serverHost, () => {
  logger.info({ serverPort, serverHost, clientOrigin: getPublicClientOrigin() }, "songster server listening");
});
