import path from "node:path";

import type DatabaseType from "better-sqlite3";
import type { Express } from "express";

import { musicDir } from "./config.js";
import { getSongFileInfo } from "./library/songs-repo.js";
import { getSetting } from "./library/settings-repo.js";
import { logger } from "./logger.js";

const dataDir = path.resolve(import.meta.dirname, "../data");

/** Guard against path traversal: the resolved target must stay inside root. */
function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Serve song audio and cover art keyed by OPAQUE song id (never the filename),
 * so titles can't leak before the reveal. Supports direct disk streaming or
 * proxying from a local LAN Plex server (with HTTP Range headers).
 */
export function registerAudioRoutes(app: Express, db: DatabaseType.Database): void {
  const musicRoot = path.resolve(musicDir);

  app.get("/audio/:id/stream", async (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.sendStatus(400);
      return;
    }
    const info = getSongFileInfo(db, id);
    if (info === null) {
      res.sendStatus(404);
      return;
    }

    // 1. Handle Plex streaming proxy
    if (info.filePath.startsWith("plex://")) {
      const plexUrlEnv = process.env.SONGSTER_PLEX_URL?.trim() || "";
      const plexTokenEnv = process.env.SONGSTER_PLEX_TOKEN?.trim() || "";
      
      const plexUrl = plexUrlEnv || getSetting(db, "plex_url", "");
      const plexToken = plexTokenEnv || getSetting(db, "plex_token", "");

      if (plexUrl.length === 0 || plexToken.length === 0) {
        logger.error({ id }, "Plex streaming requested but URL or Token is not configured");
        res.sendStatus(500);
        return;
      }

      const cleanPlexUrl = plexUrl.replace(/\/+$/, "");
      const key = info.filePath.slice(7); // remove "plex://"
      const targetUrl = `${cleanPlexUrl}${key}?X-Plex-Token=${plexToken}`;

      const headers: Record<string, string> = {
        "Accept": "*/*",
      };
      if (req.headers.range) {
        headers["Range"] = req.headers.range;
      }

      try {
        const streamResponse = await fetch(targetUrl, { headers });
        res.status(streamResponse.status);

        for (const [name, val] of streamResponse.headers.entries()) {
          const lower = name.toLowerCase();
          if (["content-type", "content-length", "content-range", "accept-ranges"].includes(lower)) {
            res.setHeader(name, val);
          }
        }

        if (streamResponse.body) {
          const { Readable } = await import("node:stream");
          Readable.fromWeb(streamResponse.body as any).pipe(res);
        } else {
          res.end();
        }
      } catch (error) {
        logger.error({ id, error: (error as Error).message }, "Failed to proxy Plex audio stream");
        if (!res.headersSent) {
          res.sendStatus(500);
        }
      }
      return;
    }

    // 2. Handle standard local file streaming
    const absolutePath = path.resolve(musicRoot, info.filePath);
    if (!isWithin(musicRoot, absolutePath)) {
      res.sendStatus(403);
      return;
    }
    res.sendFile(absolutePath, (error) => {
      if (error !== undefined && error !== null && !res.headersSent) {
        res.sendStatus(404);
      }
    });
  });

  app.get("/audio/:id/art", (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.sendStatus(400);
      return;
    }
    const info = getSongFileInfo(db, id);
    if (info === null || info.artPath === null) {
      res.sendStatus(404);
      return;
    }
    const absolutePath = path.resolve(dataDir, info.artPath);
    if (!isWithin(dataDir, absolutePath)) {
      res.sendStatus(403);
      return;
    }
    res.sendFile(absolutePath, (error) => {
      if (error !== undefined && error !== null && !res.headersSent) {
        res.sendStatus(404);
      }
    });
  });
}
