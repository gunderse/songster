import { ollamaModel } from "../config.js";
import { getErrorMessage } from "../error-details.js";
import { logger } from "../logger.js";
import { ollamaService } from "./ollama-service.js";
import { voiceGeneratorService, type VoiceCharacter, cleanDialogText, stripEmphasis } from "./voice-generator-service.js";

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
  timeout?: boolean;
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
  async chooseHost(preferredHostName?: string, excludeHostName?: string | null): Promise<string | null> {
    let characters: VoiceCharacter[];
    try {
      characters = await voiceGeneratorService.listCharacters();
    } catch (error) {
      logger.warn({ error: getErrorMessage(error) }, "voice API unavailable; emcee disabled (will retry)");
      return null;
    }
    if (characters.length === 0) return null;

    if (preferredHostName && preferredHostName !== "random" && preferredHostName !== "cycle") {
      const found = characters.find((c) => c.name.toLowerCase() === preferredHostName.toLowerCase());
      if (found) {
        logger.info({ host: found.name, tags: found.tags }, "emcee host chosen (preferred)");
        return found.name;
      }
    }

    const hostLike = characters.filter((c) => c.tags.some((t) => HOST_TAGS.includes(t)));
    let pool = hostLike.length > 0 ? hostLike : characters;

    if (excludeHostName) {
      const filtered = pool.filter((c) => c.name.toLowerCase() !== excludeHostName.toLowerCase());
      if (filtered.length > 0) {
        pool = filtered;
      }
    }

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
    const cleanedText = cleanDialogText(text);
    logger.info({ hostName, text: cleanedText }, "emcee line scripted");

    // Voice it, with a single retry (the Voice API can blip under load).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const clip = await voiceGeneratorService.generateClip(
          hostName,
          cleanedText,
          `reveal-${context.outcome}-${context.song.year}-${(context.song.title ?? "song").slice(0, 32)}-${attempt}`,
        );
        return { audioUrl: clip.audioUrl, durationMs: clip.durationMs, text: stripEmphasis(cleanedText), hostName: clip.characterName };
      } catch (error) {
        logger.warn({ error: getErrorMessage(error), hostName, attempt }, "emcee voice generation failed");
      }
    }
    // Voice failed but we still have the line — return text-only so the
    // caption shows on the hub. Pace the reveal to roughly how long the
    // line would have taken to read aloud (~2.4 words/sec).
    const strippedText = stripEmphasis(cleanedText);
    const wordCount = strippedText.split(/\s+/u).filter(Boolean).length;
    const estDurationMs = Math.max(2200, Math.min(9000, wordCount * 420 + 600));
    return { audioUrl: null, durationMs: estDurationMs, text: strippedText, hostName };
  }

  async generateIntroClip(
    hostName: string,
    teamsWithPlayers: Array<{ name: string; players: string[] }>,
    targetSongs: number,
    nextPlayerName: string | null,
    teamsConfig: { hasMultipleMembers: boolean }
  ): Promise<EmceeClip | null> {
    let text: string;
    const teamNames = teamsWithPlayers.map((t) => t.name);
    try {
      text = await this.generateIntroText(hostName, teamsWithPlayers, targetSongs, nextPlayerName, teamsConfig);
    } catch (error) {
      logger.warn({ error: getErrorMessage(error) }, "emcee intro script failed; using fallback");
      text = fallbackIntroLine(teamNames, targetSongs, nextPlayerName);
    }
    const cleanedText = cleanDialogText(text);
    logger.info({ hostName, text: cleanedText }, "emcee intro scripted");

    // Voice it, with a single retry
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const clip = await voiceGeneratorService.generateClip(
          hostName,
          cleanedText,
          `intro-${targetSongs}-${teamNames.join("-").slice(0, 32)}-${attempt}`,
        );
        return { audioUrl: clip.audioUrl, durationMs: clip.durationMs, text: stripEmphasis(cleanedText), hostName: clip.characterName };
      } catch (error) {
        logger.warn({ error: getErrorMessage(error), hostName, attempt }, "emcee intro voice generation failed");
      }
    }

    // Voice failed, fallback text-only
    const strippedText = stripEmphasis(cleanedText);
    const wordCount = strippedText.split(/\s+/u).filter(Boolean).length;
    const estDurationMs = Math.max(3000, Math.min(12000, wordCount * 420 + 600));
    return { audioUrl: null, durationMs: estDurationMs, text: strippedText, hostName };
  }

  private async generateIntroText(
    hostName: string,
    teamsWithPlayers: Array<{ name: string; players: string[] }>,
    targetSongs: number,
    nextPlayerName: string | null,
    teamsConfig: { hasMultipleMembers: boolean }
  ): Promise<string> {
    const teamNames = teamsWithPlayers.map((t) => t.name);
    const characters = await voiceGeneratorService.listCharacters().catch(() => [] as VoiceCharacter[]);
    const tags = characters.find((c) => c.name === hostName)?.tags ?? [];
    const persona = tags.length > 0 ? tags.join(", ") : "charismatic";

    const teamDescriptions = teamsWithPlayers
      .map((t) => `Team ${t.name} (with players: ${t.players.length > 0 ? t.players.join(", ") : "no players"})`)
      .join(", and ");

    const instructions = [
      `You are ${hostName}, a ${persona} host on a live music game show called Songster.`,
      `Rival teams listen to song snippets and place them chronologically on their timeline.`,
      `Introduce the rivals: we have ${teamDescriptions}.`,
      `State the critical rule: the first team to place ${targetSongs} songs correctly wins.`,
    ];

    if (teamsConfig.hasMultipleMembers) {
      instructions.push(
        `Explain how teams work: teammates of the active player can look at the card on their screen and click on their timeline to suggest placement slots (sending helpful lightbulb suggestions), but only the active placer can make the final choice.`
      );
    }

    instructions.push(
      `Explain how steals work: if an opposing team spends a steal token to challenge *before* the active team submits their guess, and the active team's guess is wrong, the card is tested against the stealer's guessed slot. If the stealer is correct, their team steals the card! Only one steal attempt is allowed per turn.`
    );

    if (nextPlayerName) {
      instructions.push(`At the end, welcome the first player, ${nextPlayerName}, who is starting the game.`);
    }

    instructions.push(
      `Keep the introduction energetic and clear, around 80-120 words. Output ONLY the spoken line — no quotes, markdown, or stage directions.`,
      `When writing the spoken line, insert the token '[emphasis]' (exactly as written, including the square brackets) directly before any word you want to emphasize or speak with high energy (e.g. 'Welcome to [emphasis]Songster!'). Use this tag selectively on key words to make your delivery sound dynamic. Do NOT use closing tags like '[/emphasis]'.`
    );

    const prompt = instructions.join("\n");

    const raw = await ollamaService.generate({ model: ollamaModel, prompt, timeoutMs: OLLAMA_TIMEOUT_MS, think: false });
    const line = raw
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/gu, " ")
      .trim();
    return cleanDialogText(line.length >= 3 ? line.slice(0, 2000) : fallbackIntroLine(teamNames, targetSongs, nextPlayerName));
  }

  async generateText(hostName: string, context: EmceeContext): Promise<string> {
    const { song, situation, teamName, placerName, outcome, steal, leadChange, streak, nextPlayerName, timeout } = context;
    const characters = await voiceGeneratorService.listCharacters().catch(() => [] as VoiceCharacter[]);
    const tags = characters.find((c) => c.name === hostName)?.tags ?? [];
    const persona = tags.length > 0 ? tags.join(", ") : "charismatic";

    const verdict =
      outcome === "correct"
        ? `${placerName} of team ${teamName} placed it CORRECTLY — celebrate the right call.`
        : (timeout
            ? `${placerName} of team ${teamName} RAN OUT OF TIME — playfully rib them for freezing up and failing to place the card.`
            : `${placerName} of team ${teamName} placed it WRONG — playfully rib them for the miss.`);

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
      `Keep it TIGHT and punchy: UNDER 38 words total. Start with the right/wrong reaction, state the year, and end by mentioning the next player ${nextPlayerName ? `(${nextPlayerName})` : ""}. Output ONLY the spoken line — no quotes, markdown, or stage directions.`,
      `When writing the spoken line, insert the token '[emphasis]' (exactly as written, including the square brackets) directly before any word you want to emphasize or speak with high energy (e.g. 'That was [emphasis]correct!'). Use this tag selectively on key words to make your delivery sound dynamic. Do NOT use closing tags like '[/emphasis]'.`,
      `IMPORTANT: The scores listed in the game state/standings ALREADY include/reflect the outcome of this turn. Do NOT add or increment the score further when narrating.`
    );

    const prompt = instructions.filter((line) => line.length > 0).join("\n");

    const raw = await ollamaService.generate({ model: ollamaModel, prompt, timeoutMs: OLLAMA_TIMEOUT_MS, think: false });
    const line = raw
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/gu, " ")
      .trim();
    return cleanDialogText(line.length >= 3 ? line.slice(0, 350) : fallbackLine(context));
  }
}

function fallbackLine(context: EmceeContext): string {
  const { song, outcome, teamName, steal, leadChange, streak, nextPlayerName, timeout } = context;
  const who = song.artist !== null ? ` by ${song.artist}` : "";
  let verdict = outcome === "correct"
    ? `Correct, ${teamName}!`
    : (timeout
        ? `Time's up, ${teamName}! You ran out of time.`
        : `Not quite, ${teamName}!`);
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
  return `Welcome to Songster! We have team ${teamNames.join(" and ")} ready to compete. Listen to the song snippets and place them chronologically. The first team to reach ${targetSongs} wins. Remember: you can spend a steal token to challenge before the other team guesses; if their guess is wrong and yours is correct, you steal the card!${handoff} Let's get ready to play!`;
}

export const emceeService = new EmceeService();
