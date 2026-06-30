import { Router } from "express";

import { ollamaModel, ollamaUrl, voiceApiUrl } from "./config.js";
import { getErrorMessage } from "./error-details.js";
import { logger } from "./logger.js";
import { ollamaService } from "./ai/ollama-service.js";
import { voiceGeneratorService } from "./ai/voice-generator-service.js";
import { emceeService } from "./ai/emcee-service.js";
import { showcaseService } from "./ai/showcase-service.js";
import type { RoomManager } from "./room-service.js";
import { openDatabase } from "./db.js";

const BENCHMARK_SAMPLE_SONG = {
  title: "Don't Stop Believin'",
  artist: "Journey",
  year: 1981,
};

export function createAdminRouter(manager: RoomManager): Router {
  const router = Router();

  /**
   * GET /api/admin/rooms
   * Lists all active rooms.
   */
  router.get("/rooms", (_req, res) => {
    const rooms = manager.listRooms().map((room) => ({
      code: room.code,
      status: room.status,
      playerCount: room.players.size,
      teamCount: room.teams.length,
      createdAt: room.createdAt || Date.now(),
    }));
    res.json({ rooms });
  });

  /**
   * GET /api/admin/voices
   * Lists all available narrator/character voices.
   */
  router.get("/voices", async (_req, res) => {
    try {
      const characters = await voiceGeneratorService.listCharacters();
      const voices = characters.map((c) => ({
        name: c.name,
        tags: c.tags,
      }));
      res.json({ ok: true, voices });
    } catch (err) {
      logger.warn({ error: getErrorMessage(err) }, "failed to list voice characters");
      res.json({ ok: true, voices: [] });
    }
  });

  /**
   * POST /api/admin/rooms/destroy
   * Destroys a single room.
   */
  router.post("/rooms/destroy", (req, res) => {
    const { code } = req.body as { code?: string };
    if (!code) {
      res.status(400).json({ ok: false, error: "Missing room code" });
      return;
    }
    const success = manager.destroyRoom(code);
    res.json({ ok: success });
  });

  /**
   * POST /api/admin/rooms/destroy-all
   * Destroys all rooms.
   */
  router.post("/rooms/destroy-all", (_req, res) => {
    manager.destroyAllRooms();
    res.json({ ok: true });
  });

  /**
   * GET /api/admin/health
   * Returns the health status and model list for Ollama and Voice API.
   */
  router.get("/health", async (_req, res) => {
    const [ollamaResult, voiceResult] = await Promise.allSettled([
      ollamaService.listModels(),
      voiceGeneratorService.listCharacters(),
    ]);

    const ollama =
      ollamaResult.status === "fulfilled"
        ? { ok: true, models: ollamaResult.value, url: ollamaUrl }
        : { ok: false, error: getErrorMessage(ollamaResult.reason), models: [], url: ollamaUrl };

    const voice =
      voiceResult.status === "fulfilled"
        ? { ok: true, characters: voiceResult.value.length, url: voiceApiUrl }
        : { ok: false, error: getErrorMessage(voiceResult.reason), characters: 0, url: voiceApiUrl };

    res.json({ ollama, voice, defaultModel: ollamaModel });
  });

  /**
   * POST /api/admin/benchmark
   * Runs a smoke test simulating a player turn end-to-end.
   * Body: { model?: string; think?: boolean }
   */
  router.post("/benchmark", async (req, res) => {
    const model = (req.body as { model?: string }).model ?? ollamaModel;
    const think = (req.body as { think?: boolean }).think !== false; // default true for benchmark
    const results: Record<string, unknown> = { model, think };

    try {
      // ── 1. Ollama health ──────────────────────────────────────────────
      const t0 = Date.now();
      let ollamaModels: string[] = [];
      try {
        ollamaModels = await ollamaService.listModels();
        results["ollamaHealth"] = { ok: true, models: ollamaModels, latencyMs: Date.now() - t0 };
      } catch (err) {
        results["ollamaHealth"] = { ok: false, error: getErrorMessage(err), latencyMs: Date.now() - t0 };
        res.json({ ok: false, results, error: "Ollama is not reachable" });
        return;
      }

      // ── 2. Voice API health ───────────────────────────────────────────
      const t1 = Date.now();
      let characterCount = 0;
      let hostName: string | null = null;
      try {
        const chars = await voiceGeneratorService.listCharacters();
        characterCount = chars.length;
        // Pick a host-like character for the voice test
        hostName = await emceeService.chooseHost();
        results["voiceHealth"] = { ok: true, characters: characterCount, latencyMs: Date.now() - t1 };
      } catch (err) {
        results["voiceHealth"] = { ok: false, error: getErrorMessage(err), latencyMs: Date.now() - t1 };
        res.json({ ok: false, results, error: "Voice API is not reachable" });
        return;
      }

      if (hostName === null) {
        results["voiceHealth"] = { ...(results["voiceHealth"] as object), warning: "No suitable host character found" };
        hostName = "narrator";
      }

      // ── 3. Ollama narration (win path, sample song) ───────────────────
      const t2 = Date.now();
      let winText = "";
      const winPrompt = [
        `You are ${hostName}, a charismatic host on a live music game show with rival teams.`,
        `Open by reacting to the result: Alex of team Blue placed it CORRECTLY — celebrate the right call.`,
        `Then reveal "${BENCHMARK_SAMPLE_SONG.title}" by ${BENCHMARK_SAMPLE_SONG.artist} came out in ${BENCHMARK_SAMPLE_SONG.year}, with ONE quick fun-fact.`,
        "Keep it TIGHT and punchy: 2 short sentences, UNDER 28 words total. Output ONLY the spoken line — no quotes, markdown, or stage directions.",
      ].join("\n");
      try {
        const raw = await ollamaService.generate({ model, prompt: winPrompt, timeoutMs: 30_000, think });
        winText = raw.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/gu, " ").trim() || "Correct, Blue! Don't Stop Believin' by Journey — released in 1981.";
        results["ollamaWinNarration"] = { ok: true, text: winText, latencyMs: Date.now() - t2 };
      } catch (err) {
        winText = `Correct, Blue! ${BENCHMARK_SAMPLE_SONG.title} by ${BENCHMARK_SAMPLE_SONG.artist} — released in ${BENCHMARK_SAMPLE_SONG.year}.`;
        results["ollamaWinNarration"] = { ok: false, error: getErrorMessage(err), fallbackText: winText, latencyMs: Date.now() - t2 };
      }

      // ── 4. Ollama narration (lose path, concurrent) ───────────────────
      const t3 = Date.now();
      const losePrompt = [
        `You are ${hostName}, a charismatic host on a live music game show with rival teams.`,
        `Open by reacting to the result: Alex of team Blue placed it WRONG — playfully rib them for the miss.`,
        `Then reveal "${BENCHMARK_SAMPLE_SONG.title}" by ${BENCHMARK_SAMPLE_SONG.artist} came out in ${BENCHMARK_SAMPLE_SONG.year}, with ONE quick fun-fact.`,
        "Keep it TIGHT and punchy: 2 short sentences, UNDER 28 words total. Output ONLY the spoken line — no quotes, markdown, or stage directions.",
      ].join("\n");
      try {
        const raw = await ollamaService.generate({ model, prompt: losePrompt, timeoutMs: 30_000, think });
        const loseText = raw.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/gu, " ").trim();
        results["ollamaLoseNarration"] = { ok: true, text: loseText, latencyMs: Date.now() - t3 };
      } catch (err) {
        results["ollamaLoseNarration"] = { ok: false, error: getErrorMessage(err), latencyMs: Date.now() - t3 };
      }

      // ── 5. Voice generation (win narration line) ──────────────────────
      const t4 = Date.now();
      try {
        const clip = await voiceGeneratorService.generateClip(
          hostName,
          winText,
          `benchmark-${BENCHMARK_SAMPLE_SONG.year}-win`,
        );
        results["voiceGeneration"] = {
          ok: true,
          audioUrl: clip.audioUrl,
          durationMs: clip.durationMs,
          latencyMs: Date.now() - t4,
        };
      } catch (err) {
        results["voiceGeneration"] = { ok: false, error: getErrorMessage(err), latencyMs: Date.now() - t4 };
      }

      results["totalE2eMs"] = Date.now() - t0;
      logger.info({ model, think, totalMs: results["totalE2eMs"] }, "admin benchmark complete");
      res.json({ ok: true, results });
    } catch (err) {
      logger.error({ error: getErrorMessage(err) }, "admin benchmark failed");
      res.status(500).json({ ok: false, error: getErrorMessage(err), results });
    }
  });

  /**
   * POST /api/admin/showcase-smoketest
   * Runs a smoke test generating an expanded finale showcase for a fictional game.
   * Body: { model?: string; think?: boolean }
   */
  router.post("/showcase-smoketest", async (req, res) => {
    const model = (req.body as { model?: string }).model ?? ollamaModel;
    const think = (req.body as { think?: boolean }).think !== false;
    const t0 = Date.now();

    let realSongs: Array<{ songId: string; title: string | null; artist: string | null; year: number; snippetStartS: number; snippetLenS: number | null }> = [];
    try {
      const db = openDatabase();
      const rows = db.prepare("SELECT id, title, artist, year, snippet_start_s, snippet_len_s FROM songs LIMIT 4").all() as any[];
      realSongs = rows.map((r) => ({
        songId: r.id,
        title: r.title,
        artist: r.artist,
        year: r.year,
        snippetStartS: r.snippet_start_s || 30,
        snippetLenS: r.snippet_len_s || null,
      }));
    } catch (err) {
      logger.warn({ error: getErrorMessage(err) }, "could not load real songs for showcase smoketest");
    }

    const defaultFictional = [
      { title: "Billie Jean", artist: "Michael Jackson", year: 1982, songId: "billie-jean-id", snippetStartS: 30, snippetLenS: null },
      { title: "Smells Like Teen Spirit", artist: "Nirvana", year: 1991, songId: "teen-spirit-id", snippetStartS: 30, snippetLenS: null },
      { title: "Hey Jude", artist: "Beatles", year: 1968, songId: "hey-jude-id", snippetStartS: 30, snippetLenS: null },
      { title: "Stayin' Alive", artist: "Bee Gees", year: 1977, songId: "stayin-alive-id", snippetStartS: 30, snippetLenS: null },
    ];

    const testSongs = realSongs.length >= 4 ? realSongs : defaultFictional;
    const finalSong = testSongs[3]!;

    const fictionalHistory = [
      {
        turnId: 0,
        teamName: "Red Devils",
        placerName: "Alex",
        song: { songId: testSongs[0]!.songId, title: testSongs[0]!.title, artist: testSongs[0]!.artist, year: testSongs[0]!.year },
        correct: true,
        steal: null,
        scoreAfter: 1,
        teamScores: [
          { teamName: "Red Devils", score: 1 },
          { teamName: "Blue Angels", score: 0 },
        ],
      },
      {
        turnId: 1,
        teamName: "Blue Angels",
        placerName: "Taylor",
        song: { songId: testSongs[1]!.songId, title: testSongs[1]!.title, artist: testSongs[1]!.artist, year: testSongs[1]!.year },
        correct: false,
        steal: { stealerName: "Jake", correct: true },
        scoreAfter: 2,
        teamScores: [
          { teamName: "Red Devils", score: 2 },
          { teamName: "Blue Angels", score: 0 },
        ],
      },
      {
        turnId: 2,
        teamName: "Red Devils",
        placerName: "Jake",
        song: { songId: testSongs[2]!.songId, title: testSongs[2]!.title, artist: testSongs[2]!.artist, year: testSongs[2]!.year },
        correct: true,
        steal: null,
        scoreAfter: 3,
        teamScores: [
          { teamName: "Red Devils", score: 3 },
          { teamName: "Blue Angels", score: 0 },
        ],
      },
      {
        turnId: 3,
        teamName: "Blue Angels",
        placerName: "Morgan",
        song: { songId: testSongs[3]!.songId, title: testSongs[3]!.title, artist: testSongs[3]!.artist, year: testSongs[3]!.year },
        correct: true,
        steal: null,
        scoreAfter: 1,
        teamScores: [
          { teamName: "Red Devils", score: 3 },
          { teamName: "Blue Angels", score: 1 },
        ],
      },
      {
        turnId: 4,
        teamName: "Red Devils",
        placerName: "Alex",
        song: { songId: finalSong.songId, title: finalSong.title, artist: finalSong.artist, year: finalSong.year },
        correct: true,
        steal: null,
        scoreAfter: 4,
        teamScores: [
          { teamName: "Red Devils", score: 4 },
          { teamName: "Blue Angels", score: 1 },
        ],
      },
    ];

    try {
      const showcase = await showcaseService.build(
        {
          reason: "finale",
          song: { title: finalSong.title, artist: finalSong.artist, year: finalSong.year },
          situation: "Red Devils won the match with a final score of 4 points to 1 point.",
          headline: "Red Devils win Songster!",
          outcome: "correct",
          gameHistory: fictionalHistory,
          playerMentions: ["Alex", "Taylor", "Jake", "Morgan"],
          winningTimeline: testSongs.map((ts) => ({
            songId: ts.songId,
            snippetStartS: ts.snippetStartS,
            snippetLenS: ts.snippetLenS,
          })),
        },
        { model, think }
      );

      if (showcase === null) {
        res.json({ ok: false, error: "AI services failed to build showcase" });
        return;
      }

      res.json({ ok: true, showcase, latencyMs: Date.now() - t0 });
    } catch (err) {
      logger.error({ error: getErrorMessage(err) }, "admin showcase smoketest failed");
      res.status(500).json({ ok: false, error: getErrorMessage(err) });
    }
  });

  return router;
}
