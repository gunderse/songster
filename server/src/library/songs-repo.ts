import type DatabaseType from "better-sqlite3";

import type {
  FacetCount,
  LibraryFacets,
  LibrarySong,
  LibraryStats,
  SongListQuery,
  SongUpdate,
} from "@songster/shared/library";

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

function toDto(row: SongRow, genres: string[], tags: string[]): LibrarySong {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    genre: row.genre,
    genres,
    tags,
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

/** Batch-load a song_id -> values map from a join table for the given song ids. */
function loadSetMap(db: DatabaseType.Database, table: string, column: string, ids: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT song_id, ${column} AS value FROM ${table} WHERE song_id IN (${placeholders}) ORDER BY ${column}`)
    .all(...ids) as Array<{ song_id: string; value: string }>;
  for (const row of rows) {
    const list = map.get(row.song_id) ?? [];
    list.push(row.value);
    map.set(row.song_id, list);
  }
  return map;
}

function attach(db: DatabaseType.Database, rows: SongRow[]): LibrarySong[] {
  const ids = rows.map((row) => row.id);
  const genreMap = loadSetMap(db, "song_genres", "genre", ids);
  const tagMap = loadSetMap(db, "song_tags", "tag", ids);
  return rows.map((row) => toDto(row, genreMap.get(row.id) ?? [], tagMap.get(row.id) ?? []));
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
  if (query.genre !== undefined && query.genre.length > 0) {
    where.push("id IN (SELECT song_id FROM song_genres WHERE genre = @genre)");
    params.genre = query.genre;
  }
  if (query.tag !== undefined && query.tag.length > 0) {
    where.push("id IN (SELECT song_id FROM song_tags WHERE tag = @tag)");
    params.tag = query.tag;
  }

  const orderBy =
    query.sort === "title"
      ? "title COLLATE NOCASE ASC"
      : query.sort === "artist"
        ? "artist COLLATE NOCASE ASC, title COLLATE NOCASE ASC"
        : query.sort === "year"
          ? "year IS NULL, year ASC, title COLLATE NOCASE ASC"
          : "(suspicious_flags != '[]') DESC, (year IS NULL) DESC, title COLLATE NOCASE ASC";

  const sql = `SELECT ${SONG_COLUMNS} FROM songs${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${orderBy}`;
  return attach(db, db.prepare(sql).all(params) as SongRow[]);
}

export function getSong(db: DatabaseType.Database, id: string): LibrarySong | null {
  const row = db.prepare(`SELECT ${SONG_COLUMNS} FROM songs WHERE id = ?`).get(id) as SongRow | undefined;
  if (row === undefined) return null;
  return attach(db, [row])[0] ?? null;
}

const SCALAR_COLUMN: Record<"year" | "snippetStartS" | "snippetLenS" | "title" | "artist" | "status", string> = {
  year: "year",
  snippetStartS: "snippet_start_s",
  snippetLenS: "snippet_len_s",
  title: "title",
  artist: "artist",
  status: "status",
};

function replaceSet(db: DatabaseType.Database, table: string, column: string, id: string, values: string[]): void {
  db.prepare(`DELETE FROM ${table} WHERE song_id = ?`).run(id);
  const insert = db.prepare(`INSERT OR IGNORE INTO ${table} (song_id, ${column}) VALUES (?, ?)`);
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0) insert.run(id, trimmed);
  }
}

export function updateSong(db: DatabaseType.Database, id: string, update: SongUpdate): LibrarySong | null {
  if (getSong(db, id) === null) return null;

  const apply = db.transaction(() => {
    const assignments: string[] = [];
    const params: Record<string, unknown> = { id, now: Date.now() };
    for (const [field, column] of Object.entries(SCALAR_COLUMN) as Array<[keyof typeof SCALAR_COLUMN, string]>) {
      if (field in update) {
        assignments.push(`${column} = @${field}`);
        params[field] = update[field] ?? null;
      }
    }
    if (assignments.length > 0) {
      db.prepare(`UPDATE songs SET ${assignments.join(", ")}, updated_at = @now WHERE id = @id`).run(params);
    }
    if (update.genres !== undefined) replaceSet(db, "song_genres", "genre", id, update.genres);
    if (update.tags !== undefined) replaceSet(db, "song_tags", "tag", id, update.tags);
  });
  apply();

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

export function getFacets(db: DatabaseType.Database): LibraryFacets {
  const genres = db
    .prepare("SELECT genre AS value, COUNT(*) AS count FROM song_genres GROUP BY genre ORDER BY count DESC, genre")
    .all() as FacetCount[];
  const tags = db
    .prepare("SELECT tag AS value, COUNT(*) AS count FROM song_tags GROUP BY tag ORDER BY count DESC, tag")
    .all() as FacetCount[];
  return { genres, tags };
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
