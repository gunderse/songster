import path from "node:path";

import type DatabaseType from "better-sqlite3";
import type { Express } from "express";

import { musicDir } from "./config.js";
import { getSongFileInfo } from "./library/songs-repo.js";

const dataDir = path.resolve(import.meta.dirname, "../data");

/** Guard against path traversal: the resolved target must stay inside root. */
function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Serve song audio and cover art keyed by OPAQUE song id (never the filename),
 * so titles can't leak before the reveal. `res.sendFile` provides HTTP range
 * support, which lets the hub seek to the snippet start.
 */
export function registerAudioRoutes(app: Express, db: DatabaseType.Database): void {
  const musicRoot = path.resolve(musicDir);

  app.get("/audio/:id/stream", (req, res) => {
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
