import { randomUUID } from "node:crypto";

import type DatabaseType from "better-sqlite3";

import type {
  ActiveTurnView,
  GameView,
  ShowcaseView,
  StealResultView,
  TimelineCardView,
  TurnResultView,
} from "@songster/shared/game";
import type { PlayerView, RoomConfig, RoomState, RoomStatus, TeamView } from "@songster/shared/room";

import { emceeService, type EmceeClip, type EmceeContext } from "./ai/emcee-service.js";
import { logger } from "./logger.js";
import { showcaseService, type ShowcaseReason } from "./ai/showcase-service.js";
import { showcaseEveryN } from "./config.js";
import { hasWon, insertCardAt, isCorrectPlacement, nextRotation, scoreOf, type PlacedCard } from "./game.js";
import { countAvailable, sampleOne, sampleSongs, type SampledSong } from "./sampling.js";

const TEAM_PRESETS: Array<{ name: string; color: string }> = [
  { name: "Red", color: "#ef4444" },
  { name: "Blue", color: "#3b82f6" },
  { name: "Green", color: "#22c55e" },
  { name: "Gold", color: "#eab308" },
];

// Unambiguous alphabet (no 0/O/1/I) for human-typeable room codes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** How long the reveal stays up before the next turn begins (when no voice arrives). */
const REVEAL_MS = 6000;
/** Max we'll wait at reveal for the (outcome-aware) emcee line before giving up. */
const EMCEE_WAIT_MS = 14000;
/** Always pause at least this long after a reveal SFX before advancing (drama beat). */
const POST_REVEAL_MIN_MS = 4500;
/** Floor for a showcase reveal before its cue durations are known. */
const SHOWCASE_FLOOR_MS = 11000;
/** Minimum "drumroll" before the result is shown, even when commentary is fast/cached. */
const SUSPENSE_FLOOR_MS = 2200;
/**
 * Hard cap on the drumroll. The Voice API serializes via gpu-lock and a single
 * line can take 15-25s end-to-end (Ollama 5-15s + voice synthesis 10-20s) — so
 * a tight ceiling was dropping perfectly-good lines on the floor. We reveal at
 * the cap regardless, then play the line late if it arrives within
 * LATE_EMCEE_WINDOW_MS (extending the turn so the host always gets heard).
 */
const SUSPENSE_MAX_MS = 20_000;
/** After the reveal flips, how much longer we'll wait for a late-arriving voice. */
const LATE_EMCEE_WINDOW_MS = 30_000;
/** Pre-game countdown — gives late joiners a grace period before turn 1. */
const COUNTDOWN_MS = 6000;

/** Bots "think" for a beat before placing randomly. Bumped so they don't rush past the SFX. */
const BOT_MIN_MS = 3500;
const BOT_JITTER_MS = 2500;

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
  streak: number;
}

interface ActiveTurn {
  song: SampledSong;
  teamId: string;
  placerId: string;
  phase: "placing" | "suspense" | "revealing";
  steal: { playerId: string; teamId: string; index: number } | null;
  snippetEndsAt: number;
  emceeClip: EmceeClip | null;
  emceePromise: Promise<void> | null;
  /** Auto-resolve timer for the placer's clock; null if disabled. */
  placeDeadline: number | null;
  placeTimer: ReturnType<typeof setTimeout> | null;
  /**
   * During "suspense" only: hide cards (by songId) that were just inserted this
   * turn so the placer's correct guess doesn't appear in the team timeline before
   * the year is revealed. Cleared at reveal.
   */
  hiddenSongIds: Set<string>;
  /** The placer's chosen slot on their team's timeline (where a "?" tile goes). */
  pendingPlacement: { teamId: string; index: number } | null;
  /** The stealer's chosen slot on their own team's timeline (if a steal was queued). */
  pendingStealPlacement: { teamId: string; index: number } | null;
  /** Track how far we've already played into the song for "Play More" continuations. */
  playedThroughS: number;
  /** Teammate suggestions for the placer (M8). */
  suggestions: Map<string, { teamId: string; index: number }>;
  /** True while the outcome-aware emcee/showcase line is being written + voiced. */
  commentaryPending: boolean;
  /**
   * Computed at placement time but withheld from clients during "suspense".
   * Promoted to game.lastResult the moment the reveal voice is ready (or after
   * the suspense floor), so the visual flip syncs with "Correct, Red!".
   */
  pendingResult: TurnResultView | null;
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
  leaderTeamId: string | null;
  hostName?: string | null;
  hostPromise?: Promise<string | null>;
  /** Set during the pre-game countdown; null once turn 1 begins. */
  countdownEndsAt: number | null;
  countdownTimer: ReturnType<typeof setTimeout> | null;
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
  emceeToHubs(code: string, payload: { audioUrl: string | null; hostName: string; text: string }): void;
  showcaseToHubs(code: string, payload: ShowcaseView): void;
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
        this.cancelPlaceTimer(game.active);
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
      return { teamId: team.id, timeline, placerIndex: 0, streak: 0 };
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
      leaderTeamId: null,
      countdownEndsAt: Date.now() + COUNTDOWN_MS,
      countdownTimer: null,
    };
    for (const player of room.players.values()) {
      player.tokens = room.config.tokensPerPlayer;
    }
    room.status = "playing";
    // Warm the host pick during the countdown so turn 1's commentary is fast.
    this.warmHost(room);
    room.game.countdownTimer = setTimeout(() => {
      if (room.game !== null) {
        room.game.countdownEndsAt = null;
        room.game.countdownTimer = null;
      }
      this.beginTurn(room);
    }, COUNTDOWN_MS);
    this.hooks.broadcast(room.code);
    return room;
  }

  /** A teammate sends a non-binding suggestion to the active placer. */
  suggestPlacement(socketId: string, index: number): Room | undefined {
    const found = this.findPlayerBySocket(socketId);
    if (found === undefined) return undefined;
    const { room, player } = found;
    const game = room.game;
    if (game === null || game.active === null || game.active.phase !== "placing") return room;
    if (player.teamId === null || player.teamId !== game.active.teamId) return room;
    if (player.id === game.active.placerId) return room; // the placer doesn't suggest to themselves
    game.active.suggestions.set(player.id, { teamId: player.teamId, index });
    this.hooks.broadcast(room.code);
    return room;
  }

  /** Replay a continuation: the NEXT slice of the same song, starting where the last play ended. */
  playMore(socketId: string): Room | undefined {
    const found = this.findPlayerBySocket(socketId);
    if (found === undefined) return undefined;
    const { room } = found;
    const game = room.game;
    if (game === null || game.active === null || game.active.phase !== "placing") return room;
    if (Date.now() < game.active.snippetEndsAt) return room; // still playing
    const song = game.active.song;
    const lenS = song.snippetLenS ?? room.config.snippetLenS;
    const duration = song.durationS ?? Number.POSITIVE_INFINITY;
    const nextStart = Math.min(game.active.playedThroughS, Math.max(0, duration - 5));
    game.active.playedThroughS = nextStart + lenS;
    game.active.snippetEndsAt = Date.now() + lenS * 1000 + 1000;
    this.hooks.playAudioToHubs(room.code, { songId: song.songId, startS: nextStart, lenS });
    this.hooks.broadcast(room.code);
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
      emceeClip: null,
      emceePromise: null,
      playedThroughS: song.snippetStartS + lenS,
      suggestions: new Map(),
      commentaryPending: false,
      pendingResult: null,
      placeDeadline: null,
      placeTimer: null,
      hiddenSongIds: new Set(),
      pendingPlacement: null,
      pendingStealPlacement: null,
    };
    game.lastResult = null;
    this.armPlaceTimer(room);
    this.hooks.broadcast(room.code);
    this.hooks.playAudioToHubs(room.code, { songId: song.songId, startS: song.snippetStartS, lenS });
    this.warmHost(room);
    return room;
  }

  /** Schedule the auto-resolve timer for the active placer (no-op if disabled). */
  private armPlaceTimer(room: Room): void {
    const game = room.game;
    if (game === null || game.active === null) return;
    this.cancelPlaceTimer(game.active);
    const turnTimerS = room.config.turnTimerS ?? 0;
    if (turnTimerS <= 0) return;
    const placer = room.players.get(game.active.placerId);
    if (placer === undefined || placer.isBot) return; // bots have their own delay
    const ms = turnTimerS * 1000;
    game.active.placeDeadline = Date.now() + ms;
    const turnId = game.turnCounter;
    game.active.placeTimer = setTimeout(() => this.autoResolveTurn(room, turnId), ms);
  }

  private cancelPlaceTimer(active: ActiveTurn): void {
    if (active.placeTimer !== null) {
      clearTimeout(active.placeTimer);
      active.placeTimer = null;
    }
    active.placeDeadline = null;
  }

  /** Time's up: resolve at index 0 (a guess is a guess). */
  private autoResolveTurn(room: Room, turnId: number): void {
    const game = room.game;
    if (game === null || game.active === null || game.turnCounter !== turnId) return;
    if (game.active.phase !== "placing") return;
    const placerId = game.active.placerId;
    // Pick the placer's leftmost-suggested gap if any teammate suggested, else 0.
    const suggestions = [...game.active.suggestions.values()];
    const fallbackIndex = suggestions.length > 0 ? suggestions[0]!.index : 0;
    this.resolvePlacement(room, placerId, fallbackIndex);
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

    // Lock in: kill the turn timer so a slow late-arriving placement still counts.
    this.cancelPlaceTimer(game.active);

    const slot = Math.max(0, Math.min(index, team.timeline.length));
    const song = game.active.song;
    const placerName = room.players.get(playerId)?.name ?? "—";
    const correct = isCorrectPlacement(team.timeline, slot, song.year);
    if (correct) {
      team.timeline = insertCardAt(team.timeline, slot, sampledToCard(song, false));
      // Hide the just-placed card during suspense so the year doesn't leak.
      game.active.hiddenSongIds.add(song.songId);
    }
    // Always record the placer's chosen slot so the hub renders "?" there
    // during the drumroll (works for both correct and wrong guesses).
    game.active.pendingPlacement = { teamId: team.teamId, index: slot };
    team.streak = correct ? team.streak + 1 : 0;

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
        game.active.hiddenSongIds.add(song.songId);
        if (hasWon(scoreOf(stealerTeam.timeline), game.target)) stealWonTeamId = stealerTeam.teamId;
      }
      // Always record the stealer's slot so a "?" tile shows there too.
      game.active.pendingStealPlacement = { teamId: steal.teamId, index: steal.index };
      stealResult = {
        teamId: steal.teamId,
        playerName: room.players.get(steal.playerId)?.name ?? "—",
        correct: stealCorrect,
        placedIndex: steal.index,
      };
    }

    // The result is COMPUTED now but WITHHELD until the suspense lifts and the
    // host's voice is ready (or we hit the suspense ceiling). lastResult stays
    // null while phase === "suspense" so clients can't peek at the year/title.
    const pendingResult: TurnResultView = {
      teamId: team.teamId,
      placerId: playerId,
      placerName,
      correct,
      placedIndex: slot,
      song: { songId: song.songId, year: song.year, title: song.title, artist: song.artist, hasArt: song.hasArt },
      steal: stealResult,
    };
    game.active.pendingResult = pendingResult;
    game.active.phase = "suspense";
    game.active.commentaryPending = true;
    this.hooks.broadcast(room.code);

    const revealedSong = { title: song.title, artist: song.artist, year: song.year };
    const placerWon = correct && hasWon(scoreOf(team.timeline), game.target);

    // Track the lead (for "lead change" showcases).
    const newLeader = this.uniqueLeader(game);
    const leadChanged = newLeader !== null && game.leaderTeamId !== null && newLeader !== game.leaderTeamId;
    if (newLeader !== null) game.leaderTeamId = newLeader;

    // Stash the winner trigger but DON'T promote to winnerTeamId yet — we want the
    // drumroll + voiced reveal to land before the winner screen takes over.
    const triggersWin = placerWon || stealWonTeamId !== null;
    const winnerTeamId = placerWon ? team.teamId : stealWonTeamId;

    // Pick the reveal "outro": a full showcase at peaks, else the single emcee line.
    const teamName = room.teams.find((t) => t.id === team.teamId)?.name ?? "the team";
    let reason: ShowcaseReason | null = triggersWin ? "finale" : null;
    let headline = "";
    if (reason === "finale") {
      const winnerName = room.teams.find((t) => t.id === winnerTeamId)?.name ?? "The winners";
      headline = `${winnerName} win Songster!`;
    } else if (stealResult?.correct === true) {
      reason = "steal";
      headline = `${stealResult.playerName} STOLE the card right out from under ${teamName}!`;
    } else if (leadChanged) {
      reason = "leadChange";
      headline = `${room.teams.find((t) => t.id === newLeader)?.name ?? "Someone"} just grabbed the lead!`;
    } else if (game.turnCounter % showcaseEveryN === 0) {
      reason = "milestone";
      headline = "Time for a check-in on the competition!";
    }

    const promoteWinner = (): void => {
      if (triggersWin && winnerTeamId !== null && room.game !== null) {
        room.game.winnerTeamId = winnerTeamId;
      }
    };

    if (reason !== null) {
      void this.deliverShowcase(room, game.turnCounter, reason, headline, revealedSong, correct, promoteWinner);
    } else {
      // Generate the host's line now that we know the outcome (so it opens with right/wrong),
      // then deliver it — deliverEmcee owns the reveal timer.
      game.active.emceePromise = this.generateEmcee(room, game.turnCounter, correct);
      void this.deliverEmcee(room, game.turnCounter, promoteWinner);
    }
    return room;
  }

  /**
   * Lift the suspense: expose the result, flip phase to "revealing", and
   * broadcast — so the visual ✅/❌/year flip syncs with the voice + SFX.
   * Returns true if we actually transitioned (idempotent on repeat calls).
   */
  private revealNow(room: Room, turnId: number): boolean {
    const game = room.game;
    if (game === null || game.active === null || game.turnCounter !== turnId) return false;
    if (game.active.phase !== "suspense") return false;
    game.lastResult = game.active.pendingResult;
    game.active.phase = "revealing";
    game.active.commentaryPending = false;
    // Drop the spoiler veil: real timeline cards re-appear; placeholder slots disappear.
    game.active.hiddenSongIds.clear();
    game.active.pendingPlacement = null;
    game.active.pendingStealPlacement = null;
    this.hooks.broadcast(room.code);
    return true;
  }

  private advanceTurn(room: Room): void {
    const game = room.game;
    if (game === null) return;
    game.revealTimer = null;
    game.turnIndex = nextRotation(game.turnIndex, game.teams.length);
    this.beginTurn(room);
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

  /** Warm up host selection during placement so the reveal-time line generates fast. */
  private warmHost(room: Room): void {
    const game = room.game;
    if (game === null) return;
    if (game.hostName === undefined || game.hostName === null) {
      game.hostPromise ??= emceeService.chooseHost();
    }
  }

  private async generateEmcee(room: Room, turnId: number, correct: boolean): Promise<void> {
    const game = room.game;
    if (game === null) return;
    // Pick the host once; if the voice API was down (null), retry on later turns.
    if (game.hostName === undefined || game.hostName === null) {
      game.hostPromise ??= emceeService.chooseHost();
      game.hostName = await game.hostPromise;
      game.hostPromise = undefined;
    }
    if (game.hostName === null || game.active === null || game.turnCounter !== turnId) return;
    const context = this.buildEmceeContext(room, game, correct);
    const clip = await emceeService.revealClip(game.hostName, context);
    if (game.active !== null && game.turnCounter === turnId) {
      game.active.emceeClip = clip;
    }
  }

  private buildEmceeContext(room: Room, game: Game, correct: boolean): EmceeContext {
    const active = game.active!;
    return {
      song: { title: active.song.title, artist: active.song.artist, year: active.song.year },
      teamName: room.teams.find((t) => t.id === active.teamId)?.name ?? "the team",
      placerName: room.players.get(active.placerId)?.name ?? "someone",
      situation: this.describeSituation(room, game),
      outcome: correct ? "correct" : "wrong",
    };
  }

  /** A short, spoiler-free summary of the standings for the emcee to riff on. */
  private describeSituation(room: Room, game: Game): string {
    const standings = game.teams.map((t) => ({
      name: room.teams.find((rt) => rt.id === t.teamId)?.name ?? "?",
      count: scoreOf(t.timeline),
      streak: t.streak,
      teamId: t.teamId,
    }));
    const sorted = [...standings].sort((a, b) => b.count - a.count);
    const top = sorted[0]!;
    const bottom = sorted[sorted.length - 1]!;
    const bits = [`Score: ${standings.map((s) => `${s.name} ${s.count}`).join(", ")} (first to ${game.target}).`];

    if (standings.length > 1 && standings.every((s) => s.count === standings[0]!.count)) {
      bits.push("It's all tied up.");
    } else if (top.count - bottom.count >= 3) {
      bits.push(`${top.name} is running away with it; ${bottom.name} is getting shut out.`);
    }
    const aboutToWin = standings.find((s) => s.count === game.target - 1);
    if (aboutToWin !== undefined) bits.push(`${aboutToWin.name} needs just one more to win.`);
    const activeId = game.active?.teamId;
    const activeStanding = activeId !== undefined ? standings.find((s) => s.teamId === activeId) : undefined;
    if (activeStanding !== undefined && activeStanding.streak >= 2) {
      bits.push(`${activeStanding.name} is on a ${activeStanding.streak}-in-a-row hot streak.`);
    }
    return bits.join(" ");
  }

  /**
   * Hold the drumroll until the host's line is ready (or the ceiling is hit),
   * then lift the suspense (revealNow) IN SYNC with starting the voice so the
   * ✅/❌/year flip lands at the same moment the host says "Correct, Red!".
   */
  private async deliverEmcee(room: Room, turnId: number, onReveal?: () => void): Promise<void> {
    const game = room.game;
    if (game === null || game.active === null || game.turnCounter !== turnId) return;

    // Race the host's clip against the SUSPENSE_MAX ceiling, and enforce a
    // SUSPENSE_FLOOR so even instantly-cached lines still get a beat of drumroll.
    const placedAt = Date.now();
    if (game.active.emceePromise !== null) {
      await Promise.race([game.active.emceePromise, delay(SUSPENSE_MAX_MS)]);
    }
    const drumrolled = Date.now() - placedAt;
    if (drumrolled < SUSPENSE_FLOOR_MS) await delay(SUSPENSE_FLOOR_MS - drumrolled);

    if (game.active === null || game.turnCounter !== turnId || game.active.phase !== "suspense") return;

    const clip = game.active.emceeClip;
    onReveal?.();
    this.revealNow(room, turnId); // promotes pendingResult → lastResult, phase → revealing, broadcast

    if (game.revealTimer !== null) clearTimeout(game.revealTimer);
    if (clip !== null) {
      // ALWAYS push the caption + (optional) audio. The Voice API may have failed
      // — text-only is still shown so the host always has something to say.
      this.hooks.emceeToHubs(room.code, { audioUrl: clip.audioUrl, hostName: clip.hostName, text: clip.text });
      game.revealTimer = setTimeout(() => this.advanceTurn(room), Math.max(POST_REVEAL_MIN_MS, clip.durationMs + 1800));
      return;
    }

    // No clip yet — hit the suspense ceiling. Reveal anyway with a base timer,
    // but KEEP waiting for the line. If it arrives within LATE_EMCEE_WINDOW_MS,
    // push it and extend the turn to fit. The voice never gets dropped on the floor.
    logger.info({ code: room.code, turnId }, "emcee: suspense ceiling hit; waiting for late voice");
    const baseTimerStart = Date.now();
    game.revealTimer = setTimeout(() => this.advanceTurn(room), Math.max(POST_REVEAL_MIN_MS, REVEAL_MS));

    const pending = game.active.emceePromise;
    if (pending === null) return;
    void (async () => {
      try {
        await Promise.race([pending, delay(LATE_EMCEE_WINDOW_MS)]);
      } catch {
        /* generateEmcee handles its own errors */
      }
      if (room.game === null || room.game.active === null || room.game.turnCounter !== turnId) return;
      if (room.game.active.phase !== "revealing") return;
      const late = room.game.active.emceeClip;
      if (late === null) return;
      this.hooks.emceeToHubs(room.code, { audioUrl: late.audioUrl, hostName: late.hostName, text: late.text });
      logger.info({ code: room.code, turnId, delayMs: Date.now() - baseTimerStart }, "emcee: late voice delivered");
      // Extend the timer so the late voice gets to finish.
      if (room.game.revealTimer !== null) clearTimeout(room.game.revealTimer);
      room.game.revealTimer = setTimeout(() => this.advanceTurn(room), Math.max(POST_REVEAL_MIN_MS, late.durationMs + 1800));
    })();
  }

  /**
   * At a peak, build + push a full themed showcase. Like deliverEmcee, this
   * holds the drumroll until the cues are ready, then lifts the suspense in
   * sync with starting the showcase audio so the verdict lands on cue.
   */
  private async deliverShowcase(
    room: Room,
    turnId: number,
    reason: ShowcaseReason,
    headline: string,
    song: { title: string | null; artist: string | null; year: number },
    correct: boolean,
    onReveal?: () => void,
  ): Promise<void> {
    const game = room.game;
    if (game === null) return;
    if (reason !== "finale" && game.turnCounter !== turnId) return;

    const placedAt = Date.now();
    const view = await showcaseService.build({
      reason,
      song,
      situation: this.describeSituation(room, game),
      headline,
      outcome: correct ? "correct" : "wrong",
    });

    // Honour the suspense floor — but cap so a slow showcase can't stall forever.
    const built = Date.now() - placedAt;
    if (built < SUSPENSE_FLOOR_MS) await delay(SUSPENSE_FLOOR_MS - built);

    if (game.turnCounter !== turnId) return;

    if (view === null) {
      // Fall back to the single emcee line (also outcome-aware) — that path
      // owns its own suspense floor, so it'll still land in sync.
      if (game.active !== null) {
        game.active.emceePromise = this.generateEmcee(room, turnId, correct);
        void this.deliverEmcee(room, turnId, onReveal);
      }
      return;
    }
    if (reason !== "finale" && (game.active === null || game.active.phase !== "suspense")) return;

    onReveal?.();
    this.revealNow(room, turnId);

    this.hooks.showcaseToHubs(room.code, view);
    if (reason !== "finale") {
      const total = view.cues.reduce((sum, cue) => sum + cue.durationMs, 0) + 4000;
      if (game.revealTimer !== null) clearTimeout(game.revealTimer);
      game.revealTimer = setTimeout(() => this.advanceTurn(room), Math.max(SHOWCASE_FLOOR_MS, total));
    } else {
      // Finale: the winner screen now takes over (game.winnerTeamId was
      // promoted by onReveal). The showcase plays over it; no advanceTurn.
      this.finishGame(room);
    }
  }

  private uniqueLeader(game: Game): string | null {
    const sorted = [...game.teams].sort((a, b) => scoreOf(b.timeline) - scoreOf(a.timeline));
    const top = sorted[0];
    if (top === undefined) return null;
    const second = sorted[1];
    if (second !== undefined && scoreOf(second.timeline) === scoreOf(top.timeline)) return null;
    return top.teamId;
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
      emceeClip: null,
      emceePromise: null,
      playedThroughS: song.snippetStartS + lenS,
      suggestions: new Map(),
      commentaryPending: false,
      pendingResult: null,
      placeDeadline: null,
      placeTimer: null,
      hiddenSongIds: new Set(),
      pendingPlacement: null,
      pendingStealPlacement: null,
    };
    game.lastResult = null;
    this.armPlaceTimer(room);
    this.hooks.broadcast(room.code);
    this.hooks.playAudioToHubs(room.code, { songId: song.songId, startS: song.snippetStartS, lenS });
    this.warmHost(room);

    if (placer.isBot) {
      const turnId = game.turnCounter;
      setTimeout(() => this.botPlace(room, turnId), BOT_MIN_MS + Math.floor(Math.random() * BOT_JITTER_MS));
    }
  }

  private finishGame(room: Room): void {
    const game = room.game;
    if (game !== null) {
      if (game.active !== null) this.cancelPlaceTimer(game.active);
      if (game.revealTimer !== null) {
        clearTimeout(game.revealTimer);
        game.revealTimer = null;
      }
      if (game.countdownTimer !== null) {
        clearTimeout(game.countdownTimer);
        game.countdownTimer = null;
      }
      game.countdownEndsAt = null;
      if (game.winnerTeamId === null) {
        const leader = [...game.teams].sort((a, b) => scoreOf(b.timeline) - scoreOf(a.timeline))[0];
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
            suggestions: [...game.active.suggestions.entries()].map(([playerId, s]) => ({
              playerId,
              playerName: room.players.get(playerId)?.name ?? "—",
              index: s.index,
            })),
            placeDeadline: game.active.placeDeadline,
            pendingPlacement: game.active.pendingPlacement,
            pendingStealPlacement: game.active.pendingStealPlacement,
          };

    // During suspense, hide cards just inserted this turn so a correct guess
    // doesn't leak the year — the placer's chosen slot is rendered as a "?"
    // placeholder client-side via ActiveTurnView.pendingPlacement.
    const hide = game.active?.hiddenSongIds ?? new Set<string>();
    return {
      target: game.target,
      timelines: game.teams.map((team) => ({
        teamId: team.teamId,
        cards: team.timeline.filter((c) => !hide.has(c.songId)).map(cardToView),
      })),
      activeTurn: active,
      lastResult: game.lastResult,
      winnerTeamId: game.winnerTeamId,
      remaining: Math.max(0, countAvailable(this.db, room.config.deck, []) - game.used.size),
      countdownEndsAt: game.countdownEndsAt,
      commentaryPending: game.active?.commentaryPending ?? false,
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
