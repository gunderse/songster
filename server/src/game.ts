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
  const left = index > 0 ? Number(timeline[index - 1]!.year) : Number.NEGATIVE_INFINITY;
  const right = index < timeline.length ? Number(timeline[index]!.year) : Number.POSITIVE_INFINITY;
  const targetYear = Number(year);
  return left <= targetYear && targetYear <= right;
}

/** Insert a card at `index` (used only when the placement is correct, so order is preserved). */
export function insertCardAt(timeline: ReadonlyArray<PlacedCard>, index: number, card: PlacedCard): PlacedCard[] {
  const next = timeline.slice();
  next.splice(Math.max(0, Math.min(index, next.length)), 0, card);
  return next;
}

/**
 * A team's score = correctly-placed cards.
 * The seed card every team starts with is a reference point, not a point earned —
 * so it doesn't count toward the win target or the scoreboard.
 */
export function scoreOf(timeline: ReadonlyArray<PlacedCard>): number {
  return timeline.reduce((n, card) => n + (card.isSeed ? 0 : 1), 0);
}

export function hasWon(score: number, target: number): boolean {
  return score >= target;
}

/** Round-robin next index over `length` items, given the current index. */
export function nextRotation(current: number, length: number): number {
  if (length <= 0) return 0;
  return (current + 1) % length;
}
