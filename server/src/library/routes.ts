import { Router } from "express";

import type DatabaseType from "better-sqlite3";

import { songListQuerySchema, songUpdateSchema } from "@songster/shared/library";

import { ollamaService } from "../ai/ollama-service.js";
import { suggestOriginalYear } from "../ai/year-suggester.js";
import { musicDir, ollamaModel } from "../config.js";
import { getErrorMessage } from "../error-details.js";
import { logger } from "../logger.js";
import { scanLibrary } from "./scan.js";
import { getFacets, getSong, getStats, listSongs, updateSong } from "./songs-repo.js";

export function createLibraryRouter(db: DatabaseType.Database): Router {
  const router = Router();

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
