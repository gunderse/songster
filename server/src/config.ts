import path from "node:path";

/** Central runtime configuration, read from SONGSTER_* env vars. */

export const serverPort = Number(process.env.SONGSTER_SERVER_PORT ?? process.env.PORT ?? 4338);
export const clientPort = Number(process.env.SONGSTER_CLIENT_PORT ?? 4337);

/**
 * Bind address for the HTTP/Socket.IO server. Defaults to loopback because the
 * Vite dev client (bound to the LAN IP) proxies phone traffic to it. Set to
 * 0.0.0.0 to expose the API directly on the LAN.
 */
export const serverHost = process.env.SONGSTER_SERVER_HOST?.trim() || "127.0.0.1";

/**
 * Absolute path to the folder of mp3s to ingest. Defaults to the in-repo
 * assets/music folder (genre subfolders inside). Override with SONGSTER_MUSIC_DIR.
 */
const repoRoot = path.resolve(import.meta.dirname, "../..");
export const musicDir = process.env.SONGSTER_MUSIC_DIR?.trim() || path.join(repoRoot, "assets", "music");

/** Local LAN AI services (Ollama from M2 year-assist; Voice API from M6). */
export const ollamaUrl = (process.env.SONGSTER_OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
export const ollamaModel = process.env.SONGSTER_OLLAMA_MODEL?.trim() || "gemma4:latest";
export const voiceApiUrl = (process.env.SONGSTER_VOICE_API_URL ?? "http://localhost:3200").replace(/\/+$/, "");

/** Trigger a full themed showcase every Nth turn (plus steals, lead changes, finale). */
export const showcaseEveryN = Math.max(1, Number(process.env.SONGSTER_SHOWCASE_EVERY_N ?? 4));
