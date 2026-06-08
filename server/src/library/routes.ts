import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import express, { Router } from "express";

import type DatabaseType from "better-sqlite3";

import { songListQuerySchema, songUpdateSchema } from "@songster/shared/library";

import { ollamaService } from "../ai/ollama-service.js";
import { suggestOriginalYear } from "../ai/year-suggester.js";
import { musicDir, ollamaModel } from "../config.js";
import { getErrorMessage } from "../error-details.js";
import { logger } from "../logger.js";
import { scanLibrary } from "./scan.js";
import { getFacets, getSong, getStats, listSongs, setSongArt, updateSong } from "./songs-repo.js";
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
    try {
      const summary = await scanLibrary(db, { musicDir });
      res.json({ summary });
    } catch (error) {
      logger.error({ error: getErrorMessage(error) }, "library scan failed");
      res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  return router;
}
