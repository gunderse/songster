import { randomUUID } from "node:crypto";

import type DatabaseType from "better-sqlite3";

import type { DeckFilter, PlayerView, RoomConfig, RoomState, RoomStatus, TeamView } from "@songster/shared/room";

const TEAM_PRESETS: Array<{ name: string; color: string }> = [
  { name: "Red", color: "#ef4444" },
  { name: "Blue", color: "#3b82f6" },
  { name: "Green", color: "#22c55e" },
  { name: "Gold", color: "#eab308" },
];

// Unambiguous alphabet (no 0/O/1/I) for human-typeable room codes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface Player {
  id: string;
  name: string;
  teamId: string | null;
  socketId: string | null;
  connected: boolean;
  joinedAt: number;
}

interface Team {
  id: string;
  name: string;
  color: string;
}

interface Room {
  code: string;
  status: RoomStatus;
  config: RoomConfig;
  teams: Team[];
  players: Map<string, Player>;
  hubSockets: Set<string>;
  createdAt: number;
}

export type JoinResult = { ok: true; room: Room; player: Player } | { ok: false; error: string };

/**
 * In-memory room/team/player state — the server is the source of truth for the
 * session. (Persistence across restarts is an M9 hardening item.)
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly db: DatabaseType.Database) {}

  createRoom(config: RoomConfig): Room {
    const code = this.generateCode();
    const teams: Team[] = TEAM_PRESETS.slice(0, config.teamCount).map((preset) => ({
      id: randomUUID().slice(0, 8),
      name: preset.name,
      color: preset.color,
    }));
    const room: Room = {
      code,
      status: "lobby",
      config,
      teams,
      players: new Map(),
      hubSockets: new Set(),
      createdAt: Date.now(),
    };
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  join(code: string, socketId: string, name: string): JoinResult {
    const room = this.getRoom(code);
    if (room === undefined) return { ok: false, error: "Room not found." };
    if (room.status !== "lobby") return { ok: false, error: "This game has already started." };

    const trimmed = name.trim();
    if (trimmed.length === 0) return { ok: false, error: "Enter a name." };

    const existing = [...room.players.values()].find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    if (existing !== undefined) {
      if (existing.connected) return { ok: false, error: "That name is already taken in this room." };
      // Reconnect under the same name.
      existing.connected = true;
      existing.socketId = socketId;
      return { ok: true, room, player: existing };
    }

    const player: Player = {
      id: randomUUID().slice(0, 8),
      name: trimmed,
      teamId: this.smallestTeam(room),
      socketId,
      connected: true,
      joinedAt: Date.now(),
    };
    room.players.set(player.id, player);
    return { ok: true, room, player };
  }

  setTeam(socketId: string, teamId: string): Room | undefined {
    const found = this.findPlayerBySocket(socketId);
    if (found === undefined) return undefined;
    const { room, player } = found;
    if (room.status === "lobby" && room.teams.some((t) => t.id === teamId)) {
      player.teamId = teamId;
    }
    return room;
  }

  start(code: string): Room | undefined {
    const room = this.getRoom(code);
    if (room !== undefined && room.status === "lobby") {
      room.status = "playing";
    }
    return room;
  }

  registerHub(code: string, socketId: string): Room | undefined {
    const room = this.getRoom(code);
    room?.hubSockets.add(socketId);
    return room;
  }

  findPlayerBySocket(socketId: string): { room: Room; player: Player } | undefined {
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.socketId === socketId) return { room, player };
      }
    }
    return undefined;
  }

  handleDisconnect(socketId: string): Room | undefined {
    let touched: Room | undefined;
    for (const room of this.rooms.values()) {
      if (room.hubSockets.delete(socketId)) touched = room;
    }
    const found = this.findPlayerBySocket(socketId);
    if (found !== undefined) {
      found.player.connected = false;
      found.player.socketId = null;
      touched = found.room;
    }
    return touched;
  }

  stateView(room: Room): RoomState {
    const teams: TeamView[] = room.teams.map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color,
      playerIds: [...room.players.values()].filter((p) => p.teamId === team.id).map((p) => p.id),
    }));
    const players: PlayerView[] = [...room.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.id, name: p.name, teamId: p.teamId, connected: p.connected }));
    return {
      code: room.code,
      status: room.status,
      config: room.config,
      teams,
      players,
      poolSize: countApprovedSongs(this.db, room.config.deck),
    };
  }

  private smallestTeam(room: Room): string {
    const counts = new Map(room.teams.map((t) => [t.id, 0]));
    for (const player of room.players.values()) {
      if (player.teamId !== null) counts.set(player.teamId, (counts.get(player.teamId) ?? 0) + 1);
    }
    let best = room.teams[0]!.id;
    let min = Number.POSITIVE_INFINITY;
    for (const team of room.teams) {
      const count = counts.get(team.id) ?? 0;
      if (count < min) {
        min = count;
        best = team.id;
      }
    }
    return best;
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let code = "";
      for (let i = 0; i < 4; i += 1) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("Could not allocate a unique room code.");
  }
}

/** Count approved songs matching the deck filter (genres/tags are any-match). */
function countApprovedSongs(db: DatabaseType.Database, deck: DeckFilter): number {
  const where = ["status = 'approved'"];
  const params: Record<string, string> = {};

  if (deck.genres !== undefined && deck.genres.length > 0) {
    const keys = deck.genres.map((_, i) => `@g${i}`);
    where.push(`id IN (SELECT song_id FROM song_genres WHERE genre IN (${keys.join(",")}))`);
    deck.genres.forEach((genre, i) => (params[`g${i}`] = genre));
  }
  if (deck.tags !== undefined && deck.tags.length > 0) {
    const keys = deck.tags.map((_, i) => `@t${i}`);
    where.push(`id IN (SELECT song_id FROM song_tags WHERE tag IN (${keys.join(",")}))`);
    deck.tags.forEach((tag, i) => (params[`t${i}`] = tag));
  }

  const row = db.prepare(`SELECT COUNT(*) AS c FROM songs WHERE ${where.join(" AND ")}`).get(params) as { c: number };
  return row.c;
}
