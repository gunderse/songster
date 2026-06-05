import { z } from "zod";

/**
 * Songster socket contract.
 *
 * M0 covers only the health/handshake events (`hello`, `ping`/`pong`).
 * Room, lobby, turn, and show events are layered on in later milestones.
 * Every client->server payload is validated server-side with its zod schema.
 */

export const pingSchema = z.object({
  sentAt: z.number(),
});
export type Ping = z.infer<typeof pingSchema>;

export const pongSchema = z.object({
  sentAt: z.number(),
  serverNow: z.number(),
});
export type Pong = z.infer<typeof pongSchema>;

export const helloSchema = z.object({
  message: z.string(),
  serverNow: z.number(),
});
export type Hello = z.infer<typeof helloSchema>;

export interface ServerToClientEvents {
  hello: (payload: Hello) => void;
  pong: (payload: Pong) => void;
}

export interface ClientToServerEvents {
  ping: (payload: Ping) => void;
}

export type InterServerEvents = Record<string, never>;

export interface SocketData {
  role?: "player" | "hub" | "admin";
  roomCode?: string;
  playerId?: string;
}
