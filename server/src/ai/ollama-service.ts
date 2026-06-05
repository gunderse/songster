import { ollamaUrl } from "../config.js";

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  format?: "json";
  timeoutMs?: number;
}

interface OllamaGenerateResponse {
  response?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

/** Thin client for a local Ollama server. Ported/simplified from epyc-codex. */
export class OllamaService {
  constructor(
    private readonly baseUrl = ollamaUrl,
    private readonly defaultTimeoutMs = 30_000,
  ) {}

  async generate(request: OllamaGenerateRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        format: request.format,
        stream: false,
      }),
      signal: AbortSignal.timeout(request.timeoutMs ?? this.defaultTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status} for /api/generate.`);
    }

    const payload = (await response.json()) as OllamaGenerateResponse;
    if (typeof payload.response !== "string") {
      throw new Error("Ollama did not return a text response.");
    }
    return payload.response;
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status} for /api/tags.`);
    }
    const payload = (await response.json()) as OllamaTagsResponse;
    return (payload.models ?? [])
      .map((model) => model.name)
      .filter((name): name is string => typeof name === "string");
  }
}

export const ollamaService = new OllamaService();
