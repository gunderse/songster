import { z } from "zod";

/** Spoiler-safe game views (M4). The active mystery card never carries a year/title. */

export interface TimelineCardView {
  songId: string;
  year: number;
  title: string | null;
  artist: string | null;
  hasArt: boolean;
  isSeed: boolean;
}

export interface ActiveTurnView {
  /** Monotonic id; changes every turn so clients can reset placement state. */
  turnId: number;
  teamId: string;
  placerId: string;
  placerName: string;
  placerIsBot: boolean;
  /**
   * placing → the placer is choosing.
   * suspense → they locked in; "drumroll" while the host writes + starts speaking. Year is hidden.
   * revealing → result is shown (correctness/year/title/art) in sync with the voice.
   */
  phase: "placing" | "suspense" | "revealing";
  snippetLenS: number;
  /** ms-epoch when the current snippet finishes; replay is disabled until then. */
  snippetPlayingUntil: number;
  /** An opponent who has spent a Steal token on this turn (spoiler-safe). */
  steal: { teamId: string; playerName: string } | null;
  /** Non-binding teammate suggestions for the placer (M8). */
  suggestions: Array<{ playerId: string; playerName: string; index: number }>;
  /** ms-epoch the placer's clock runs out (auto-resolve). null = no timer. */
  placeDeadline: number | null;
  /**
   * During "suspense", the placer's chosen slot on their team's timeline.
   * Clients render a "?" placeholder tile there so a correct guess doesn't
   * spoil the answer before the reveal. Null outside suspense.
   */
  pendingPlacement: { teamId: string; index: number } | null;
  /** Same idea for the stealer's chosen slot (if any). */
  pendingStealPlacement: { teamId: string; index: number } | null;
}

export interface RevealedSong {
  songId: string;
  year: number;
  title: string | null;
  artist: string | null;
  hasArt: boolean;
}

export interface StealResultView {
  teamId: string;
  playerName: string;
  correct: boolean;
  placedIndex: number;
}

export interface TurnResultView {
  teamId: string;
  placerId: string;
  placerName: string;
  correct: boolean;
  placedIndex: number;
  song: RevealedSong;
  /** A Steal resolution, when an opponent challenged this turn. */
  steal: StealResultView | null;
  timeout?: boolean;
}

export interface GameView {
  target: number;
  timelines: Array<{ teamId: string; cards: TimelineCardView[] }>;
  activeTurn: ActiveTurnView | null;
  lastResult: TurnResultView | null;
  winnerTeamId: string | null;
  /** Approved songs (matching the deck) not yet used this game. */
  remaining: number;
  /** ms-epoch; non-null during the pre-game countdown so hubs/players can show a timer. */
  countdownEndsAt: number | null;
  /** True when the intro narration duration is estimated and numeric countdown matches it. */
  countdownReady: boolean;
  /** True while the server is generating an outcome-aware emcee/showcase line. */
  commentaryPending: boolean;
  paused: boolean;
}

export const placeCardSchema = z.object({ index: z.number().int().min(0).max(64) });
export type PlaceCard = z.infer<typeof placeCardSchema>;

// ── showcase (M7): a themed multi-character produced segment at the peaks ──

export interface ShowcaseCueView {
  speakerLabel: string;
  characterName: string | null;
  text: string;
  audioUrl: string | null;
  durationMs: number;
}

export interface ShowcaseView {
  themeId: string;
  themeLabel: string;
  tagline: string;
  bgVideoUrl: string | null;
  bgImageUrl: string | null;
  bgMusicUrl: string | null;
  cues: ShowcaseCueView[];
}
