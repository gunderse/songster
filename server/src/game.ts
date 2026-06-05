/** Pure, unit-tested game rules. No I/O, no randomness — see room-service for orchestration. */

export interface PlacedCard {
  songId: string;
  year: number;
  title: string | null;
  artist: string | null;
  hasArt: boolean;
  isSeed: boolean;
}

/**
 * Is dropping a card of `year` into slot `index` of a year-ascending `timeline`
 * consistent with chronological order? Slot 0 = before the oldest, slot
 * `length` = after the newest. Ties count as correct on either side.
 */
export function isCorrectPlacement(timeline: ReadonlyArray<{ year: number }>, index: number, year: number): boolean {
  if (index < 0 || index > timeline.length) return false;
  const left = index > 0 ? timeline[index - 1]!.year : Number.NEGATIVE_INFINITY;
  const right = index < timeline.length ? timeline[index]!.year : Number.POSITIVE_INFINITY;
  return left <= year && year <= right;
}

/** Insert a card at `index` (used only when the placement is correct, so order is preserved). */
export function insertCardAt(timeline: ReadonlyArray<PlacedCard>, index: number, card: PlacedCard): PlacedCard[] {
  const next = timeline.slice();
  next.splice(Math.max(0, Math.min(index, next.length)), 0, card);
  return next;
}

export function hasWon(timelineLength: number, target: number): boolean {
  return timelineLength >= target;
}

/** Round-robin next index over `length` items, given the current index. */
export function nextRotation(current: number, length: number): number {
  if (length <= 0) return 0;
  return (current + 1) % length;
}
