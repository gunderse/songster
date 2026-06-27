import { z } from "zod";

import type { ShowcaseView } from "./game.js";
import type { CreateAck, HubAck, JoinAck, RoomConfig, RoomState } from "./room.js";

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
  "room:state": (state: RoomState) => void;
  "room:error": (payload: { message: string }) => void;
  /** Hub-only: play a snippet by opaque song id (the hub is the sole audio source). */
  "audio:play": (payload: { songId: string; startS: number; lenS: number }) => void;
  /**
   * Hub-only: the emcee's reveal line.
   * `audioUrl` is null when the Voice API failed but the Ollama line still came
   * through — caption-only is still shown so the host always has something to say.
   */
  "emcee:play": (payload: { audioUrl: string | null; hostName: string; text: string }) => void;
  /** Hub-only: a full themed showcase segment at a peak moment. */
  "showcase:play": (payload: ShowcaseView) => void;
  "room:destroyed": () => void;
  /** Hub-only: play a distraction annoying sound. */
  "audio:distraction": (payload: { url: string }) => void;
}

export interface ClientToServerEvents {
  ping: (payload: Ping) => void;
  "room:create": (payload: { config: RoomConfig }, ack: (res: CreateAck) => void) => void;
  "room:join": (payload: { code: string; name: string }, ack: (res: JoinAck) => void) => void;
  "room:setTeam": (payload: { teamId: string }) => void;
  /** Trigger the pre-game countdown (Start moved to the hub at M8). */
  "room:start": (payload: { code: string }) => void;
  "room:pause": (payload: { code: string }) => void;
  "room:resume": (payload: { code: string }) => void;
  "room:skipIntro": (payload: { code: string }) => void;
  "hub:join": (payload: { code: string }, ack: (res: HubAck) => void) => void;
  "hub:skipSong": () => void;
  "player:placeCard": (payload: { index: number }) => void;
  "player:useSkip": () => void;
  "player:use5050": () => void;
  "player:useDistraction": () => void;
  "player:stealPlace": (payload: { index: number }) => void;
  "player:replay": () => void;
  /** Play the next slice of the same song (continuation, hub-only). */
  "player:playMore": () => void;
  /** A teammate sends a non-binding placement suggestion to the placer (M8). */
  "player:suggestPlacement": (payload: { index: number }) => void;
  "admin:addBot": (payload: { code: string }) => void;
  "admin:removeBot": (payload: { code: string; playerId: string }) => void;
}

export type InterServerEvents = Record<string, never>;

export interface SocketData {
  role?: "player" | "hub" | "admin";
  roomCode?: string;
  playerId?: string;
}
