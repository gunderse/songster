import { randomUUID } from "node:crypto";

import type DatabaseType from "better-sqlite3";

import type { ActiveTurnView, GameView, TimelineCardView, TurnResultView } from "@songster/shared/game";
import type { PlayerView, RoomConfig, RoomState, RoomStatus, TeamView } from "@songster/shared/room";

import { hasWon, insertCardAt, isCorrectPlacement, nextRotation, type PlacedCard } from "./game.js";
import { countAvailable, sampleOne, sampleSongs, type SampledSong } from "./sampling.js";

const TEAM_PRESETS: Array<{ name: string; color: string }> = [
  { name: "Red", color: "#ef4444" },
  { name: "Blue", color: "#3b82f6" },
  { name: "Green", color: "#22c55e" },
  { name: "Gold", color: "#eab308" },
];

// Unambiguous alphabet (no 0/O/1/I) for human-typeable room codes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** How long the reveal stays up before the next turn begins. */
const REVEAL_MS = 5000;

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

interface GameTeam {
  teamId: string;
  timeline: PlacedCard[];
  placerIndex: number;
}

interface ActiveTurn {
  song: SampledSong;
  teamId: string;
  placerId: string;
  phase: "placing" | "revealing";
}

interface Game {
  target: number;
  teams: GameTeam[];
  used: Set<string>;
  turnIndex: number;
  active: ActiveTurn | null;
  lastResult: TurnResultView | null;
  winnerTeamId: string | null;
  revealTimer: ReturnType<typeof setTimeout> | null;
}

interface Room {
  code: string;
  status: RoomStatus;
  config: RoomConfig;
  teams: Team[];
  players: Map<string, Player>;
  hubSockets: Set<string>;
  game: Game | null;
  createdAt: number;
}

export type JoinResult = { ok: true; room: Room; player: Player } | { ok: false; error: string };

export interface RoomHooks {
  broadcast(code: string): void;
  playAudioToHubs(code: string, audio: { songId: string; startS: number; lenS: number }): void;
}

/**
 * In-memory room/team/player/game state — the server is the source of truth for
 * the session. (Persistence across restarts is an M9 hardening item.)
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly db: DatabaseType.Database,
    private readonly hooks: RoomHooks,
  ) {}

  // ── lobby ──────────────────────────────────────────────────────────────

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
      game: null,
      createdAt: Date.now(),
    };
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  hubSocketIds(code: string): string[] {
    return [...(this.getRoom(code)?.hubSockets ?? [])];
  }

  broadcast(code: string): void {
    this.hooks.broadcast(code);
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

  // ── game ───────────────────────────────────────────────────────────────

  startGame(code: string): Room | undefined {
    const room = this.getRoom(code);
    if (room === undefined || room.status !== "lobby") return room;

    const seeds = sampleSongs(this.db, room.config.deck, room.teams.length, []);
    const used = new Set<string>();
    const teams: GameTeam[] = room.teams.map((team, i) => {
      const seed = seeds[i];
      const timeline: PlacedCard[] = [];
      if (seed !== undefined) {
        used.add(seed.songId);
        timeline.push(sampledToCard(seed, true));
      }
      return { teamId: team.id, timeline, placerIndex: 0 };
    });

    room.game = {
      target: room.config.targetLength,
      teams,
      used,
      turnIndex: 0,
      active: null,
      lastResult: null,
      winnerTeamId: null,
      revealTimer: null,
    };
    room.status = "playing";
    this.beginTurn(room);
    return room;
  }

  placeCard(socketId: string, index: number): Room | undefined {
    const found = this.findPlayerBySocket(socketId);
    if (found === undefined) return undefined;
    const { room, player } = found;
    const game = room.game;
    if (game === null || game.active === null || game.active.phase !== "placing") return room;
    if (game.active.placerId !== player.id) return room;

    const team = game.teams.find((t) => t.teamId === game.active!.teamId);
    if (team === undefined) return room;

    const slot = Math.max(0, Math.min(index, team.timeline.length));
    const song = game.active.song;
    const correct = isCorrectPlacement(team.timeline, slot, song.year);
    if (correct) {
      team.timeline = insertCardAt(team.timeline, slot, sampledToCard(song, false));
    }

    game.lastResult = {
      teamId: team.teamId,
      placerId: player.id,
      placerName: player.name,
      correct,
      placedIndex: slot,
      song: { songId: song.songId, year: song.year, title: song.title, artist: song.artist, hasArt: song.hasArt },
    };
    game.active.phase = "revealing";
    this.hooks.broadcast(room.code);

    if (correct && hasWon(team.timeline.length, game.target)) {
      game.winnerTeamId = team.teamId;
      this.finishGame(room);
      return room;
    }

    game.revealTimer = setTimeout(() => {
      game.revealTimer = null;
      game.turnIndex = nextRotation(game.turnIndex, game.teams.length);
      this.beginTurn(room);
    }, REVEAL_MS);
    return room;
  }

  private beginTurn(room: Room): void {
    const game = room.game;
    if (game === null) return;

    // Find the next team (from turnIndex) that has a connected player.
    let attempts = 0;
    let team = game.teams[game.turnIndex % game.teams.length]!;
    let placer = this.pickPlacer(room, team);
    while (placer === null && attempts < game.teams.length) {
      game.turnIndex = nextRotation(game.turnIndex, game.teams.length);
      team = game.teams[game.turnIndex % game.teams.length]!;
      placer = this.pickPlacer(room, team);
      attempts += 1;
    }
    if (placer === null) {
      // No connected players anywhere — pause until someone (re)joins.
      game.active = null;
      this.hooks.broadcast(room.code);
      return;
    }

    const song = sampleOne(this.db, room.config.deck, [...game.used]);
    if (song === null) {
      this.finishGame(room);
      return;
    }

    team.placerIndex += 1;
    game.used.add(song.songId);
    game.active = { song, teamId: team.teamId, placerId: placer.id, phase: "placing" };
    game.lastResult = null;
    this.hooks.broadcast(room.code);
    this.hooks.playAudioToHubs(room.code, {
      songId: song.songId,
      startS: song.snippetStartS,
      lenS: song.snippetLenS ?? room.config.snippetLenS,
    });
  }

  private finishGame(room: Room): void {
    const game = room.game;
    if (game !== null) {
      if (game.revealTimer !== null) {
        clearTimeout(game.revealTimer);
        game.revealTimer = null;
      }
      if (game.winnerTeamId === null) {
        const leader = [...game.teams].sort((a, b) => b.timeline.length - a.timeline.length)[0];
        game.winnerTeamId = leader?.teamId ?? null;
      }
      game.active = null;
    }
    room.status = "finished";
    this.hooks.broadcast(room.code);
  }

  private pickPlacer(room: Room, team: GameTeam): Player | null {
    const members = [...room.players.values()]
      .filter((p) => p.teamId === team.teamId && p.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    if (members.length === 0) return null;
    return members[team.placerIndex % members.length]!;
  }

  // ── views ──────────────────────────────────────────────────────────────

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
      poolSize: countAvailable(this.db, room.config.deck, []),
      game: this.gameView(room),
    };
  }

  private gameView(room: Room): GameView | null {
    const game = room.game;
    if (game === null) return null;

    const active: ActiveTurnView | null =
      game.active === null
        ? null
        : {
            teamId: game.active.teamId,
            placerId: game.active.placerId,
            placerName: room.players.get(game.active.placerId)?.name ?? "—",
            phase: game.active.phase,
            snippetLenS: game.active.song.snippetLenS ?? room.config.snippetLenS,
          };

    return {
      target: game.target,
      timelines: game.teams.map((team) => ({ teamId: team.teamId, cards: team.timeline.map(cardToView) })),
      activeTurn: active,
      lastResult: game.lastResult,
      winnerTeamId: game.winnerTeamId,
      remaining: Math.max(0, countAvailable(this.db, room.config.deck, []) - game.used.size),
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

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

function sampledToCard(song: SampledSong, isSeed: boolean): PlacedCard {
  return {
    songId: song.songId,
    year: song.year,
    title: song.title,
    artist: song.artist,
    hasArt: song.hasArt,
    isSeed,
  };
}

function cardToView(card: PlacedCard): TimelineCardView {
  return {
    songId: card.songId,
    year: card.year,
    title: card.title,
    artist: card.artist,
    hasArt: card.hasArt,
    isSeed: card.isSeed,
  };
}
