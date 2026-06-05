import { ollamaModel } from "../config.js";
import { getErrorMessage } from "../error-details.js";
import { logger } from "../logger.js";
import { ollamaService } from "./ollama-service.js";
import { voiceGeneratorService, type VoiceCharacter } from "./voice-generator-service.js";

export interface EmceeSong {
  title: string | null;
  artist: string | null;
  year: number;
}

export interface EmceeClip {
  audioUrl: string;
  durationMs: number;
  text: string;
  hostName: string;
}

/** Meta tags that make for a good game-show host voice. */
const HOST_TAGS = [
  "wise",
  "narrator",
  "voice-over",
  "authoritative",
  "commanding",
  "anchor",
  "newscaster",
  "captain",
  "smooth",
  "bold",
  "deep",
  "sophisticated",
  "heroic",
];
const PREFERRED_HOST = "Ouldeon";

export class EmceeService {
  /** Pick one host for the game: a random host-tagged voice, biased toward Ouldeon. */
  async chooseHost(): Promise<string | null> {
    let characters: VoiceCharacter[];
    try {
      characters = await voiceGeneratorService.listCharacters();
    } catch (error) {
      logger.warn({ error: getErrorMessage(error) }, "voice API unavailable; emcee disabled this game");
      return null;
    }
    if (characters.length === 0) return null;

    const hostLike = characters.filter((c) => c.tags.some((t) => HOST_TAGS.includes(t)));
    const pool = hostLike.length > 0 ? hostLike : characters;
    const preferred = pool.find((c) => c.name.toLowerCase() === PREFERRED_HOST.toLowerCase());
    // Weight the preferred host without making it certain.
    const weighted = preferred !== undefined ? [preferred, preferred, ...pool] : pool;
    const chosen = weighted[Math.floor(Math.random() * weighted.length)]!;
    logger.info({ host: chosen.name, tags: chosen.tags }, "emcee host chosen");
    return chosen.name;
  }

  /** Script + voice a short, in-character reveal line announcing the song's year. */
  async revealClip(hostName: string, song: EmceeSong): Promise<EmceeClip | null> {
    let text: string;
    try {
      text = await this.generateLine(hostName, song);
    } catch (error) {
      logger.warn({ error: getErrorMessage(error) }, "emcee script failed; using template line");
      text = fallbackLine(song);
    }

    try {
      const clip = await voiceGeneratorService.generateClip(
        hostName,
        text,
        `reveal-${song.year}-${(song.title ?? "song").slice(0, 40)}`,
      );
      return { audioUrl: clip.audioUrl, durationMs: clip.durationMs, text, hostName: clip.characterName };
    } catch (error) {
      logger.warn({ error: getErrorMessage(error), hostName }, "emcee voice generation failed");
      return null;
    }
  }

  private async generateLine(hostName: string, song: EmceeSong): Promise<string> {
    const characters = await voiceGeneratorService.listCharacters().catch(() => [] as VoiceCharacter[]);
    const tags = characters.find((c) => c.name === hostName)?.tags ?? [];
    const persona = tags.length > 0 ? tags.join(", ") : "charismatic";

    const prompt = [
      `You are ${hostName}, a ${persona} host on a live music game show.`,
      "Announce the song's release YEAR out loud, with personality, in ONE short sentence (max 18 words).",
      "Say the year clearly. Stay fully in character. Output ONLY the spoken line — no quotes, markdown, or stage directions.",
      `Song: "${song.title ?? "this track"}" by ${song.artist ?? "a mystery artist"}, released ${song.year}.`,
    ].join("\n");

    const raw = await ollamaService.generate({ model: ollamaModel, prompt, timeoutMs: 45_000 });
    const line =
      raw
        .trim()
        .replace(/^["'`]+|["'`]+$/g, "")
        .split(/\r?\n/u)[0]
        ?.trim() ?? "";
    return line.length >= 3 ? line.slice(0, 220) : fallbackLine(song);
  }
}

function fallbackLine(song: EmceeSong): string {
  const who = song.artist !== null ? ` by ${song.artist}` : "";
  return `${song.title ?? "This one"}${who} — released in ${song.year}.`;
}

export const emceeService = new EmceeService();
