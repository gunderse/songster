import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { voiceApiUrl } from "../config.js";
import { logger } from "../logger.js";
import { gpuLock } from "./gpu-lock.js";

export interface VoiceCharacter {
  id: string;
  name: string;
  tags: string[];
}

export interface GeneratedVoiceClip {
  audioUrl: string;
  durationMs: number;
  characterName: string;
}

const revealAudioCacheDir = path.resolve(import.meta.dirname, "../../cache/reveal-audio");
const requestTimeoutMs = Number(process.env.SONGSTER_VOICE_API_TIMEOUT_MS ?? 60_000);

export function getRevealAudioCacheDir(): string {
  return revealAudioCacheDir;
}

/** Client for the local Voice API (gemini/voice-gen). Ported from epyc-codex; the
 *  character list now carries meta tags, and clips are cached + served at /reveal-audio. */
export class VoiceGeneratorService {
  private charactersCache: { fetchedAt: number; characters: VoiceCharacter[] } | null = null;

  constructor(
    private readonly baseUrl = voiceApiUrl,
    private readonly timeoutMs = requestTimeoutMs,
  ) {}

  async listCharacters(): Promise<VoiceCharacter[]> {
    if (this.charactersCache !== null && Date.now() - this.charactersCache.fetchedAt < 60_000) {
      return this.charactersCache.characters;
    }
    const response = await fetch(`${this.baseUrl}/api/external/characters`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Voice API returned HTTP ${response.status} for /api/external/characters.`);
    const payload = (await response.json()) as Array<{ id?: string; name?: string; tags?: string[] }>;
    const characters = payload
      .filter((c): c is { id: string; name: string; tags?: string[] } => typeof c?.id === "string" && typeof c?.name === "string")
      .map((c) => ({ id: c.id, name: c.name.trim(), tags: Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === "string") : [] }))
      .filter((c) => c.name.length > 0);
    this.charactersCache = { fetchedAt: Date.now(), characters };
    return characters;
  }

  async generateClip(characterName: string, text: string, cacheKey: string): Promise<GeneratedVoiceClip> {
    return gpuLock.enqueue(`voice:${characterName}`, () => this.generateClipNow(characterName, text, cacheKey), 1200);
  }

  private async generateClipNow(characterName: string, text: string, cacheKey: string): Promise<GeneratedVoiceClip> {
    const name = characterName.trim();
    const body = text.trim();
    if (name.length === 0 || body.length === 0) throw new Error("Voice generation needs a character name and text.");

    await mkdir(revealAudioCacheDir, { recursive: true });
    const fingerprint = crypto.createHash("sha256").update(`${name}\n${body}`).digest("hex").slice(0, 16);
    const safeKey = cacheKey.replace(/[^a-z0-9_-]+/giu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "cue";
    const fileBase = `${safeKey}-${fingerprint}`;
    const audioPath = path.join(revealAudioCacheDir, `${fileBase}.wav`);
    const metaPath = path.join(revealAudioCacheDir, `${fileBase}.json`);

    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as Partial<GeneratedVoiceClip>;
      if (typeof meta.audioUrl === "string" && typeof meta.durationMs === "number") {
        return { audioUrl: meta.audioUrl, durationMs: meta.durationMs, characterName: meta.characterName ?? name };
      }
    } catch {
      // cache miss; regenerate
    }

    const response = await fetch(`${this.baseUrl}/api/external/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterName: name, text: body }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Voice API returned HTTP ${response.status} for /api/external/generate.`);
    const payload = (await response.json()) as { url?: string };
    if (typeof payload.url !== "string" || payload.url.trim().length === 0) {
      throw new Error("Voice API did not return an audio URL.");
    }

    const fileResponse = await fetch(new URL(payload.url, this.baseUrl).toString(), {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!fileResponse.ok) throw new Error(`Voice API returned HTTP ${fileResponse.status} for the audio file.`);

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const durationMs = getWavDurationMs(buffer);
    const audioUrl = `/reveal-audio/${path.basename(audioPath)}`;
    await writeFile(audioPath, buffer);
    await writeFile(metaPath, JSON.stringify({ audioUrl, durationMs, characterName: name }));
    logger.info({ characterName: name, durationMs, audioUrl }, "generated reveal voice clip");
    return { audioUrl, durationMs, characterName: name };
  }
}

function getWavDurationMs(buffer: Buffer): number {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return 3000; // not a WAV we can parse; assume ~3s
  }
  let offset = 12;
  let byteRate: number | null = null;
  let dataSize: number | null = null;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === "fmt " && chunkSize >= 12 && chunkStart + chunkSize <= buffer.length) {
      byteRate = buffer.readUInt32LE(chunkStart + 8);
    }
    if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (byteRate === null || dataSize === null || byteRate <= 0) return 3000;
  return Math.max(500, Math.round((dataSize / byteRate) * 1000));
}

export const voiceGeneratorService = new VoiceGeneratorService();
