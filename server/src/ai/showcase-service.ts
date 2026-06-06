import { z } from "zod";

import type { ShowcaseCueView, ShowcaseView } from "@songster/shared/game";

import { ollamaModel } from "../config.js";
import { getErrorMessage } from "../error-details.js";
import { logger } from "../logger.js";
import { ollamaService } from "./ollama-service.js";
import { voiceGeneratorService, type VoiceCharacter } from "./voice-generator-service.js";

export type ShowcaseReason = "steal" | "leadChange" | "milestone" | "finale";

export interface ShowcaseContext {
  reason: ShowcaseReason;
  song: { title: string | null; artist: string | null; year: number } | null;
  situation: string;
  /** One line describing what just happened, e.g. "Blue STOLE the card from Red!" */
  headline: string;
}

interface ThemeConfig {
  id: string;
  label: string;
  tagline: string;
  promptStyle: string;
  roles: { host: string; cohost: string | null };
  preferredPersonas: { host: string[]; cohost: string[] };
  music: string;
}

// Reuses the epyc-codex themes; persona tags match the live Voice API tags.
const THEMES: ThemeConfig[] = [
  {
    id: "sportscast",
    label: "Sportscast",
    tagline: "Live play-by-play from the music center",
    promptStyle: "an energetic sports broadcast calling a wildly unpredictable play-by-play",
    roles: { host: "Play-by-play", cohost: "Color commentator" },
    preferredPersonas: { host: ["bold", "commanding", "strong", "heroic", "captain"], cohost: ["rogue", "funny", "energetic", "comedic"] },
    music: "sports.mp3",
  },
  {
    id: "nightly-news",
    label: "Nightly News",
    tagline: "Tonight's top story",
    promptStyle: "a nightly news broadcast with an anchor tossing to a field reporter for dramatic updates",
    roles: { host: "Anchor", cohost: "Field reporter" },
    preferredPersonas: { host: ["newscaster", "anchor", "authoritative", "professional"], cohost: ["logical", "calm", "wise"] },
    music: "2020.mp3",
  },
  {
    id: "nature-doc",
    label: "Nature Documentary",
    tagline: "Observe the wild contestants",
    promptStyle: "a dead-serious nature documentary narrator describing ridiculous behavior in the wild",
    roles: { host: "Narrator", cohost: null },
    preferredPersonas: { host: ["narrator", "wise", "calm", "deep", "voice-over", "western"], cohost: [] },
    music: "wild-kingdom.mp3",
  },
  {
    id: "star-trek",
    label: "Star Trek",
    tagline: "Boldly guessing where no team has guessed before",
    promptStyle: "a sci-fi bridge scene with a commanding captain and a logical officer",
    roles: { host: "Captain", cohost: "Officer" },
    preferredPersonas: { host: ["captain", "commanding", "bold", "star-trek"], cohost: ["logical", "tech", "medical", "star-trek", "sarcastic"] },
    music: "startrek2.mp3",
  },
  {
    id: "sitcom",
    label: "90s Sitcom",
    tagline: "A very special episode",
    promptStyle: "a punchy 90s sitcom scene with quick joke beats",
    roles: { host: "Lead", cohost: "Best friend" },
    preferredPersonas: { host: ["funny", "90s-sitcom", "energetic", "comedic"], cohost: ["funny", "comedic", "rogue", "sophisticated"] },
    music: "sitcom.mp3",
  },
  {
    id: "movie-review",
    label: "Movie Review",
    tagline: "Two critics, one baffling result",
    promptStyle: "a sharp, funny two-critic movie-review segment reacting to a bizarre turn",
    roles: { host: "Critic A", cohost: "Critic B" },
    preferredPersonas: { host: ["wise", "sophisticated", "deep"], cohost: ["logical", "sarcastic", "irritable", "rogue"] },
    music: "movies.mp3",
  },
  {
    id: "beef",
    label: "Beef. It's What's For Dinner",
    tagline: "The legendary experience",
    promptStyle: "the iconic 'Beef. It's What's For Dinner' commercial, with a deep authoritative western voice",
    roles: { host: "Narrator", cohost: null },
    preferredPersonas: { host: ["western", "sam-elliot", "rough", "voice-over", "wise"], cohost: [] },
    music: "rodeo.mp3",
  },
  {
    id: "potpourri",
    label: "Potpourri",
    tagline: "A total free-for-all",
    promptStyle: "a hilarious free-for-all with two mismatched characters bantering",
    roles: { host: "Host", cohost: "Sidekick" },
    preferredPersonas: { host: ["bold", "monster", "kid-friendly", "heroic"], cohost: ["funny", "rogue", "comedic"] },
    music: "ukelele.mp3",
  },
];

const cueSchema = z.object({ speaker: z.enum(["host", "cohost"]), text: z.string().trim().min(1).max(220) });
const scriptSchema = z.object({ cues: z.array(cueSchema).min(1).max(4) });
type Cue = z.infer<typeof cueSchema>;

const OLLAMA_TIMEOUT_MS = 40_000;

export class ShowcaseService {
  /** Build a full themed showcase, or null if the AI services are unavailable. */
  async build(context: ShowcaseContext): Promise<ShowcaseView | null> {
    let characters: VoiceCharacter[];
    try {
      characters = await voiceGeneratorService.listCharacters();
    } catch (error) {
      logger.warn({ error: getErrorMessage(error) }, "voice API unavailable; showcase skipped");
      return null;
    }
    if (characters.length === 0) return null;

    const theme = THEMES[Math.floor(Math.random() * THEMES.length)]!;
    const cast = pickCast(theme, characters);
    if (cast.host === null) return null;

    let cues: Cue[];
    try {
      const raw = await ollamaService.generate({
        model: ollamaModel,
        prompt: buildPrompt(theme, context, cast),
        format: "json",
        timeoutMs: OLLAMA_TIMEOUT_MS,
      });
      cues = parseScript(raw);
    } catch (error) {
      logger.warn({ error: getErrorMessage(error), theme: theme.id }, "showcase script failed; using template");
      cues = templateCues(theme, context);
    }

    const voiced: ShowcaseCueView[] = [];
    for (const cue of cues) {
      const characterName = cue.speaker === "cohost" && cast.cohost !== null ? cast.cohost : cast.host;
      const speakerLabel = cue.speaker === "cohost" ? (theme.roles.cohost ?? theme.roles.host) : theme.roles.host;
      let audioUrl: string | null = null;
      let durationMs = estimateMs(cue.text);
      try {
        const clip = await voiceGeneratorService.generateClip(characterName, cue.text, `showcase-${theme.id}-${context.reason}-${cue.speaker}`);
        audioUrl = clip.audioUrl;
        durationMs = clip.durationMs;
      } catch (error) {
        logger.warn({ error: getErrorMessage(error), characterName }, "showcase cue voice failed; caption only");
      }
      voiced.push({ speakerLabel, characterName, text: cue.text, audioUrl, durationMs });
    }

    logger.info({ theme: theme.id, reason: context.reason, host: cast.host, cohost: cast.cohost, cues: voiced.length }, "showcase built");
    return {
      themeId: theme.id,
      themeLabel: theme.label,
      tagline: theme.tagline,
      bgVideoUrl: `/showcase/backgrounds/${theme.id}.mp4`,
      bgImageUrl: `/showcase/backgrounds/${theme.id}.jpg`,
      bgMusicUrl: `/showcase/music/${theme.music}`,
      cues: voiced,
    };
  }
}

function pickCast(theme: ThemeConfig, characters: VoiceCharacter[]): { host: string | null; cohost: string | null } {
  const pick = (tags: string[], exclude: string | null): string | null => {
    const matches = characters.filter(
      (c) => c.name !== exclude && !c.tags.includes("low-priority") && c.tags.some((t) => tags.includes(t)),
    );
    const pool = matches.length > 0 ? matches : characters.filter((c) => c.name !== exclude);
    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)]!.name : null;
  };
  const host = pick(theme.preferredPersonas.host, null);
  const cohost = theme.roles.cohost !== null ? pick(theme.preferredPersonas.cohost, host) : null;
  return { host, cohost };
}

function buildPrompt(theme: ThemeConfig, context: ShowcaseContext, cast: { host: string | null; cohost: string | null }): string {
  const song = context.song;
  return [
    `Write a short, funny segment in the style of ${theme.promptStyle}.`,
    `React to this moment in a music-timeline party game: ${context.headline}`,
    song !== null ? `The song in question: "${song.title ?? "a track"}" by ${song.artist ?? "someone"}, from ${song.year}.` : "",
    context.situation.length > 0 ? `Game state: ${context.situation}` : "",
    'Return STRICT JSON ONLY: {"cues":[{"speaker":"host","text":"..."},{"speaker":"cohost","text":"..."}]}',
    `Speakers: "host" (${cast.host ?? theme.roles.host})${theme.roles.cohost !== null ? ` and "cohost" (${cast.cohost ?? theme.roles.cohost})` : ' only — use "host" for every cue'}.`,
    "2-3 cues total. Each cue ONE short sentence under 24 words, fully in character. Mention the year if a song is given. No markdown, no stage directions.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function parseScript(raw: string): Cue[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = (fenced?.[1] ?? raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const braced = candidate.match(/\{[\s\S]*\}/u);
    if (braced === null) throw new Error(`No JSON in showcase script: ${candidate.slice(0, 160)}`);
    parsed = JSON.parse(braced[0]);
  }
  return scriptSchema.parse(parsed).cues;
}

function templateCues(theme: ThemeConfig, context: ShowcaseContext): Cue[] {
  const cues: Cue[] = [{ speaker: "host", text: context.headline }];
  if (context.song !== null) {
    cues.push({
      speaker: theme.roles.cohost !== null ? "cohost" : "host",
      text: `${context.song.title ?? "That one"} — ${context.song.year}.`,
    });
  }
  return cues;
}

function estimateMs(text: string): number {
  return Math.max(1500, text.split(/\s+/u).length * 380 + 800);
}

export const showcaseService = new ShowcaseService();
