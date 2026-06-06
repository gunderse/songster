import { showcaseService, type ShowcaseContext } from "../ai/showcase-service.js";
import { logger } from "../logger.js";

// Builds a couple of full themed showcases end-to-end (theme + cast + script + voice).
// Usage: pnpm --filter @songster/server showcase:smoke

const contexts: ShowcaseContext[] = [
  {
    reason: "steal",
    song: { title: "Take On Me", artist: "A-ha", year: 1985 },
    situation: "Score: Red 4, Blue 3 (first to 10). It's close.",
    headline: "Sam STOLE the card right out from under Red!",
  },
  {
    reason: "finale",
    song: { title: "Mr. Brightside", artist: "The Killers", year: 2003 },
    situation: "Score: Red 10, Blue 8 (first to 10).",
    headline: "Red win Songster!",
  },
];

for (const context of contexts) {
  const view = await showcaseService.build(context);
  if (view === null) {
    logger.error({ reason: context.reason }, "showcase build returned null (voice API down?)");
    continue;
  }
  logger.info(
    {
      reason: context.reason,
      theme: view.themeId,
      bgVideoUrl: view.bgVideoUrl,
      bgMusicUrl: view.bgMusicUrl,
      cues: view.cues.map((c) => ({ who: c.characterName, durationMs: c.durationMs, text: c.text })),
    },
    "showcase built",
  );
}

process.exit(0);
