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

export interface EmceeContext {
  song: EmceeSong;
  teamName: string;
  placerName: string;
  /** Short human summary of the game state (standings, streaks, shutouts...), or "". */
  situation: string;
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
const OLLAMA_TIMEOUT_MS = 30_000;

export class EmceeService {
  /** Pick one host for the game: a random host-tagged voice, biased toward Ouldeon. */
  async chooseHost(): Promise<string | null> {
    let characters: VoiceCharacter[];
    try {
      characters = await voiceGeneratorService.listCharacters();
    } catch (error) {
      logger.warn({ error: getErrorMessage(error) }, "voice API unavailable; emcee disabled (will retry)");
      return null;
    }
    if (characters.length === 0) return null;

    const hostLike = characters.filter((c) => c.tags.some((t) => HOST_TAGS.includes(t)));
    const pool = hostLike.length > 0 ? hostLike : characters;
    const preferred = pool.find((c) => c.name.toLowerCase() === PREFERRED_HOST.toLowerCase());
    const weighted = preferred !== undefined ? [preferred, preferred, ...pool] : pool;
    const chosen = weighted[Math.floor(Math.random() * weighted.length)]!;
    logger.info({ host: chosen.name, tags: chosen.tags }, "emcee host chosen");
    return chosen.name;
  }

  /** Script + voice a fun, in-character reveal: the year plus trivia and competitive banter. */
  async revealClip(hostName: string, context: EmceeContext): Promise<EmceeClip | null> {
    let text: string;
    try {
      text = await this.generateLine(hostName, context);
    } catch (error) {
      logger.warn({ error: getErrorMessage(error) }, "emcee script failed; using template line");
      text = fallbackLine(context.song);
    }
    logger.info({ hostName, text }, "emcee line scripted");

    // Voice it, with a single retry (the Voice API can blip under load).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const clip = await voiceGeneratorService.generateClip(
          hostName,
          text,
          `reveal-${context.song.year}-${(context.song.title ?? "song").slice(0, 32)}-${attempt}`,
        );
        return { audioUrl: clip.audioUrl, durationMs: clip.durationMs, text, hostName: clip.characterName };
      } catch (error) {
        logger.warn({ error: getErrorMessage(error), hostName, attempt }, "emcee voice generation failed");
      }
    }
    return null;
  }

  private async generateLine(hostName: string, context: EmceeContext): Promise<string> {
    const { song, situation } = context;
    const characters = await voiceGeneratorService.listCharacters().catch(() => [] as VoiceCharacter[]);
    const tags = characters.find((c) => c.name === hostName)?.tags ?? [];
    const persona = tags.length > 0 ? tags.join(", ") : "charismatic";

    const prompt = [
      `You are ${hostName}, a ${persona} host on a live music game show with rival teams.`,
      `Reveal that the song "${song.title ?? "this track"}" by ${song.artist ?? "a mystery artist"} was released in ${song.year}.`,
      `Make it entertaining: weave in ONE playful fun-fact or bit of trivia about the song, the artist, the year ${song.year}, or a movie/show it appeared in. Loose creative liberty is welcome.`,
      situation.length > 0
        ? `Current game state — work in a cheeky competitive jab only if it fits naturally: ${situation}`
        : "",
      "Stay fully in character. 1-2 short sentences, under 35 words total. State the year clearly. Output ONLY the spoken line — no quotes, markdown, or stage directions.",
    ]
      .filter((line) => line.length > 0)
      .join("\n");

    const raw = await ollamaService.generate({ model: ollamaModel, prompt, timeoutMs: OLLAMA_TIMEOUT_MS });
    const line = raw
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/gu, " ")
      .trim();
    return line.length >= 3 ? line.slice(0, 280) : fallbackLine(song);
  }
}

function fallbackLine(song: EmceeSong): string {
  const who = song.artist !== null ? ` by ${song.artist}` : "";
  return `${song.title ?? "This one"}${who} — released in ${song.year}.`;
}

export const emceeService = new EmceeService();
