import { ollamaUrl } from "../config.js";

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  format?: "json";
  timeoutMs?: number;
  /** Set to false to skip chain-of-thought reasoning (faster for short emcee lines). */
  think?: boolean;
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
    const body: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      format: request.format,
      stream: false,
    };
    // Pass think flag when explicitly set. Some models honour think:false by
    // returning an empty response field (content is in the think block); we
    // handle that below with a graceful fallback.
    if (request.think !== undefined) {
      body["think"] = request.think;
    }
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(request.timeoutMs ?? this.defaultTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status} for /api/generate.`);
    }

    const payload = (await response.json()) as OllamaGenerateResponse;
    let text = typeof payload.response === "string" ? payload.response : "";

    // Strip any chain-of-thought <think>…</think> block the model may emit
    // even when think:false was requested (model-specific behaviour).
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

    if (text.length === 0) {
      throw new Error("Ollama returned an empty text response.");
    }
    return text;
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
