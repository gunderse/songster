import assert from "node:assert/strict";
import { test } from "node:test";

import { hasWon, insertCardAt, isCorrectPlacement, nextRotation, type PlacedCard } from "./game.js";

const tl = (years: number[]): Array<{ year: number }> => years.map((year) => ({ year }));

test("placement into an empty timeline is always correct", () => {
  assert.equal(isCorrectPlacement([], 0, 1999), true);
});

test("placement at the edges", () => {
  const timeline = tl([1980, 1995, 2008]);
  assert.equal(isCorrectPlacement(timeline, 0, 1975), true); // before oldest
  assert.equal(isCorrectPlacement(timeline, 0, 1985), false); // 1985 is not before 1980
  assert.equal(isCorrectPlacement(timeline, 3, 2020), true); // after newest
  assert.equal(isCorrectPlacement(timeline, 3, 2000), false); // 2000 is not after 2008
});

test("placement between neighbors", () => {
  const timeline = tl([1980, 1995, 2008]);
  assert.equal(isCorrectPlacement(timeline, 1, 1990), true); // between 1980 and 1995
  assert.equal(isCorrectPlacement(timeline, 1, 2000), false); // 2000 belongs after 1995
  assert.equal(isCorrectPlacement(timeline, 2, 2000), true); // between 1995 and 2008
});

test("ties are correct on either adjacent side", () => {
  const timeline = tl([1980, 1995, 2008]);
  assert.equal(isCorrectPlacement(timeline, 1, 1980), true); // equal to left neighbor
  assert.equal(isCorrectPlacement(timeline, 2, 1995), true); // equal to left neighbor
  assert.equal(isCorrectPlacement(timeline, 1, 1995), true); // equal to right neighbor

  // same-year adjacent slots comprehensive checks
  assert.equal(isCorrectPlacement(tl([1980]), 0, 1980), true); // before 1980
  assert.equal(isCorrectPlacement(tl([1980]), 1, 1980), true); // after 1980
  assert.equal(isCorrectPlacement(tl([1980, 1980]), 0, 1980), true); // before first 1980
  assert.equal(isCorrectPlacement(tl([1980, 1980]), 1, 1980), true); // between two 1980s
  assert.equal(isCorrectPlacement(tl([1980, 1980]), 2, 1980), true); // after second 1980

  // coercion checks (in case database has string values)
  assert.equal(isCorrectPlacement(tl([1980]), 0, "1980" as any), true);
  assert.equal(isCorrectPlacement([{ year: "1980" as any }], 0, 1980), true);
});

test("out-of-range slots are rejected", () => {
  assert.equal(isCorrectPlacement(tl([2000]), -1, 1999), false);
  assert.equal(isCorrectPlacement(tl([2000]), 2, 1999), false);
});

test("insertCardAt keeps the timeline ordered for a correct placement", () => {
  const card: PlacedCard = { songId: "x", year: 1990, title: "T", artist: "A", hasArt: false, isSeed: false };
  const start: PlacedCard[] = [
    { songId: "a", year: 1980, title: null, artist: null, hasArt: false, isSeed: true },
    { songId: "b", year: 1995, title: null, artist: null, hasArt: false, isSeed: false },
  ];
  const next = insertCardAt(start, 1, card);
  assert.deepEqual(
    next.map((c) => c.year),
    [1980, 1990, 1995],
  );
  assert.equal(start.length, 2, "input is not mutated");
});

test("win condition", () => {
  assert.equal(hasWon(9, 10), false);
  assert.equal(hasWon(10, 10), true);
  assert.equal(hasWon(11, 10), true);
});

test("rotation wraps around", () => {
  assert.equal(nextRotation(0, 3), 1);
  assert.equal(nextRotation(2, 3), 0);
  assert.equal(nextRotation(0, 0), 0);
});
