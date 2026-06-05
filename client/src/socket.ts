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
