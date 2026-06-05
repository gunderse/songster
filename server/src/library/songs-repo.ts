import type DatabaseType from "better-sqlite3";

import type { LibrarySong, LibraryStats, SongListQuery, SongUpdate } from "@songster/shared/library";

interface SongRow {
  id: string;
  file_path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  raw_year: number | null;
  year: number | null;
  snippet_start_s: number | null;
  snippet_len_s: number | null;
  duration_s: number | null;
  art_path: string | null;
  status: string;
  suspicious_flags: string;
}

const SONG_COLUMNS =
  "id, file_path, title, artist, album, genre, raw_year, year, snippet_start_s, snippet_len_s, duration_s, art_path, status, suspicious_flags";

function toDto(row: SongRow): LibrarySong {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    genre: row.genre,
    rawYear: row.raw_year,
    year: row.year,
    snippetStartS: row.snippet_start_s,
    snippetLenS: row.snippet_len_s,
    durationS: row.duration_s,
    hasArt: row.art_path !== null,
    status: (row.status as LibrarySong["status"]) ?? "unreviewed",
    suspiciousFlags: parseFlags(row.suspicious_flags),
  };
}

function parseFlags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function listSongs(db: DatabaseType.Database, query: SongListQuery): LibrarySong[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.status !== "all") {
    where.push("status = @status");
    params.status = query.status;
  }
  if (query.flaggedOnly) {
    where.push("suspicious_flags != '[]'");
  }
  if (query.search !== undefined && query.search.length > 0) {
    where.push("(title LIKE @search OR artist LIKE @search OR album LIKE @search)");
    params.search = `%${query.search}%`;
  }

  const orderBy =
    query.sort === "title"
      ? "title COLLATE NOCASE ASC"
      : query.sort === "artist"
        ? "artist COLLATE NOCASE ASC, title COLLATE NOCASE ASC"
        : query.sort === "year"
          ? "year IS NULL, year ASC, title COLLATE NOCASE ASC"
          : // "flagged": review-worthy first, then missing year, then title
            "(suspicious_flags != '[]') DESC, (year IS NULL) DESC, title COLLATE NOCASE ASC";

  const sql = `SELECT ${SONG_COLUMNS} FROM songs${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${orderBy}`;
  return (db.prepare(sql).all(params) as SongRow[]).map(toDto);
}

export function getSong(db: DatabaseType.Database, id: string): LibrarySong | null {
  const row = db.prepare(`SELECT ${SONG_COLUMNS} FROM songs WHERE id = ?`).get(id) as SongRow | undefined;
  return row ? toDto(row) : null;
}

const COLUMN_FOR_FIELD: Record<keyof SongUpdate, string> = {
  year: "year",
  snippetStartS: "snippet_start_s",
  snippetLenS: "snippet_len_s",
  title: "title",
  artist: "artist",
  status: "status",
};

export function updateSong(db: DatabaseType.Database, id: string, update: SongUpdate): LibrarySong | null {
  const assignments: string[] = [];
  const params: Record<string, unknown> = { id, now: Date.now() };

  for (const [field, column] of Object.entries(COLUMN_FOR_FIELD) as Array<[keyof SongUpdate, string]>) {
    if (field in update) {
      assignments.push(`${column} = @${field}`);
      params[field] = update[field] ?? null;
    }
  }

  if (assignments.length > 0) {
    const result = db
      .prepare(`UPDATE songs SET ${assignments.join(", ")}, updated_at = @now WHERE id = @id`)
      .run(params);
    if (result.changes === 0) return null;
  }

  return getSong(db, id);
}

export function getStats(db: DatabaseType.Database): LibraryStats {
  const counts = db
    .prepare("SELECT status, COUNT(*) AS c FROM songs GROUP BY status")
    .all() as Array<{ status: string; c: number }>;
  const byStatus = new Map(counts.map((row) => [row.status, row.c]));

  const total = [...byStatus.values()].reduce((sum, count) => sum + count, 0);
  const flagged = (db.prepare("SELECT COUNT(*) AS c FROM songs WHERE suspicious_flags != '[]'").get() as { c: number }).c;

  const decadeRows = db
    .prepare(
      "SELECT (year / 10) * 10 AS decade, COUNT(*) AS c FROM songs WHERE status = 'approved' AND year IS NOT NULL GROUP BY decade ORDER BY decade",
    )
    .all() as Array<{ decade: number; c: number }>;
  const decades: Record<string, number> = {};
  for (const row of decadeRows) decades[String(row.decade)] = row.c;

  return {
    total,
    unreviewed: byStatus.get("unreviewed") ?? 0,
    approved: byStatus.get("approved") ?? 0,
    excluded: byStatus.get("excluded") ?? 0,
    flagged,
    decades,
  };
}

/** Server-only: resolve the on-disk locations for streaming (never exposed to clients). */
export function getSongFileInfo(
  db: DatabaseType.Database,
  id: string,
): { filePath: string; artPath: string | null } | null {
  const row = db.prepare("SELECT file_path, art_path FROM songs WHERE id = ?").get(id) as
    | { file_path: string; art_path: string | null }
    | undefined;
  return row ? { filePath: row.file_path, artPath: row.art_path } : null;
}
