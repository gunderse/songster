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
  /** Whether the placement was right — the host opens by reacting to this. */
  outcome: "correct" | "wrong";
  steal?: { stealerName: string; stealerTeamName: string } | null;
  leadChange?: { newLeaderName: string } | null;
  streak?: { streakCount: number } | null;
  nextPlayerName?: string | null;
}

export interface EmceeClip {
  /** null when the Voice API failed — caption is still shown so the host always speaks. */
  audioUrl: string | null;
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
const PREFERRED_HOST = "Fraiser";
const OLLAMA_TIMEOUT_MS = 45_000;

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
  async revealClip(
    hostName: string,
    context: EmceeContext,
    preGeneratedText?: string | null
  ): Promise<EmceeClip | null> {
    let text = preGeneratedText;
    if (!text) {
      try {
        text = await this.generateText(hostName, context);
      } catch (error) {
        logger.warn({ error: getErrorMessage(error) }, "emcee script failed; using template line");
        text = fallbackLine(context);
      }
    }
    logger.info({ hostName, text }, "emcee line scripted");

    // Voice it, with a single retry (the Voice API can blip under load).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const clip = await voiceGeneratorService.generateClip(
          hostName,
          text,
          `reveal-${context.outcome}-${context.song.year}-${(context.song.title ?? "song").slice(0, 32)}-${attempt}`,
        );
        return { audioUrl: clip.audioUrl, durationMs: clip.durationMs, text, hostName: clip.characterName };
      } catch (error) {
        logger.warn({ error: getErrorMessage(error), hostName, attempt }, "emcee voice generation failed");
      }
    }
    // Voice failed but we still have the line — return text-only so the
    // caption shows on the hub. Pace the reveal to roughly how long the
    // line would have taken to read aloud (~2.4 words/sec).
    const wordCount = text.split(/\s+/u).filter(Boolean).length;
    const estDurationMs = Math.max(2200, Math.min(9000, wordCount * 420 + 600));
    return { audioUrl: null, durationMs: estDurationMs, text, hostName };
  }

  async generateIntroClip(
    hostName: string,
    teamNames: string[],
    playerNames: string[],
    targetSongs: number,
    nextPlayerName: string | null,
    teamsConfig: { hasMultipleMembers: boolean }
  ): Promise<EmceeClip | null> {
    let text: string;
    try {
      text = await this.generateIntroText(hostName, teamNames, playerNames, targetSongs, nextPlayerName, teamsConfig);
    } catch (error) {
      logger.warn({ error: getErrorMessage(error) }, "emcee intro script failed; using fallback");
      text = fallbackIntroLine(teamNames, targetSongs, nextPlayerName);
    }
    logger.info({ hostName, text }, "emcee intro scripted");

    // Voice it, with a single retry
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const clip = await voiceGeneratorService.generateClip(
          hostName,
          text,
          `intro-${targetSongs}-${teamNames.join("-").slice(0, 32)}-${attempt}`,
        );
        return { audioUrl: clip.audioUrl, durationMs: clip.durationMs, text, hostName: clip.characterName };
      } catch (error) {
        logger.warn({ error: getErrorMessage(error), hostName, attempt }, "emcee intro voice generation failed");
      }
    }

    // Voice failed, fallback text-only
    const wordCount = text.split(/\s+/u).filter(Boolean).length;
    const estDurationMs = Math.max(3000, Math.min(12000, wordCount * 420 + 600));
    return { audioUrl: null, durationMs: estDurationMs, text, hostName };
  }

  private async generateIntroText(
    hostName: string,
    teamNames: string[],
    playerNames: string[],
    targetSongs: number,
    nextPlayerName: string | null,
    teamsConfig: { hasMultipleMembers: boolean }
  ): Promise<string> {
    const characters = await voiceGeneratorService.listCharacters().catch(() => [] as VoiceCharacter[]);
    const tags = characters.find((c) => c.name === hostName)?.tags ?? [];
    const persona = tags.length > 0 ? tags.join(", ") : "charismatic";

    const instructions = [
      `You are ${hostName}, a ${persona} host on a live music game show called Songster.`,
      `Rival teams listen to song snippets and place them chronologically on their timeline.`,
      `Introduce the rivals: we have teams ${teamNames.join(" and ")} with players ${playerNames.join(", ")}.`,
      `State the critical rule: the first team to place ${targetSongs} songs correctly wins.`,
    ];

    if (teamsConfig.hasMultipleMembers) {
      instructions.push(
        `Explain how teams work: teammates of the active player can look at the card on their screen and click on their timeline to suggest placement slots (sending helpful lightbulb suggestions), but only the active placer can make the final choice.`
      );
    }

    instructions.push(
      `Explain how steals work: if the active team gets a card wrong, the opposing team can spend a steal token to place the card on their own timeline. If they are correct, they steal the card! Only one steal attempt is allowed per turn.`,
      `Explain tiebreaking: because turns are sequential, the first team to reach ${targetSongs} wins immediately. If there is a tie, we keep playing until a team scores the winning point.`
    );

    if (nextPlayerName) {
      instructions.push(`At the end, welcome the first player, ${nextPlayerName}, who is starting the game.`);
    }

    instructions.push(
      `Keep the introduction energetic and clear, around 80-120 words. Output ONLY the spoken line — no quotes, markdown, or stage directions.`
    );

    const prompt = instructions.join("\n");

    const raw = await ollamaService.generate({ model: ollamaModel, prompt, timeoutMs: OLLAMA_TIMEOUT_MS, think: false });
    const line = raw
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/gu, " ")
      .trim();
    return line.length >= 3 ? line.slice(0, 500) : fallbackIntroLine(teamNames, targetSongs, nextPlayerName);
  }

  async generateText(hostName: string, context: EmceeContext): Promise<string> {
    const { song, situation, teamName, placerName, outcome, steal, leadChange, streak, nextPlayerName } = context;
    const characters = await voiceGeneratorService.listCharacters().catch(() => [] as VoiceCharacter[]);
    const tags = characters.find((c) => c.name === hostName)?.tags ?? [];
    const persona = tags.length > 0 ? tags.join(", ") : "charismatic";

    const verdict =
      outcome === "correct"
        ? `${placerName} of team ${teamName} placed it CORRECTLY — celebrate the right call.`
        : `${placerName} of team ${teamName} placed it WRONG — playfully rib them for the miss.`;

    const instructions = [
      `You are ${hostName}, a ${persona} host on a live music game show with rival teams.`,
      `Open by reacting to the result: ${verdict}`,
    ];

    if (steal) {
      instructions.push(`Mention that ${steal.stealerName} of team ${steal.stealerTeamName} STOLE the card!`);
    }
    if (leadChange) {
      instructions.push(`Mention that team ${leadChange.newLeaderName} has just taken the lead!`);
    }
    if (streak) {
      instructions.push(`Mention that team ${teamName} has a hot streak of ${streak.streakCount} correct guesses in a row!`);
    }

    instructions.push(
      `Then reveal "${song.title ?? "this track"}" by ${song.artist ?? "a mystery artist"} came out in ${song.year}, with ONE quick fun-fact about the song, artist, or year.`
    );

    if (nextPlayerName) {
      instructions.push(`Hand off to the next player, ${nextPlayerName}, who is up next.`);
    }

    instructions.push(
      situation.length > 0 ? `Optional cheeky jab if it fits in a few words: ${situation}` : "",
      `Keep it TIGHT and punchy: UNDER 38 words total. Start with the right/wrong reaction, state the year, and end by mentioning the next player ${nextPlayerName ? `(${nextPlayerName})` : ""}. Output ONLY the spoken line — no quotes, markdown, or stage directions.`
    );

    const prompt = instructions.filter((line) => line.length > 0).join("\n");

    const raw = await ollamaService.generate({ model: ollamaModel, prompt, timeoutMs: OLLAMA_TIMEOUT_MS, think: false });
    const line = raw
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/gu, " ")
      .trim();
    return line.length >= 3 ? line.slice(0, 350) : fallbackLine(context);
  }
}

function fallbackLine(context: EmceeContext): string {
  const { song, outcome, teamName, steal, leadChange, streak, nextPlayerName } = context;
  const who = song.artist !== null ? ` by ${song.artist}` : "";
  let verdict = outcome === "correct" ? `Correct, ${teamName}!` : `Not quite, ${teamName}!`;
  if (steal) {
    verdict += ` ${steal.stealerName} stole it for team ${steal.stealerTeamName}!`;
  } else if (leadChange) {
    verdict += ` Team ${leadChange.newLeaderName} takes the lead!`;
  } else if (streak) {
    verdict += ` That's ${streak.streakCount} in a row!`;
  }
  const handoff = nextPlayerName ? ` Next up is ${nextPlayerName}!` : "";
  return `${verdict} ${song.title ?? "This one"}${who} — released in ${song.year}.${handoff}`;
}

function fallbackIntroLine(teamNames: string[], targetSongs: number, nextPlayerName: string | null): string {
  const handoff = nextPlayerName ? ` First up is ${nextPlayerName}!` : "";
  return `Welcome to Songster! We have team ${teamNames.join(" and ")} ready to compete. Listen to the song snippets, place them chronologically, and be the first to reach ${targetSongs} songs to win!${handoff} Let's get ready to play!`;
}

export const emceeService = new EmceeService();
