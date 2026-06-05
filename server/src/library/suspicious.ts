/**
 * Heuristics that flag songs whose tag year is likely NOT the original release
 * year, so the curator can review them first. Flags never block a song; they
 * just sort it to the top of the review queue.
 */

const REISSUE_ALBUM_PATTERN =
  /\b(greatest\s+hits|best\s+of|the\s+best|collection|anthology|compilation|essential|remaster(?:ed)?|anniversary|deluxe|reissue|re-?issue|unplugged|now\s+that'?s|ultra\s+dance|VA\b|various)\b/i;

const REMIX_TITLE_PATTERN = /\b(remix|mix|edit|bootleg|rework|re-?edit|version)\b/i;
const LIVE_TITLE_PATTERN = /\blive\b/i;

export interface SuspicionInput {
  album: string | null;
  title: string | null;
  artist: string | null;
  rawYear: number | null;
  durationS: number | null;
}

export function computeSuspiciousFlags(input: SuspicionInput): string[] {
  const flags: string[] = [];

  if (input.rawYear === null) {
    flags.push("missing-year");
  } else if (input.rawYear < 1900 || input.rawYear > new Date().getFullYear() + 1) {
    flags.push("implausible-year");
  }

  if (input.album !== null && REISSUE_ALBUM_PATTERN.test(input.album)) {
    flags.push("reissue-album");
  }

  if (input.artist !== null && /\bvarious\b/i.test(input.artist)) {
    flags.push("various-artist");
  }

  if (input.title !== null && REMIX_TITLE_PATTERN.test(input.title)) {
    flags.push("remix-title");
  }

  if (input.title !== null && LIVE_TITLE_PATTERN.test(input.title)) {
    flags.push("live-title");
  }

  return flags;
}
