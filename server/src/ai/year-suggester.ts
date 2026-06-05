import { yearSuggestionSchema, type YearSuggestion } from "@songster/shared/library";

import { ollamaModel } from "../config.js";
import { gpuLock } from "./gpu-lock.js";
import { ollamaService } from "./ollama-service.js";

export interface YearSuggestInput {
  title: string | null;
  artist: string | null;
  album: string | null;
}

/**
 * Ask the local LLM for a song's ORIGINAL release year. This is an assist only:
 * the curator always confirms or overrides the value. Stays on the LAN; no public
 * internet. The model can be wrong, so confidence is surfaced to the curator.
 */
export async function suggestOriginalYear(input: YearSuggestInput): Promise<YearSuggestion> {
  if (input.title === null || input.artist === null) {
    throw new Error("A title and artist are required to suggest a year.");
  }

  const prompt = buildPrompt(input);
  const raw = await gpuLock.enqueue(
    "year-suggest",
    () => ollamaService.generate({ model: ollamaModel, prompt, format: "json", timeoutMs: 30_000 }),
    500,
  );
  return parseSuggestion(raw);
}

function buildPrompt(input: YearSuggestInput): string {
  return [
    "You are a meticulous music historian.",
    "Return the ORIGINAL release year of the SONG — the year the song first came out —",
    "NOT the year of any compilation, soundtrack, remaster, remix, re-recording, or greatest-hits album it later appeared on.",
    "",
    "Return STRICT JSON ONLY, no prose, exactly this shape:",
    '{"year": <4-digit number>, "confidence": "high" | "medium" | "low", "note": "<=12 word reason"}',
    "",
    `Title: ${input.title}`,
    `Artist: ${input.artist}`,
    input.album !== null ? `Listed album (often a later compilation — ignore for dating): ${input.album}` : "Album: unknown",
    "",
    "If the title mentions a remix/edit, date the ORIGINAL song, not the remix.",
    "If unsure, give your best estimate and set confidence to low.",
  ].join("\n");
}

function parseSuggestion(raw: string): YearSuggestion {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  let candidate = (fenced?.[1] ?? raw).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const braced = candidate.match(/\{[\s\S]*\}/u);
    if (braced === null) {
      throw new Error(`Could not parse a year suggestion from the model: ${candidate.slice(0, 160)}`);
    }
    candidate = braced[0];
    parsed = JSON.parse(candidate);
  }

  return yearSuggestionSchema.parse(parsed);
}
