import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type DatabaseType from "better-sqlite3";

import { logger } from "../logger.js";
import { extractMetadata } from "./metadata.js";
import { computeSuspiciousFlags } from "./suspicious.js";
import { getSetting } from "./settings-repo.js";

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".flac", ".ogg", ".oga", ".opus", ".wav", ".aac"]);
const artDir = path.resolve(import.meta.dirname, "../../data/art");

export interface ScanOptions {
  musicDir: string;
}

export interface ScanSummary {
  musicDir: string;
  scanned: number;
  inserted: number;
  updated: number;
  flagged: number;
  withArt: number;
  errors: number;
}

interface SongUpsertRow {
  id: string;
  file_path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  tag_genre: string | null;
  raw_year: number | null;
  snippet_start_s: number | null;
  duration_s: number | null;
  art_path: string | null;
  suspicious_flags: string;
  now: number;
}

function opaqueId(relativePath: string): string {
  return createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
}

/** Default snippet anchor: a quarter of the way in, capped at 30s. The curator can scrub. */
function defaultSnippetStart(durationS: number | null): number | null {
  if (durationS === null || durationS <= 0) return null;
  return Math.round(Math.min(30, durationS * 0.25));
}

/** Genre comes from the immediate subfolder under the music root; fall back to the ID3 genre. */
function genreFromRelativePath(relativePath: string, fallback: string | null): string | null {
  const segments = relativePath.split(path.sep);
  return segments.length > 1 ? (segments[0] ?? fallback) : fallback;
}

/** Last-resort display title for untagged files, derived from the file name. */
function titleFromFileName(relativePath: string): string {
  const base = path.basename(relativePath, path.extname(relativePath)).replace(/_/g, " ").trim();
  return base.length > 0 ? base : relativePath;
}

function extensionForImage(format: string): string {
  if (format.includes("png")) return "png";
  if (format.includes("webp")) return "webp";
  if (format.includes("gif")) return "gif";
  return "jpg";
}

async function readDirSafe(root: string) {
  try {
    return await readdir(root, { withFileTypes: true });
  } catch (error) {
    logger.warn({ root, error: (error as Error).message }, "could not read directory");
    return [];
  }
}

async function* walkAudioFiles(root: string): AsyncGenerator<string> {
  for (const entry of await readDirSafe(root)) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkAudioFiles(fullPath);
    } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield fullPath;
    }
  }
}

async function scanPlexLibrary(
  db: DatabaseType.Database,
  plexUrl: string,
  plexToken: string,
  plexLibraryName: string,
  scanLimit: number,
  summary: ScanSummary,
  upsert: DatabaseType.Statement,
  ensureGenre: DatabaseType.Statement,
  existing: Set<string>
): Promise<void> {
  const cleanPlexUrl = plexUrl.replace(/\/+$/, "");
  logger.info({ plexUrl: cleanPlexUrl, libraryName: plexLibraryName, limit: scanLimit }, "scanning Plex music library");
  
  const sectionsResponse = await fetch(`${cleanPlexUrl}/library/sections`, {
    headers: {
      "Accept": "application/json",
      "X-Plex-Token": plexToken,
    },
  });
  if (!sectionsResponse.ok) {
    throw new Error(`Failed to fetch sections from Plex: status ${sectionsResponse.status}`);
  }
  const sectionsData = await sectionsResponse.json() as any;
  const section = (sectionsData.MediaContainer?.Directory || []).find(
    (dir: any) => dir.title.toLowerCase() === plexLibraryName.toLowerCase()
  );
  if (!section) {
    throw new Error(`Plex library section "${plexLibraryName}" not found. Available: ${(sectionsData.MediaContainer?.Directory || []).map((d: any) => d.title).join(", ")}`);
  }
  const sectionId = section.key;

  const tracksResponse = await fetch(`${cleanPlexUrl}/library/sections/${sectionId}/all?type=10&X-Plex-Token=${plexToken}`, {
    headers: {
      "Accept": "application/json",
    },
  });
  if (!tracksResponse.ok) {
    throw new Error(`Failed to fetch tracks from Plex: status ${tracksResponse.status}`);
  }
  const tracksData = await tracksResponse.json() as any;
  const tracks = tracksData.MediaContainer?.Metadata || [];
  
  logger.info({ totalTracksFound: tracks.length }, "Plex tracks retrieved");
  
  const tracksToScan = tracks.slice(0, scanLimit);
  for (const track of tracksToScan) {
    summary.scanned += 1;
    try {
      const part = track.Media?.[0]?.Part?.[0];
      if (!part || !part.key) {
        continue;
      }
      
      const plexPartKey = part.key;
      const relativePath = `plex://${plexPartKey}`;
      const id = opaqueId(relativePath);
      
      let artPath: string | null = null;
      const thumb = track.thumb || track.parentThumb || track.grandparentThumb;
      if (thumb) {
        try {
          const artResponse = await fetch(`${cleanPlexUrl}${thumb}?X-Plex-Token=${plexToken}`);
          if (artResponse.ok) {
            const buffer = await artResponse.arrayBuffer();
            const ext = extensionForImage(artResponse.headers.get("content-type") || "image/jpeg");
            const fileName = `${id}.${ext}`;
            await writeFile(path.join(artDir, fileName), Buffer.from(buffer));
            artPath = path.posix.join("art", fileName);
            summary.withArt += 1;
          }
        } catch (err) {
          logger.warn({ track: track.title, error: (err as Error).message }, "failed to download Plex art");
        }
      }
      
      const parsedYear = track.year || (track.originallyAvailableAt ? Number(track.originallyAvailableAt.slice(0, 4)) : null);
      const durationS = track.duration ? Math.round(track.duration / 1000) : null;
      const primaryGenre = track.Genre?.[0]?.tag || section.title;

      const flags = computeSuspiciousFlags({
        album: track.parentTitle || null,
        title: track.title || null,
        artist: track.grandparentTitle || null,
        rawYear: parsedYear,
        durationS,
      });
      if (flags.length > 0) summary.flagged += 1;

      const row: SongUpsertRow = {
        id,
        file_path: relativePath,
        title: track.title || titleFromFileName(relativePath),
        artist: track.grandparentTitle || null,
        album: track.parentTitle || null,
        genre: primaryGenre,
        tag_genre: track.Genre?.[0]?.tag || null,
        raw_year: parsedYear,
        snippet_start_s: defaultSnippetStart(durationS),
        duration_s: durationS,
        art_path: artPath,
        suspicious_flags: JSON.stringify(flags),
        now: Date.now(),
      };
      upsert.run(row);

      if (row.genre !== null && row.genre.length > 0) ensureGenre.run(id, row.genre);
      
      if (track.Genre) {
        for (const g of track.Genre) {
          if (g.tag) ensureGenre.run(id, g.tag);
        }
      }

      if (existing.has(relativePath)) summary.updated += 1;
      else summary.inserted += 1;
    } catch (error) {
      summary.errors += 1;
      logger.warn({ track: track.title, error: (error as Error).message }, "failed to ingest Plex track");
    }
  }
}

export async function scanLibrary(db: DatabaseType.Database, options: ScanOptions): Promise<ScanSummary> {
  const musicDir = path.resolve(options.musicDir);
  await mkdir(artDir, { recursive: true });

  const existing = new Set(
    (db.prepare("SELECT file_path FROM songs").all() as Array<{ file_path: string }>).map((row) => row.file_path),
  );

  // Refresh tag-derived columns on conflict, but PRESERVE everything the curator
  // has touched (year, status, snippet_start_s, AND title/artist/album — those
  // are inline-editable in /library and must survive a re-scan). Tag-only
  // metadata (genre/raw_year/duration) and the suspicious-flag set are
  // recomputed; art is only set if the file gained embedded art.
  const upsert = db.prepare(`
    INSERT INTO songs (
      id, file_path, title, artist, album, genre, tag_genre,
      raw_year, year, snippet_start_s, snippet_len_s, duration_s,
      art_path, status, suspicious_flags, created_at, updated_at
    ) VALUES (
      @id, @file_path, @title, @artist, @album, @genre, @tag_genre,
      @raw_year, @raw_year, @snippet_start_s, NULL, @duration_s,
      @art_path, 'unreviewed', @suspicious_flags, @now, @now
    )
    ON CONFLICT(file_path) DO UPDATE SET
      genre = excluded.genre,
      tag_genre = excluded.tag_genre,
      raw_year = excluded.raw_year,
      duration_s = excluded.duration_s,
      art_path = COALESCE(excluded.art_path, songs.art_path),
      suspicious_flags = excluded.suspicious_flags,
      updated_at = excluded.updated_at
  `);

  // Seed the one-to-many genre set from folder + ID3 without removing curator additions.
  const ensureGenre = db.prepare("INSERT OR IGNORE INTO song_genres (song_id, genre) VALUES (?, ?)");

  const summary: ScanSummary = {
    musicDir,
    scanned: 0,
    inserted: 0,
    updated: 0,
    flagged: 0,
    withArt: 0,
    errors: 0,
  };

  const plexUrlEnv = process.env.SONGSTER_PLEX_URL?.trim() || "";
  const plexTokenEnv = process.env.SONGSTER_PLEX_TOKEN?.trim() || "";
  const plexLibraryNameEnv = process.env.SONGSTER_PLEX_LIBRARY_NAME?.trim() || "";
  const plexScanLimitEnv = process.env.SONGSTER_PLEX_SCAN_LIMIT?.trim() || "";

  const plexUrl = plexUrlEnv || getSetting(db, "plex_url", "");
  const plexToken = plexTokenEnv || getSetting(db, "plex_token", "");
  const plexLibraryName = plexLibraryNameEnv || getSetting(db, "plex_library_name", "Music");
  const plexScanLimit = plexScanLimitEnv ? Number(plexScanLimitEnv) : Number(getSetting(db, "plex_scan_limit", "100"));

  if (plexUrl.length > 0 && plexToken.length > 0) {
    try {
      await scanPlexLibrary(
        db,
        plexUrl,
        plexToken,
        plexLibraryName,
        plexScanLimit,
        summary,
        upsert,
        ensureGenre,
        existing
      );
    } catch (error) {
      logger.error({ error: (error as Error).message }, "Plex scan failed");
      summary.errors += 1;
    }
  } else {
    for await (const fullPath of walkAudioFiles(musicDir)) {
      summary.scanned += 1;
      const relativePath = path.relative(musicDir, fullPath);

    try {
      const meta = await extractMetadata(fullPath);
      const id = opaqueId(relativePath);

      let artPath: string | null = null;
      if (meta.picture !== null) {
        const fileName = `${id}.${extensionForImage(meta.picture.format)}`;
        await writeFile(path.join(artDir, fileName), meta.picture.data);
        artPath = path.posix.join("art", fileName);
        summary.withArt += 1;
      }

      const flags = computeSuspiciousFlags({
        album: meta.album,
        title: meta.title,
        artist: meta.artist,
        rawYear: meta.rawYear,
        durationS: meta.durationS,
      });
      if (flags.length > 0) summary.flagged += 1;

      const row: SongUpsertRow = {
        id,
        file_path: relativePath,
        title: meta.title ?? titleFromFileName(relativePath),
        artist: meta.artist,
        album: meta.album,
        genre: genreFromRelativePath(relativePath, meta.genreTag),
        tag_genre: meta.genreTag,
        raw_year: meta.rawYear,
        snippet_start_s: defaultSnippetStart(meta.durationS),
        duration_s: meta.durationS,
        art_path: artPath,
        suspicious_flags: JSON.stringify(flags),
        now: Date.now(),
      };
      upsert.run(row);

      if (row.genre !== null && row.genre.length > 0) ensureGenre.run(id, row.genre);
      if (meta.genreTag !== null && meta.genreTag !== row.genre) ensureGenre.run(id, meta.genreTag);

      if (existing.has(relativePath)) summary.updated += 1;
      else summary.inserted += 1;
    } catch (error) {
      summary.errors += 1;
      logger.warn({ file: relativePath, error: (error as Error).message }, "failed to ingest file");
    }
    }
  }

  flagArtistYearOutliers(db);

  return summary;
}

/** Second pass: within a single real artist (>= 4 dated songs), flag any track
 *  whose tag year sits more than 15 years from the artist's median. */
function flagArtistYearOutliers(db: DatabaseType.Database): void {
  const rows = db
    .prepare(
      "SELECT id, artist, raw_year, suspicious_flags FROM songs WHERE raw_year IS NOT NULL AND artist IS NOT NULL AND artist != ''",
    )
    .all() as Array<{ id: string; artist: string; raw_year: number; suspicious_flags: string }>;

  const byArtist = new Map<string, Array<{ id: string; year: number; flags: string }>>();
  for (const row of rows) {
    const key = row.artist.toLowerCase();
    if (key.includes("various")) continue;
    const list = byArtist.get(key) ?? [];
    list.push({ id: row.id, year: row.raw_year, flags: row.suspicious_flags });
    byArtist.set(key, list);
  }

  const update = db.prepare("UPDATE songs SET suspicious_flags = ?, updated_at = ? WHERE id = ?");
  const now = Date.now();

  for (const list of byArtist.values()) {
    if (list.length < 4) continue;
    const years = list.map((song) => song.year).sort((a, b) => a - b);
    const median = years[Math.floor(years.length / 2)] ?? years[0]!;

    for (const song of list) {
      if (Math.abs(song.year - median) <= 15) continue;
      const flags = new Set<string>(JSON.parse(song.flags) as string[]);
      if (!flags.has("artist-year-outlier")) {
        flags.add("artist-year-outlier");
        update.run(JSON.stringify([...flags]), now, song.id);
      }
    }
  }
}
