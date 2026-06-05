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
  phase: "placing" | "revealing";
  snippetLenS: number;
  /** ms-epoch when the current snippet finishes; replay is disabled until then. */
  snippetPlayingUntil: number;
  /** An opponent who has spent a Steal token on this turn (spoiler-safe). */
  steal: { teamId: string; playerName: string } | null;
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
}

export interface GameView {
  target: number;
  timelines: Array<{ teamId: string; cards: TimelineCardView[] }>;
  activeTurn: ActiveTurnView | null;
  lastResult: TurnResultView | null;
  winnerTeamId: string | null;
  /** Approved songs (matching the deck) not yet used this game. */
  remaining: number;
}

export const placeCardSchema = z.object({ index: z.number().int().min(0).max(64) });
export type PlaceCard = z.infer<typeof placeCardSchema>;
