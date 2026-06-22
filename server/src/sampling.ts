import type DatabaseType from "better-sqlite3";

import type { DeckFilter } from "@songster/shared/room";

export interface SampledSong {
  songId: string;
  year: number;
  title: string | null;
  artist: string | null;
  hasArt: boolean;
  snippetStartS: number;
  snippetLenS: number | null;
  durationS: number | null;
}

interface SongSampleRow {
  id: string;
  year: number;
  title: string | null;
  artist: string | null;
  has_art: number;
  snippet_start_s: number | null;
  snippet_len_s: number | null;
  duration_s: number | null;
}

function defaultStart(duration: number | null): number {
  if (duration === null || duration <= 0) return 30;
  return Math.round(Math.min(30, duration * 0.25));
}

function toSampled(row: SongSampleRow): SampledSong {
  return {
    songId: row.id,
    year: row.year,
    title: row.title,
    artist: row.artist,
    hasArt: row.has_art === 1,
    snippetStartS: row.snippet_start_s ?? defaultStart(row.duration_s),
    snippetLenS: row.snippet_len_s,
    durationS: row.duration_s,
  };
}

function buildFilter(deck: DeckFilter, musicSource: "local" | "plex" | "all", exclude: string[]): { clause: string; params: Record<string, string> } {
  const where = ["status = 'approved'", "year IS NOT NULL"];
  const params: Record<string, string> = {};

  if (musicSource === "local") {
    where.push("file_path NOT LIKE 'plex://%'");
  } else if (musicSource === "plex") {
    where.push("file_path LIKE 'plex://%'");
  }

  if (deck.genres !== undefined && deck.genres.length > 0) {
    const keys = deck.genres.map((_, i) => `@g${i}`);
    where.push(`id IN (SELECT song_id FROM song_genres WHERE genre IN (${keys.join(",")}))`);
    deck.genres.forEach((genre, i) => (params[`g${i}`] = genre));
  }
  if (deck.tags !== undefined && deck.tags.length > 0) {
    const keys = deck.tags.map((_, i) => `@t${i}`);
    where.push(`id IN (SELECT song_id FROM song_tags WHERE tag IN (${keys.join(",")}))`);
    deck.tags.forEach((tag, i) => (params[`t${i}`] = tag));
  }
  if (exclude.length > 0) {
    const keys = exclude.map((_, i) => `@x${i}`);
    where.push(`id NOT IN (${keys.join(",")})`);
    exclude.forEach((id, i) => (params[`x${i}`] = id));
  }

  return { clause: where.join(" AND "), params };
}

export function sampleSongs(db: DatabaseType.Database, deck: DeckFilter, musicSource: "local" | "plex" | "all", count: number, exclude: string[]): SampledSong[] {
  const { clause, params } = buildFilter(deck, musicSource, exclude);
  const rows = db
    .prepare(
      `SELECT id, year, title, artist, (art_path IS NOT NULL) AS has_art, snippet_start_s, snippet_len_s, duration_s
       FROM songs WHERE ${clause} ORDER BY RANDOM() LIMIT @count`,
    )
    .all({ ...params, count }) as SongSampleRow[];
  return rows.map(toSampled);
}

export function sampleOne(db: DatabaseType.Database, deck: DeckFilter, musicSource: "local" | "plex" | "all", exclude: string[]): SampledSong | null {
  return sampleSongs(db, deck, musicSource, 1, exclude)[0] ?? null;
}

export function countAvailable(db: DatabaseType.Database, deck: DeckFilter, musicSource: "local" | "plex" | "all", exclude: string[]): number {
  const { clause, params } = buildFilter(deck, musicSource, exclude);
  return (db.prepare(`SELECT COUNT(*) AS c FROM songs WHERE ${clause}`).get(params) as { c: number }).c;
}
