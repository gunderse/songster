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
  {
    song: { title: "Take On Me", artist: "A-ha", year: 1985 },
    teamName: "Red",
    placerName: "Alex",
    situation: "Score: Red 5, Blue 2 (first to 10). Red is running away with it; Blue is getting shut out. Red is on a 3-in-a-row hot streak.",
  },
  {
    song: { title: "Don't Stop Believin'", artist: "Journey", year: 1981 },
    teamName: "Blue",
    placerName: "Sam",
    situation: "Score: Red 9, Blue 9 (first to 10). It's all tied up. Blue needs just one more to win.",
  },
];

for (const context of samples) {
  const clip = await emceeService.revealClip(host, context);
  if (clip === null) {
    logger.error({ song: context.song.title }, "clip generation failed");
  } else {
    logger.info(
      { song: context.song.title, hostName: clip.hostName, text: clip.text, durationMs: clip.durationMs },
      "clip ready",
    );
  }
}

process.exit(0);
