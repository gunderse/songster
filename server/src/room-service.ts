import { randomUUID } from "node:crypto";

import type DatabaseType from "better-sqlite3";

import type { ActiveTurnView, GameView, StealResultView, TimelineCardView, TurnResultView } from "@songster/shared/game";
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

/** Bots "think" for a beat before placing randomly. */
const BOT_MIN_MS = 1800;
const BOT_JITTER_MS = 1600;

const BOT_NAMES = ["Robby", "Circuit", "Vinyl", "Disco-Tron", "Mixtape", "Jukebot", "Decibel", "Synthia", "Cassette", "Boombox"];

interface Player {
  id: string;
  name: string;
  teamId: string | null;
  socketId: string | null;
  connected: boolean;
  joinedAt: number;
  isBot: boolean;
  tokens: number;
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
  steal: { playerId: string; teamId: string; index: number } | null;
  snippetEndsAt: number;
}

interface Game {
  target: number;
  teams: GameTeam[];
  used: Set<string>;
  turnIndex: number;
  turnCounter: number;
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

    const trimmed = name.trim();
    if (trimmed.length === 0) return { ok: false, error: "Enter a name." };

    const existing = [...room.players.values()].find((p) => !p.isBot && p.name.toLowerCase() === trimmed.toLowerCase());
    if (existing !== undefined) {
      // Reconnect (re-associate the socket) — allowed even mid-game so a phone
      // that briefly drops can rejoin and keep playing.
      if (existing.connected && existing.socketId !== null && existing.socketId !== socketId) {
        return { ok: false, error: "That name is already taken in this room." };
      }
      existing.connected = true;
      existing.socketId = socketId;
      this.resumeIfPaused(room);
      return { ok: true, room, player: existing };
    }

    if (room.status !== "lobby") return { ok: false, error: "This game has already started." };

    const player: Player = {
      id: randomUUID().slice(0, 8),
      name: trimmed,
      teamId: this.smallestTeam(room),
      socketId,
      connected: true,
      joinedAt: Date.now(),
      isBot: false,
      tokens: 0,
    };
    room.players.set(player.id, player);
    return { ok: true, room, player };
  }

  addBot(code: string): Room | undefined {
    const room = this.getRoom(code);
    if (room === undefined || room.status !== "lobby") return room;
    const used = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
    const pick = BOT_NAMES.find((n) => !used.has(`bot ${n}`.toLowerCase())) ?? `Unit ${room.players.size + 1}`;
    const bot: Player = {
      id: randomUUID().slice(0, 8),
      name: `Bot ${pick}`,
      teamId: this.smallestTeam(room),
      socketId: null,
      connected: true,
      joinedAt: Date.now(),
      isBot: true,
      tokens: 0,
    };
    room.players.set(bot.id, bot);
    return room;
  }

  removeBot(code: string, playerId: string): Room | undefined {
    const room = this.getRoom(code);
    if (room === undefined) return room;
    const player = room.players.get(playerId);
    if (player !== undefined && player.isBot && room.status === "lobby") {
      room.players.delete(playerId);
    }
    return room;
  }

  private resumeIfPaused(room: Room): void {
    if (room.status === "playing" && room.game !== null && room.game.active === null) {
      this.beginTurn(room);
    }
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

      // If the active placer drops mid-turn, move on so the game doesn't stall.
      const game = found.room.game;
      if (
        game !== null &&
        game.active !== null &&
        game.active.phase === "placing" &&
        game.active.placerId === found.player.id
      ) {
        if (game.revealTimer !== null) {
          clearTimeout(game.revealTimer);
          game.revealTimer = null;
        }
        game.turnIndex = nextRotation(game.turnIndex, game.teams.length);
        this.beginTurn(found.room);
      }
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
      turnCounter: 0,
      active: null,
      lastResult: null,
      winnerTeamId: null,
      revealTimer: null,
    };
    for (const player of room.players.values()) {
      player.tokens = room.config.tokensPerPlayer;
    }
    room.status = "playing";
    this.beginTurn(room);
    return room;
  }

  placeCard(socketId: string, index: number): Room | undefined {
    const found = this.findPlayerBySocket(socketId);
    if (found === undefined) return undefined;
    return this.resolvePlacement(found.room, found.player.id, index);
  }

  /** The active placer spends a token to pass — draw a new song for the same placer. */
  useSkip(socketId: string): Room | undefined {
    const found = this.findPlayerBySocket(socketId);
    if (found === undefined) return undefined;
    const { room, player } = found;
    const game = room.game;
    if (game === null || game.active === null || game.active.phase !== "placing") return room;
    if (game.active.placerId !== player.id || player.tokens <= 0) return room;

    player.tokens -= 1;
    const song = sampleOne(this.db, room.config.deck, [...game.used]);
    if (song === null) {
      this.finishGame(room);
      return room;
    }
    game.used.add(song.songId);
    game.turnCounter += 1;
    const lenS = song.snippetLenS ?? room.config.snippetLenS;
    game.active = {
      song,
      teamId: game.active.teamId,
      placerId: game.active.placerId,
      phase: "placing",
      steal: null,
      snippetEndsAt: Date.now() + lenS * 1000 + 1000,
    };
    game.lastResult = null;
    this.hooks.broadcast(room.code);
    this.hooks.playAudioToHubs(room.code, { songId: song.songId, startS: song.snippetStartS, lenS });
    return room;
  }

  /** Any player can re-play the snippet on the hub, once the current play finishes. */
  replay(socketId: string): Room | undefined {
    const found = this.findPlayerBySocket(socketId);
    if (found === undefined) return undefined;
    const { room } = found;
    const game = room.game;
    if (game === null || game.active === null || game.active.phase !== "placing") return room;
    if (Date.now() < game.active.snippetEndsAt) return room; // still playing

    const song = game.active.song;
    const lenS = song.snippetLenS ?? room.config.snippetLenS;
    game.active.snippetEndsAt = Date.now() + lenS * 1000 + 1000;
    this.hooks.playAudioToHubs(room.code, { songId: song.songId, startS: song.snippetStartS, lenS });
    this.hooks.broadcast(room.code);
    return room;
  }

  /** An opponent spends a token to challenge: they place the song on their OWN timeline. */
  stealPlace(socketId: string, index: number): Room | undefined {
    const found = this.findPlayerBySocket(socketId);
    if (found === undefined) return undefined;
    const { room, player } = found;
    const game = room.game;
    if (game === null || game.active === null || game.active.phase !== "placing") return room;
    if (player.teamId === null || player.teamId === game.active.teamId) return room; // opponents only
    if (player.tokens <= 0 || game.active.steal !== null) return room; // one steal per turn

    const stealerTeam = game.teams.find((t) => t.teamId === player.teamId);
    if (stealerTeam === undefined) return room;
    const slot = Math.max(0, Math.min(index, stealerTeam.timeline.length));
    player.tokens -= 1;
    game.active.steal = { playerId: player.id, teamId: player.teamId, index: slot };
    this.hooks.broadcast(room.code);
    return room;
  }

  private resolvePlacement(room: Room, playerId: string, index: number): Room {
    const game = room.game;
    if (game === null || game.active === null || game.active.phase !== "placing") return room;
    if (game.active.placerId !== playerId) return room;

    const team = game.teams.find((t) => t.teamId === game.active!.teamId);
    if (team === undefined) return room;

    const slot = Math.max(0, Math.min(index, team.timeline.length));
    const song = game.active.song;
    const placerName = room.players.get(playerId)?.name ?? "—";
    const correct = isCorrectPlacement(team.timeline, slot, song.year);
    if (correct) {
      team.timeline = insertCardAt(team.timeline, slot, sampledToCard(song, false));
    }

    // Resolve a Steal: an opponent wins the card only if the placer was WRONG
    // and the stealer's own placement is correct.
    let stealResult: StealResultView | null = null;
    let stealWonTeamId: string | null = null;
    const steal = game.active.steal;
    if (steal !== null) {
      const stealerTeam = game.teams.find((t) => t.teamId === steal.teamId);
      const stealCorrect =
        !correct && stealerTeam !== undefined && isCorrectPlacement(stealerTeam.timeline, steal.index, song.year);
      if (stealCorrect && stealerTeam !== undefined) {
        stealerTeam.timeline = insertCardAt(stealerTeam.timeline, steal.index, sampledToCard(song, false));
        if (hasWon(stealerTeam.timeline.length, game.target)) stealWonTeamId = stealerTeam.teamId;
      }
      stealResult = {
        teamId: steal.teamId,
        playerName: room.players.get(steal.playerId)?.name ?? "—",
        correct: stealCorrect,
        placedIndex: steal.index,
      };
    }

    game.lastResult = {
      teamId: team.teamId,
      placerId: playerId,
      placerName,
      correct,
      placedIndex: slot,
      song: { songId: song.songId, year: song.year, title: song.title, artist: song.artist, hasArt: song.hasArt },
      steal: stealResult,
    };
    game.active.phase = "revealing";
    this.hooks.broadcast(room.code);

    const placerWon = correct && hasWon(team.timeline.length, game.target);
    if (placerWon || stealWonTeamId !== null) {
      game.winnerTeamId = placerWon ? team.teamId : stealWonTeamId;
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

  private botPlace(room: Room, turnId: number): void {
    const game = room.game;
    if (game === null || game.active === null || game.active.phase !== "placing" || game.turnCounter !== turnId) return;
    const placer = room.players.get(game.active.placerId);
    if (placer === undefined || !placer.isBot) return;
    const team = game.teams.find((t) => t.teamId === game.active!.teamId);
    if (team === undefined) return;
    const index = Math.floor(Math.random() * (team.timeline.length + 1));
    this.resolvePlacement(room, placer.id, index);
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
    game.turnCounter += 1;
    const lenS = song.snippetLenS ?? room.config.snippetLenS;
    game.active = {
      song,
      teamId: team.teamId,
      placerId: placer.id,
      phase: "placing",
      steal: null,
      snippetEndsAt: Date.now() + lenS * 1000 + 1000,
    };
    game.lastResult = null;
    this.hooks.broadcast(room.code);
    this.hooks.playAudioToHubs(room.code, { songId: song.songId, startS: song.snippetStartS, lenS });

    if (placer.isBot) {
      const turnId = game.turnCounter;
      setTimeout(() => this.botPlace(room, turnId), BOT_MIN_MS + Math.floor(Math.random() * BOT_JITTER_MS));
    }
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
      .map((p) => ({ id: p.id, name: p.name, teamId: p.teamId, connected: p.connected, isBot: p.isBot, tokens: p.tokens }));
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
            turnId: game.turnCounter,
            teamId: game.active.teamId,
            placerId: game.active.placerId,
            placerName: room.players.get(game.active.placerId)?.name ?? "—",
            placerIsBot: room.players.get(game.active.placerId)?.isBot ?? false,
            phase: game.active.phase,
            snippetLenS: game.active.song.snippetLenS ?? room.config.snippetLenS,
            snippetPlayingUntil: game.active.snippetEndsAt,
            steal:
              game.active.steal === null
                ? null
                : {
                    teamId: game.active.steal.teamId,
                    playerName: room.players.get(game.active.steal.playerId)?.name ?? "—",
                  },
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
