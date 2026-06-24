import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

import express, { Router } from "express";

import type DatabaseType from "better-sqlite3";

import { songListQuerySchema, songUpdateSchema } from "@songster/shared/library";

import { ollamaService } from "../ai/ollama-service.js";
import { suggestOriginalYear } from "../ai/year-suggester.js";
import { musicDir, ollamaModel } from "../config.js";
import { getErrorMessage } from "../error-details.js";
import { logger } from "../logger.js";
import { scanLibrary, opaqueId, defaultSnippetStart, extensionForImage, isValidImageSignature, parsePlexFilePath, titleFromFileName } from "./scan.js";
import { computeSuspiciousFlags } from "./suspicious.js";
import { getFacets, getSong, getStats, listSongs, setSongArt, updateSong, getSongFileInfo } from "./songs-repo.js";
import { getSetting, setSetting } from "./settings-repo.js";
import { getPlexPin, checkPlexPin } from "./plex-service.js";
import { randomUUID } from "node:crypto";

const artDir = path.resolve(import.meta.dirname, "../../data/art");
const ART_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function createLibraryRouter(db: DatabaseType.Database): Router {
  const router = Router();
  let cachedPlexTracks: any[] | null = null;
  let plexFetchPromise: Promise<any[]> | null = null;

  router.get("/settings/plex", (_req, res) => {
    const url = getSetting(db, "plex_url", "http://192.168.86.100:32400");
    const libraryName = getSetting(db, "plex_library_name", "Music");
    const token = getSetting(db, "plex_token", "");
    res.json({
      url,
      libraryName,
      hasToken: token.length > 0,
    });
  });

  router.post("/settings/plex", (req, res) => {
    const { url, libraryName } = req.body;
    if (typeof url !== "string" || typeof libraryName !== "string") {
      res.status(400).json({ error: "Missing url or libraryName" });
      return;
    }
    cachedPlexTracks = null;
    setSetting(db, "plex_url", url.trim());
    setSetting(db, "plex_library_name", libraryName.trim());
    res.json({ ok: true });
  });

  router.post("/settings/plex/test", async (req, res) => {
    const { url, libraryName } = req.body;
    if (typeof url !== "string" || typeof libraryName !== "string") {
      res.status(400).json({ error: "Missing url or libraryName" });
      return;
    }

    const token = getSetting(db, "plex_token", "");
    if (!token) {
      res.status(400).json({ error: "Plex is not connected. Please connect Plex first." });
      return;
    }

    const cleanPlexUrl = url.trim().replace(/\/+$/, "");

    try {
      logger.info({ url: `${cleanPlexUrl}/library/sections` }, "API Call to Plex: Testing connection (library sections)");
      const response = await fetch(`${cleanPlexUrl}/library/sections`, {
        headers: {
          "Accept": "application/json",
          "X-Plex-Token": token,
        },
      });

      if (!response.ok) {
        res.json({
          success: false,
          error: `Plex server returned status ${response.status} ${response.statusText}`
        });
        return;
      }

      const json = await response.json() as any;
      const dirs = json.MediaContainer?.Directory || [];
      const section = dirs.find(
        (dir: any) => dir.title.toLowerCase() === libraryName.toLowerCase()
      );

      if (!section) {
        const available = dirs.map((d: any) => d.title).join(", ");
        res.json({
          success: false,
          error: `Library section "${libraryName}" not found on server. Available sections: ${available || "none"}`
        });
        return;
      }

      // Found the library. Let's get the track count if possible
      logger.info({ url: `${cleanPlexUrl}/library/sections/${section.key}/all` }, "API Call to Plex: Testing connection (track count)");
      const tracksResponse = await fetch(`${cleanPlexUrl}/library/sections/${section.key}/all?type=10&X-Plex-Token=${token}`, {
        headers: {
          "Accept": "application/json",
        },
      });

      let trackCount = 0;
      if (tracksResponse.ok) {
        const tracksJson = await tracksResponse.json() as any;
        trackCount = tracksJson.MediaContainer?.Metadata?.length || 0;
      }

      res.json({
        success: true,
        message: `Successfully connected! Found library "${section.title}" with ${trackCount} tracks.`
      });

    } catch (err: any) {
      logger.error({ url: cleanPlexUrl, error: err.message }, "Plex connection test failed");
      let friendlyError = err.message;
      if (err.cause) {
        if (err.cause.code === "EHOSTUNREACH") {
          friendlyError = `Host is unreachable (EHOSTUNREACH). Make sure your Plex Media Server is powered on, connected to the same LAN (${url}), and not asleep.`;
        } else if (err.cause.code === "ECONNREFUSED") {
          friendlyError = `Connection refused (ECONNREFUSED). Verify Plex is running on port 32400 (or the port you specified) and isn't blocked by a firewall.`;
        } else if (err.cause.code === "ENOTFOUND") {
          friendlyError = `Host not found (ENOTFOUND). Please verify the server IP/domain name: ${url}`;
        } else {
          friendlyError = `${err.message} (${err.cause.code})`;
        }
      }
      res.json({
        success: false,
        error: friendlyError
      });
    }
  });

  router.post("/settings/plex/auth/pin", async (_req, res) => {
    let clientIdentifier = getSetting(db, "plex_client_identifier", "");
    if (clientIdentifier.length === 0) {
      clientIdentifier = randomUUID();
      setSetting(db, "plex_client_identifier", clientIdentifier);
    }
    try {
      const pinInfo = await getPlexPin(clientIdentifier);
      res.json(pinInfo);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get("/settings/plex/auth/check/:pinId", async (req, res) => {
    const pinId = req.params.pinId;
    const clientIdentifier = getSetting(db, "plex_client_identifier", "");
    if (!pinId || clientIdentifier.length === 0) {
      res.status(400).json({ error: "Invalid state" });
      return;
    }
    const token = await checkPlexPin(pinId, clientIdentifier);
    if (token) {
      setSetting(db, "plex_token", token);
      res.json({ ok: true, connected: true });
    } else {
      res.json({ ok: true, connected: false });
    }
  });

  router.get("/songs", (req, res) => {
    const parsed = songListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", issues: parsed.error.issues });
      return;
    }
    res.json({ songs: listSongs(db, parsed.data) });
  });

  router.get("/stats", (_req, res) => {
    res.json(getStats(db));
  });

  router.get("/facets", (_req, res) => {
    res.json(getFacets(db));
  });

  router.patch("/songs/:id", (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.sendStatus(400);
      return;
    }
    const parsed = songUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid update", issues: parsed.error.issues });
      return;
    }
    const updated = updateSong(db, id, parsed.data);
    if (updated === null) {
      res.sendStatus(404);
      return;
    }
    res.json({ song: updated });
  });

  router.post(
    "/songs/:id/art",
    express.raw({ type: (req) => (req.headers["content-type"] ?? "").startsWith("image/"), limit: "10mb" }),
    async (req, res) => {
      const id = req.params.id;
      if (typeof id !== "string") {
        res.sendStatus(400);
        return;
      }
      if (getSong(db, id) === null) {
        res.sendStatus(404);
        return;
      }
      const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
      const ext = ART_EXT[contentType];
      const body: unknown = req.body;
      if (ext === undefined || !Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: "Expected a PNG / JPEG / WebP / GIF image body." });
        return;
      }
      try {
        await mkdir(artDir, { recursive: true });
        const fileName = `${id}.${ext}`;
        await writeFile(path.join(artDir, fileName), body);
        const updated = setSongArt(db, id, path.posix.join("art", fileName));
        res.json({ song: updated });
      } catch (error) {
        logger.error({ id, error: getErrorMessage(error) }, "art upload failed");
        res.status(500).json({ error: getErrorMessage(error) });
      }
    },
  );

  router.post("/songs/:id/suggest-year", async (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.sendStatus(400);
      return;
    }
    const song = getSong(db, id);
    if (song === null) {
      res.sendStatus(404);
      return;
    }
    try {
      const suggestion = await suggestOriginalYear({
        title: song.title,
        artist: song.artist,
        album: song.album,
      });
      res.json({ suggestion });
    } catch (error) {
      logger.warn({ id, error: getErrorMessage(error) }, "year suggestion failed");
      res.status(502).json({ error: getErrorMessage(error) });
    }
  });

  router.get("/ai-status", async (_req, res) => {
    try {
      const models = await ollamaService.listModels();
      res.json({ ok: true, model: ollamaModel, modelAvailable: models.includes(ollamaModel), models });
    } catch (error) {
      res.json({ ok: false, model: ollamaModel, error: getErrorMessage(error) });
    }
  });

  router.post("/scan", async (_req, res) => {
    cachedPlexTracks = null;
    try {
      const summary = await scanLibrary(db, { musicDir });
      res.json({ summary });
    } catch (error) {
      logger.error({ error: getErrorMessage(error) }, "library scan failed");
      res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  router.get("/plex/search", async (req, res) => {
    const searchQuery = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const searchTitle = typeof req.query.searchTitle === "string" ? req.query.searchTitle.trim() : "";
    const searchArtist = typeof req.query.searchArtist === "string" ? req.query.searchArtist.trim() : "";
    const searchAlbum = typeof req.query.searchAlbum === "string" ? req.query.searchAlbum.trim() : "";
    const yearStart = req.query.yearStart ? Number(req.query.yearStart) : undefined;
    const yearEnd = req.query.yearEnd ? Number(req.query.yearEnd) : undefined;
    const missingYear = req.query.missingYear === "true";

    const sortField = typeof req.query.sort === "string" ? req.query.sort.trim() : "title";
    const start = Number(req.query.start) || 0;
    const size = Number(req.query.size) || 50;

    const url = getSetting(db, "plex_url", "http://192.168.86.100:32400");
    const token = getSetting(db, "plex_token", "");
    const libraryName = getSetting(db, "plex_library_name", "Music");

    if (!url || !token) {
      res.status(400).json({ error: "Plex is not configured" });
      return;
    }

    const cleanPlexUrl = url.trim().replace(/\/+$/, "");

    try {
      if (!cachedPlexTracks) {
        if (!plexFetchPromise) {
          plexFetchPromise = (async () => {
            logger.info({ url: `${cleanPlexUrl}/library/sections` }, "API Call to Plex: Fetching library sections for search cache");
            const sectionsResponse = await fetch(`${cleanPlexUrl}/library/sections?X-Plex-Token=${token}`, {
              headers: { "Accept": "application/json" }
            });
            if (!sectionsResponse.ok) {
              throw new Error(`Failed to fetch library sections: ${sectionsResponse.status}`);
            }
            const sectionsData = await sectionsResponse.json() as any;
            const section = (sectionsData.MediaContainer?.Directory || []).find(
              (dir: any) => dir.title.toLowerCase() === libraryName.toLowerCase()
            );
            if (!section) {
              throw new Error(`Library section "${libraryName}" not found`);
            }
            const sectionId = section.key;

            const plexUrlString = `${cleanPlexUrl}/library/sections/${sectionId}/all?type=10&X-Plex-Token=${token}`;
            logger.info({ url: plexUrlString }, "API Call to Plex: Fetching all tracks for search cache");
            const tracksResponse = await fetch(plexUrlString, {
              headers: { "Accept": "application/json" }
            });

            if (!tracksResponse.ok) {
              throw new Error(`Plex tracks request failed: status ${tracksResponse.status}`);
            }

            const tracksData = await tracksResponse.json() as any;
            const tracks = tracksData.MediaContainer?.Metadata || [];
            logger.info(`Fetched ${tracks.length} tracks. Mapping metadata...`);

            const mapped = tracks.map((track: any) => {
              const part = track.Media?.[0]?.Part?.[0];
              const partFile = part?.file || "";
              const plexPartKey = part?.key || "";
              const pathMeta = parsePlexFilePath(partFile);

              let finalTitle = track.title || "";
              if (finalTitle.length === 0 || finalTitle.toLowerCase() === "file") {
                finalTitle = pathMeta.title || (plexPartKey ? titleFromFileName(`plex://${plexPartKey}`) : "Unknown Track");
              }

              const finalArtist = track.grandparentTitle || pathMeta.artist || null;
              const finalAlbum = track.parentTitle || pathMeta.album || null;
              const finalYear = track.year || 
                                track.parentYear || 
                                (track.originallyAvailableAt ? Number(track.originallyAvailableAt.slice(0, 4)) : null) || 
                                pathMeta.year || 
                                null;

              const durationS = track.duration ? Math.round(track.duration / 1000) : null;

              return {
                ratingKey: track.ratingKey,
                key: plexPartKey,
                title: finalTitle,
                artist: finalArtist,
                album: finalAlbum,
                year: finalYear,
                durationS,
                thumb: track.thumb || track.parentThumb || track.grandparentThumb || null,
                addedAt: track.addedAt || 0,
              };
            });

            logger.info(`Plex cache populated with ${mapped.length} tracks.`);
            return mapped;
          })();
        }

        try {
          cachedPlexTracks = await plexFetchPromise;
        } catch (err) {
          plexFetchPromise = null;
          throw err;
        } finally {
          plexFetchPromise = null;
        }
      }

      // Map dynamic isImported status using local DB
      const importedMap = new Map<string, { id: string; status: string }>();
      const dbSongs = db.prepare("SELECT id, file_path, status FROM songs").all() as Array<{ id: string; file_path: string; status: string }>;
      for (const row of dbSongs) {
        importedMap.set(row.file_path, { id: row.id, status: row.status });
      }

      let results = cachedPlexTracks.map((t: any) => {
        const relativePath = `plex://${t.key}`;
        const imported = importedMap.get(relativePath);
        return {
          ...t,
          isImported: !!imported,
          songId: imported?.id || null,
          status: imported?.status || null,
        };
      });

      // Filter in-memory
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        results = results.filter(
          (t) =>
            (t.title && t.title.toLowerCase().includes(q)) ||
            (t.artist && t.artist.toLowerCase().includes(q)) ||
            (t.album && t.album.toLowerCase().includes(q))
        );
      }
      if (searchTitle) {
        results = results.filter((t: any) => t.title && t.title.toLowerCase().includes(searchTitle.toLowerCase()));
      }
      if (searchArtist) {
        results = results.filter((t: any) => t.artist && t.artist.toLowerCase().includes(searchArtist.toLowerCase()));
      }
      if (searchAlbum) {
        results = results.filter((t: any) => t.album && t.album.toLowerCase().includes(searchAlbum.toLowerCase()));
      }
      if (yearStart !== undefined && !isNaN(yearStart)) {
        results = results.filter((t: any) => t.year !== null && t.year >= yearStart);
      }
      if (yearEnd !== undefined && !isNaN(yearEnd)) {
        results = results.filter((t: any) => t.year !== null && t.year <= yearEnd);
      }
      if (missingYear) {
        results = results.filter((t: any) => t.year === null);
      }

      // Sort in-memory
      if (sortField === "titleSort") {
        results.sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }));
      } else if (sortField.includes("artist")) {
        results.sort((a, b) => {
          const artCompare = (a.artist || "").localeCompare(b.artist || "", undefined, { sensitivity: "base" });
          if (artCompare !== 0) return artCompare;
          const albCompare = (a.album || "").localeCompare(b.album || "", undefined, { sensitivity: "base" });
          if (albCompare !== 0) return albCompare;
          return (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
        });
      } else if (sortField.includes("album")) {
        results.sort((a, b) => {
          const albCompare = (a.album || "").localeCompare(b.album || "", undefined, { sensitivity: "base" });
          if (albCompare !== 0) return albCompare;
          return (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });
        });
      } else if (sortField === "year:desc") {
        results.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
      } else if (sortField === "year") {
        results.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
      } else if (sortField === "addedAt:desc") {
        results.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
      }

      const totalSize = results.length;
      const paginatedResults = results.slice(start, start + size);

      res.json({
        totalSize,
        results: paginatedResults
      });

    } catch (err: any) {
      logger.error({ search: searchQuery, error: err.message }, "Plex search endpoint failed");
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/plex/preview", async (req, res) => {
    const key = req.query.key;
    if (typeof key !== "string" || !key.startsWith("/library/parts/")) {
      res.status(400).json({ error: "Invalid or missing part key" });
      return;
    }

    const url = getSetting(db, "plex_url", "http://192.168.86.100:32400");
    const token = getSetting(db, "plex_token", "");

    if (!url || !token) {
      res.status(400).json({ error: "Plex is not configured" });
      return;
    }

    const cleanPlexUrl = url.trim().replace(/\/+$/, "");
    const targetUrl = `${cleanPlexUrl}${key}?X-Plex-Token=${token}`;

    const headers: Record<string, string> = {
      "Accept": "*/*",
    };
    if (req.headers.range) {
      headers["Range"] = req.headers.range;
    }

    logger.info({ url: targetUrl }, "API Call to Plex: Previewing audio");

    const controller = new AbortController();
    req.on("close", () => {
      controller.abort();
    });

    try {
      const streamResponse = await fetch(targetUrl, { headers, signal: controller.signal });
      res.status(streamResponse.status);

      for (const [name, val] of streamResponse.headers.entries()) {
        const lower = name.toLowerCase();
        if (["content-type", "content-length", "content-range", "accept-ranges"].includes(lower)) {
          res.setHeader(name, val);
        }
      }

      if (streamResponse.body) {
        const { Readable } = await import("node:stream");
        const readable = Readable.fromWeb(streamResponse.body as any);
        readable.on("error", (err: any) => {
          if (err.name === "AbortError" || err.code === "ERR_STREAM_PREMATURE_CLOSE") {
            return;
          }
          logger.warn({ key, error: err.message }, "Plex preview readable stream error");
        });
        readable.pipe(res);
      } else {
        res.end();
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        logger.info({ key }, "Plex preview streaming aborted by client close");
        return;
      }
      logger.error({ key, error: (error as Error).message }, "Failed to stream Plex preview audio");
      if (!res.headersSent) {
        res.sendStatus(500);
      }
    }
  });

  router.post("/plex/import", async (req, res) => {
    const { ratingKey, status } = req.body;
    if (typeof ratingKey !== "string") {
      res.status(400).json({ error: "Missing ratingKey" });
      return;
    }

    const targetStatus = status === "approved" || status === "unreviewed" || status === "excluded" ? status : "approved";

    try {
      const url = getSetting(db, "plex_url", "http://192.168.86.100:32400");
      const token = getSetting(db, "plex_token", "");
      if (!url || !token) {
        res.status(400).json({ error: "Plex is not configured" });
        return;
      }

      const cleanPlexUrl = url.trim().replace(/\/+$/, "");

      logger.info({ url: `${cleanPlexUrl}/library/metadata/${ratingKey}` }, "API Call to Plex: Fetching track metadata for import");
      const metadataResponse = await fetch(`${cleanPlexUrl}/library/metadata/${ratingKey}?X-Plex-Token=${token}`, {
        headers: { "Accept": "application/json" }
      });
      if (!metadataResponse.ok) {
        throw new Error(`Failed to fetch metadata from Plex: status ${metadataResponse.status}`);
      }

      const metadataData = await metadataResponse.json() as any;
      const track = metadataData.MediaContainer?.Metadata?.[0];
      if (!track) {
        throw new Error("Track metadata not found in Plex response");
      }

      const part = track.Media?.[0]?.Part?.[0];
      if (!part || !part.key) {
        throw new Error("Track has no playable media part");
      }

      const plexPartKey = part.key;
      const relativePath = `plex://${plexPartKey}`;
      const id = opaqueId(relativePath);

      const partFile = part.file || "";
      const pathMeta = parsePlexFilePath(partFile);

      let finalTitle = typeof req.body.title === "string" ? req.body.title : (track.title || "");
      if (finalTitle.length === 0 || finalTitle.toLowerCase() === "file") {
        finalTitle = pathMeta.title || titleFromFileName(relativePath);
      }

      const finalArtist = typeof req.body.artist === "string" ? req.body.artist : (track.grandparentTitle || pathMeta.artist || null);
      const finalAlbum = typeof req.body.album === "string" ? req.body.album : (track.parentTitle || pathMeta.album || null);
      
      let parsedYear: number | null = null;
      if (req.body.year !== undefined) {
        parsedYear = typeof req.body.year === "number" ? req.body.year : null;
      } else {
        parsedYear = track.year || 
                     track.parentYear || 
                     (track.originallyAvailableAt ? Number(track.originallyAvailableAt.slice(0, 4)) : null) || 
                     pathMeta.year || 
                     null;
      }

      const durationS = track.duration ? Math.round(track.duration / 1000) : null;
      
      let artPath: string | null = null;

      // Try custom web artUrl if provided
      const customArtUrl = req.body.artUrl;
      if (typeof customArtUrl === "string" && customArtUrl.length > 0) {
        try {
          logger.info({ url: customArtUrl }, "API Call to iTunes/Web: Downloading custom art during import");
          const artResponse = await fetch(customArtUrl);
          if (artResponse.ok) {
            const buffer = await artResponse.arrayBuffer();
            const nodeBuffer = Buffer.from(buffer);
            if (isValidImageSignature(nodeBuffer)) {
              const ext = extensionForImage(artResponse.headers.get("content-type") || "image/jpeg");
              const fileName = `${id}.${ext}`;
              await mkdir(artDir, { recursive: true });
              await writeFile(path.join(artDir, fileName), nodeBuffer);
              artPath = path.posix.join("art", fileName);
            }
          }
        } catch (err) {
          logger.warn({ ratingKey, customArtUrl, error: (err as Error).message }, "failed to download custom web art during import");
        }
      }

      // Fallback to Plex thumbnail if custom web art didn't load or wasn't provided
      if (!artPath) {
        const thumb = track.thumb || track.parentThumb || track.grandparentThumb;
        if (thumb) {
          try {
            logger.info({ url: `${cleanPlexUrl}${thumb}` }, "API Call to Plex: Downloading track art during import");
            const artResponse = await fetch(`${cleanPlexUrl}${thumb}?X-Plex-Token=${token}`);
            if (artResponse.ok) {
              const buffer = await artResponse.arrayBuffer();
              const nodeBuffer = Buffer.from(buffer);
              if (isValidImageSignature(nodeBuffer)) {
                const ext = extensionForImage(artResponse.headers.get("content-type") || "image/jpeg");
                const fileName = `${id}.${ext}`;
                await mkdir(artDir, { recursive: true });
                await writeFile(path.join(artDir, fileName), nodeBuffer);
                artPath = path.posix.join("art", fileName);
              }
            }
          } catch (err) {
            logger.warn({ ratingKey, error: (err as Error).message }, "failed to download Plex art during import");
          }
        }
      }

      const flags = computeSuspiciousFlags({
        album: finalAlbum,
        title: finalTitle,
        artist: finalArtist,
        rawYear: parsedYear,
        durationS,
      });

      const now = Date.now();
      
      db.prepare(`
        INSERT INTO songs (
          id, file_path, title, artist, album, genre, tag_genre,
          raw_year, year, snippet_start_s, snippet_len_s, duration_s,
          art_path, status, suspicious_flags, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )
        ON CONFLICT(file_path) DO UPDATE SET
          title = excluded.title,
          artist = excluded.artist,
          album = excluded.album,
          raw_year = excluded.raw_year,
          year = COALESCE(songs.year, excluded.year),
          duration_s = excluded.duration_s,
          art_path = COALESCE(excluded.art_path, songs.art_path),
          status = excluded.status,
          suspicious_flags = excluded.suspicious_flags,
          updated_at = excluded.updated_at
      `).run(
        id, relativePath, finalTitle, finalArtist, finalAlbum, track.Genre?.[0]?.tag || "Music", track.Genre?.[0]?.tag || null,
        parsedYear, parsedYear, defaultSnippetStart(durationS), null, durationS,
        artPath, targetStatus, JSON.stringify(flags), now, now
      );

      const ensureGenre = db.prepare("INSERT OR IGNORE INTO song_genres (song_id, genre) VALUES (?, ?)");
      if (track.Genre) {
        for (const g of track.Genre) {
          if (g.tag) ensureGenre.run(id, g.tag);
        }
      }

      // Apply overrides (such as tags/genres) using updateSong
      const overrides: any = {};
      if (req.body.title !== undefined) overrides.title = req.body.title;
      if (req.body.artist !== undefined) overrides.artist = req.body.artist;
      if (req.body.album !== undefined) overrides.album = req.body.album;
      if (req.body.year !== undefined) overrides.year = req.body.year;
      if (req.body.genres !== undefined) overrides.genres = req.body.genres;
      if (req.body.tags !== undefined) overrides.tags = req.body.tags;
      if (req.body.status !== undefined) overrides.status = req.body.status;
      if (req.body.snippetStartS !== undefined) overrides.snippetStartS = req.body.snippetStartS;

      if (Object.keys(overrides).length > 0) {
        updateSong(db, id, overrides);
      }

      res.json({ success: true, songId: id, title: finalTitle, artist: finalArtist });
    } catch (err: any) {
      logger.error({ ratingKey, error: err.message }, "Plex import failed");
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/plex/art", async (req, res) => {
    const thumb = req.query.thumb;
    if (typeof thumb !== "string") {
      res.status(400).json({ error: "Missing thumb parameter" });
      return;
    }
    const url = getSetting(db, "plex_url", "http://192.168.86.100:32400");
    const token = getSetting(db, "plex_token", "");
    if (!url || !token) {
      res.status(400).json({ error: "Plex is not configured" });
      return;
    }
    const cleanPlexUrl = url.trim().replace(/\/+$/, "");
    const targetUrl = `${cleanPlexUrl}${thumb}?X-Plex-Token=${token}`;

    logger.info({ url: targetUrl }, "API Call to Plex: Proxying cover art");

    const controller = new AbortController();
    req.on("close", () => {
      controller.abort();
    });

    try {
      const artResponse = await fetch(targetUrl, { signal: controller.signal });
      if (!artResponse.ok) {
        res.sendStatus(artResponse.status);
        return;
      }
      
      const contentType = artResponse.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      
      const buffer = await artResponse.arrayBuffer();
      const nodeBuffer = Buffer.from(buffer);
      if (isValidImageSignature(nodeBuffer)) {
        res.send(nodeBuffer);
      } else {
        res.status(404).end();
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        return;
      }
      logger.error({ thumb, error: (error as Error).message }, "Failed to proxy Plex art");
      if (!res.headersSent) {
        res.sendStatus(500);
      }
    }
  });

  router.delete("/songs/:id", async (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.sendStatus(400);
      return;
    }
    const info = getSongFileInfo(db, id);
    if (!info) {
      res.status(404).json({ error: "Song not found" });
      return;
    }
    
    try {
      db.prepare("DELETE FROM songs WHERE id = ?").run(id);
      
      if (info.artPath) {
        const fullArtPath = path.resolve(artDir, "..", info.artPath);
        await unlink(fullArtPath).catch(() => {});
      }
      res.json({ success: true, id });
    } catch (err) {
      logger.error({ id, error: (err as Error).message }, "Failed to delete song");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  async function lookupWebMetadata(title: string, artist: string): Promise<any[]> {
    const term = `${artist} ${title}`.trim();
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=5`;
    logger.info({ url }, "API Call to iTunes Search API: lookupWebMetadata");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`iTunes search failed: status ${response.status}`);
    }
    const json = await response.json() as any;
    const results = json.results || [];
    return results.map((item: any) => {
      let year: number | null = null;
      if (item.releaseDate) {
        const y = Number(item.releaseDate.slice(0, 4));
        if (!isNaN(y)) year = y;
      }
      const artUrl = item.artworkUrl100 ? item.artworkUrl100.replace("100x100bb.jpg", "600x600bb.jpg") : null;
      return {
        title: item.trackName || null,
        artist: item.artistName || null,
        album: item.collectionName || null,
        year,
        artUrl,
        genre: item.primaryGenreName || null,
        genres: Array.isArray(item.genres) ? item.genres : (item.primaryGenreName ? [item.primaryGenreName] : []),
      };
    });
  }

  router.get("/lookup-web", async (req, res) => {
    const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
    const artist = typeof req.query.artist === "string" ? req.query.artist.trim() : "";

    if (title.length === 0 && artist.length === 0) {
      res.json({ results: [] });
      return;
    }
    try {
      const results = await lookupWebMetadata(title, artist);
      res.json({ results });
    } catch (error) {
      logger.warn({ error: getErrorMessage(error) }, "generic web lookup failed");
      res.status(502).json({ error: getErrorMessage(error) });
    }
  });

  router.get("/songs/:id/lookup-web", async (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.sendStatus(400);
      return;
    }
    const song = getSong(db, id);
    if (song === null) {
      res.sendStatus(404);
      return;
    }
    const title = typeof req.query.title === "string" ? req.query.title.trim() : (song.title || "");
    const artist = typeof req.query.artist === "string" ? req.query.artist.trim() : (song.artist || "");

    if (title.length === 0 && artist.length === 0) {
      res.json({ results: [] });
      return;
    }
    try {
      const results = await lookupWebMetadata(title, artist);
      res.json({ results });
    } catch (error) {
      logger.warn({ id, error: getErrorMessage(error) }, "web lookup failed");
      res.status(502).json({ error: getErrorMessage(error) });
    }
  });

  router.post("/songs/:id/import-web-art", async (req, res) => {
    const id = req.params.id;
    const { artUrl } = req.body;
    if (typeof id !== "string" || typeof artUrl !== "string") {
      res.sendStatus(400);
      return;
    }
    const song = getSong(db, id);
    if (song === null) {
      res.sendStatus(404);
      return;
    }
    try {
      logger.info({ url: artUrl }, "API Call to iTunes/Web: Importing art");
      const artResponse = await fetch(artUrl);
      if (!artResponse.ok) {
        throw new Error(`Failed to fetch image from web: status ${artResponse.status}`);
      }
      const buffer = await artResponse.arrayBuffer();
      const nodeBuffer = Buffer.from(buffer);
      if (!isValidImageSignature(nodeBuffer)) {
        throw new Error("Invalid image format or signature");
      }
      const contentType = artResponse.headers.get("content-type") || "image/jpeg";
      const ext = extensionForImage(contentType);
      const fileName = `${id}.${ext}`;

      await mkdir(artDir, { recursive: true });
      await writeFile(path.join(artDir, fileName), nodeBuffer);
      const updated = setSongArt(db, id, path.posix.join("art", fileName));
      res.json({ song: updated });
    } catch (error) {
      logger.error({ id, artUrl, error: getErrorMessage(error) }, "web art import failed");
      res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  return router;
}
