import { z } from "zod";

import type { GameView } from "./game.js";

/** Room / lobby / team contract (M3+). Spoiler-safe: no unrevealed song data appears here. */

export const roomStatusSchema = z.enum(["lobby", "playing", "finished"]);
export type RoomStatus = z.infer<typeof roomStatusSchema>;

/** Optional deck filter — restrict the playable pool by genre/tag (any-match). */
export const deckFilterSchema = z.object({
  genres: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type DeckFilter = z.infer<typeof deckFilterSchema>;

export const roomConfigSchema = z.object({
  targetLength: z.number().int().min(3).max(20).default(7),
  specialsPerTeam: z.number().int().min(0).max(10).default(1),
  snippetLenS: z.number().int().min(5).max(60).default(30),
  teamCount: z.number().int().min(2).max(4).default(2),
  /** Per-turn timer (s). 0 disables the auto-resolve. */
  turnTimerS: z.number().int().min(0).max(180).default(60),
  deck: deckFilterSchema.default({}),
  musicSource: z.enum(["local", "plex", "all"]).default("all"),
  showcaseSteals: z.boolean().default(false),
  showcaseLeadChanges: z.boolean().default(false),
  showcaseStreaks: z.boolean().default(false),
  showcaseMilestones: z.boolean().default(false),
  narratorVoice: z.string().optional(),
});
export type RoomConfig = z.infer<typeof roomConfigSchema>;

export interface TeamView {
  id: string;
  name: string;
  color: string;
  playerIds: string[];
  tokens: number;
}

export interface PlayerView {
  id: string;
  name: string;
  teamId: string | null;
  connected: boolean;
  isBot: boolean;
}

export interface RoomState {
  code: string;
  status: RoomStatus;
  config: RoomConfig;
  teams: TeamView[];
  players: PlayerView[];
  /** Approved songs matching the deck filter — so the admin knows it's playable. */
  poolSize: number;
  /** Present once the game is running (null in the lobby). */
  game: GameView | null;
}

// ── socket payloads ──────────────────────────────────────────────────────────

const roomCode = z.string().trim().length(4).toUpperCase();

export const createRoomSchema = z.object({ config: roomConfigSchema });
export const joinRoomSchema = z.object({
  code: roomCode,
  name: z.string().trim().min(1).max(24),
});
export const setTeamSchema = z.object({ teamId: z.string().min(1).max(64) });
export const roomCodeSchema = z.object({ code: roomCode });
export const removeBotSchema = z.object({ code: roomCode, playerId: z.string().trim().min(1).max(64) });

export type CreateAck = { ok: true; code: string } | { ok: false; error: string };
export type JoinAck = { ok: true; playerId: string; teamId: string } | { ok: false; error: string };
export type HubAck = { ok: true } | { ok: false; error: string };
