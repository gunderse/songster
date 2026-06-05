import assert from "node:assert/strict";
import { test } from "node:test";

import { computeSuspiciousFlags } from "./suspicious.js";

test("flags a greatest-hits reissue with no year", () => {
  const flags = computeSuspiciousFlags({
    album: "Journey - Greatest Hits",
    title: "Don't Stop Believin'",
    artist: "Journey",
    rawYear: null,
    durationS: 250,
  });
  assert.ok(flags.includes("reissue-album"));
  assert.ok(flags.includes("missing-year"));
});

test("flags a remix title", () => {
  const flags = computeSuspiciousFlags({
    album: "Some Album",
    title: "Mr. Brightside (Jacques Lu Cont's Thin White Duke Mix)",
    artist: "The Killers",
    rawYear: 2006,
    durationS: 267,
  });
  assert.ok(flags.includes("remix-title"));
});

test("flags various-artist dance compilations", () => {
  const flags = computeSuspiciousFlags({
    album: "Ultra Dance 07 (Disc 1)",
    title: "Some Track",
    artist: "Various Artists",
    rawYear: 2006,
    durationS: 200,
  });
  assert.ok(flags.includes("various-artist"));
  assert.ok(flags.includes("reissue-album"));
});

test("flags implausible years", () => {
  const flags = computeSuspiciousFlags({ album: "X", title: "Y", artist: "Z", rawYear: 1234, durationS: 100 });
  assert.ok(flags.includes("implausible-year"));
});

test("a clean original-album track has no flags", () => {
  const flags = computeSuspiciousFlags({
    album: "Monkey Business",
    title: "Pump It",
    artist: "The Black Eyed Peas",
    rawYear: 2005,
    durationS: 213,
  });
  assert.deepEqual(flags, []);
});
