import { emceeService } from "../ai/emcee-service.js";
import { ollamaModel, ollamaUrl, voiceApiUrl } from "../config.js";
import { logger } from "../logger.js";

// Exercises the M6 emcee end-to-end against the live Ollama + Voice API.
// Usage: pnpm --filter @songster/server emcee:smoke

logger.info({ ollamaUrl, ollamaModel, voiceApiUrl }, "emcee smoke: config");

const host = await emceeService.chooseHost();
logger.info({ host }, "emcee smoke: host chosen");

if (host === null) {
  logger.error("No host (voice API unreachable or no characters). Is the Voice API up at the configured URL?");
  process.exit(1);
}

const samples = [
  { title: "Take On Me", artist: "A-ha", year: 1985 },
  { title: "Don't Stop Believin'", artist: "Journey", year: 1981 },
];

for (const song of samples) {
  const clip = await emceeService.revealClip(host, song);
  if (clip === null) {
    logger.error({ song }, "clip generation failed");
  } else {
    logger.info({ song: song.title, hostName: clip.hostName, text: clip.text, durationMs: clip.durationMs, audioUrl: clip.audioUrl }, "clip ready");
  }
}

process.exit(0);
