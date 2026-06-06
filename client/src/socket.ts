import { io, type Socket } from "socket.io-client";

import type { ClientToServerEvents, ServerToClientEvents } from "@songster/shared/events";

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: false,
  transports: ["polling", "websocket"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 2000,
  timeout: 5000,
});

// Dev-only handle for debugging from the console / preview.
if (import.meta.env.DEV) {
  (globalThis as unknown as { songsterSocket?: typeof socket }).songsterSocket = socket;
}
