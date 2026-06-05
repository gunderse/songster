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
  teamId: string;
  placerId: string;
  placerName: string;
  phase: "placing" | "revealing";
  snippetLenS: number;
}

export interface RevealedSong {
  songId: string;
  year: number;
  title: string | null;
  artist: string | null;
  hasArt: boolean;
}

export interface TurnResultView {
  teamId: string;
  placerId: string;
  placerName: string;
  correct: boolean;
  placedIndex: number;
  song: RevealedSong;
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
