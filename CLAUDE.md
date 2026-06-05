# CLAUDE.md — context for Claude Code

Read automatically at session start. Keep it the single source of truth for project-wide context. Update as the codebase evolves.

## Project

**Songster** is a LAN-only, theater-style web party game — a digital reimagining of *Hitster* with **no cards and no QR-on-cards**. Teams hear a song snippet on a shared **hub** screen and place it chronologically on their team's timeline; first team to a correct timeline of 10 wins. The signature feature is a **gen-AI game-show host**: a persistent emcee voices the year reveal every round, with full themed multi-character "showcase" segments at the dramatic peaks.

The authoritative design lives in the approved plan: `~/.claude/plans/sequential-stirring-swan.md`. Songster deliberately mirrors the architecture, conventions, and AI voice-show pipeline of the reference repo **`/Users/ericgundersen/Projects/codex/epyc-codex`**.

## Hard facts (do not relitigate)

- **Stack:** Node 22 + TypeScript (strict), Express 5, Socket.IO, `better-sqlite3`, `zod`, `pino`; client is Vite + React 18 + Tailwind v4 (via `@tailwindcss/vite`, no config file). Framer Motion + canvas-confetti added at M8.
- **Workspace:** pnpm monorepo — `shared/` (`@songster/shared`), `server/` (`@songster/server`), `client/` (`@songster/client`). Repo-local conda env (`.conda-env`) + repo-local pnpm store (`.pnpm-store`).
- **Persistence:** SQLite via `better-sqlite3`. SQL migration files in `server/migrations/*.sql`, applied by `pnpm db:migrate` and on server boot.
- **Music source:** a local folder of mp3s (`SONGSTER_MUSIC_DIR`), ID3 read with `music-metadata`. No Plex, no public internet.
- **Year accuracy:** manual curation (`/library`) — the host confirms/corrects each song's original year before it's playable. This is the game-critical data.
- **Audio:** the **hub screen is the sole audio source** during gameplay. Phones are silent except small UI taps. Snippets stream from the server by **opaque song id** (never the filename → no title spoilers).
- **Teams:** phone-per-player grouped into teams; one shared timeline per team; per-player tokens; rotating placer.
- **AI services (LAN, optional, from M6):** **Ollama** at `SONGSTER_OLLAMA_URL` (`:11434`) for scripts; a **Voice API** at `SONGSTER_VOICE_API_URL` (`:3200`) for character voices. A global **GPU lock** serializes them. Everything **degrades gracefully** — if a service is down the game still plays with synth SFX + on-screen reveal.
- **Real-time:** Socket.IO; shared event types in `shared/src/events.ts`; every client→server payload validated with `zod`.
- **Mobile-first** is non-negotiable for player screens: design for a one-handed thumb at 375px, then scale up.

## How to work in this repo

1. **Work milestone-by-milestone** (see table). Each ends with a "stop and try it" — that's the definition of done for the session. Don't jump ahead.
2. **Server is the source of truth.** The client renders a role-tailored, spoiler-safe `room:state` view; never duplicate game logic on the client, and never send an unrevealed song's year/title/artist.
3. **TypeScript strict, no `any`** unless flagged `// TODO: tighten`. Validate every socket payload server-side with `zod`.
4. **Tests where they earn it:** pure reducers in `game.ts`/`rules.ts` (placement correctness, rotation, tokens, steal, sampling) via native `node --test`. No UI snapshots.
5. **No new top-level dependencies without explicit OK.** Approved beyond the base stack: `music-metadata` (server), `framer-motion` + `canvas-confetti` (client).
6. **Keep `CLAUDE.md` current**; don't write other docs unless asked.

## Coding conventions

- kebab-case files (`emcee-service.ts`); PascalCase React components (`Hub.tsx`).
- Server is NodeNext: **relative imports use `.js` extensions**. Cross-package imports use `@songster/shared/events`.
- `pino` everywhere on the server (info = room lifecycle, debug = socket traffic, warn = recoverable, error = paging-worthy).
- React: function components + hooks; Tailwind classes only (no CSS files beyond `index.css`).
- Timestamps are ms-since-epoch `number`s.

## Milestones (each ends with "stop and try it")

| M | Deliverable | Done means |
|---|---|---|
| M0 | Scaffold monorepo + stack + migrations + launcher | `pnpm dev` up; a LAN phone round-trips a Socket.IO ping; migrations create tables. |
| M1 | Library ingest: scan `SONGSTER_MUSIC_DIR`, ID3 via `music-metadata`, art, suspicious-year flags | Scanning the real folder populates `songs` with raw years + flags. |
| M2 | Curation UI (`/library`): preview, fix year, set snippet start, approve/exclude, filters | Curate ~30 songs into an approved pool with correct years. |
| M3 | Rooms + lobby + teams: admin create, hub QR, phones join + team, live roster | 3 phones join two teams; all screens show the live roster. |
| M4 | Core turn loop + hub snippet audio (opaque ids), placement, reveal flip, correctness, win | Play a full game to 10 with audio only on the hub. |
| M5 | Tokens: Skip + Steal flows and resolution | Skip a song; successfully steal a card. |
| M6 | Round emcee: Ollama script + Voice API TTS + gpu-lock, pre-generated during placement, fallback ladder | Each reveal is voiced; pulling the Voice API still lets the game flow. |
| M7 | Showcase segments + theme engine (bg video + music) at peaks | A steal and the finale each trigger a themed produced segment. |
| M8 | Consensus + polish: suggestions, timers, reconnect, Framer Motion flips, confetti, scoreboard | A playtest that "feels like a show." |
| M9 | Hardening: admin dashboard, error states, PWA, optional bot teams | Real party playtest on the LAN. |

## Dev environment

- **Conda env:** `conda env create --prefix ./.conda-env --file ./environment.yml` (Node 22 + pnpm 9), then `conda activate ./.conda-env`.
- **Start dev:** `./start-songster.sh` (activates env, frees repo ports, migrates, `pnpm dev`).
- **Ports:** client `4337`, server `4338`. Routes: `/hub/:code`, `/admin`, `/library`, `/?code=ABCD`.
- **Config env:** `SONGSTER_MUSIC_DIR`, `SONGSTER_OLLAMA_URL`, `SONGSTER_VOICE_API_URL`, `SONGSTER_SHOWCASE_EVERY_N`, `SONGSTER_SERVER_PORT`, `SONGSTER_CLIENT_PORT`.

## Things to ask the user before doing

- Any change to a locked decision above.
- Adding any dependency not named in this file.
- Bumping major versions of Node, React, or infra deps.
- The host model + default character voice/persona (needed at M6); the music folder path (needed at M1).

## Notes log (append one line per session)

<!-- Format: `YYYY-MM-DD — short note about decisions or surprises`. -->

2026-06-04 — M0 scaffold: pnpm monorepo + codex-matched stack, SQLite migration runner, conda env, start-songster.sh, ports 4337/4338, Socket.IO hello + ping/pong.
2026-06-04 — M1 ingest: `assets/music/<genre>/` scanner via music-metadata → `songs` table (42 ingested), genre from folder name, suspicious-year flags (reissue/remix/live/missing/various/artist-outlier), filename-title fallback, embedded-art extraction to `data/art/`, snippet-start defaults, idempotent re-scan. `pnpm scan`; node:test for the heuristic. NOTE: current library clusters ~2001–2006 — a timeline game needs wider decade spread.
2026-06-04 — M2 curation: `/library` REST API (list/stats/PATCH/scan) + opaque-id audio range streaming & art (`audio-stream.ts`, reused by the hub at M4). Optional Ollama year-assist (`ai/ollama-service.ts` + `ai/year-suggester.ts` via `ai/gpu-lock.ts`); user's `gemma4:latest` correctly dated 'Take On Me' → 1985 high-confidence. React curation screen (`routes/Library.tsx`, tiny path router in `App.tsx`) with filters/search/sort, inline year+snippet edit, snippet preview, Suggest, approve/exclude. Verified populated end-to-end via the preview (run BOTH server+client inside it — its proxy is network-namespaced). `.claude/launch.json` added for previews.
2026-06-04 — Music DB enrichment (user request): genre is now ONE-TO-MANY (`song_genres`) plus free-form **meta tags** (`song_tags`), migration `0003`, seeded from folder + ID3 and fully curator-editable — decoupling the playable library from raw ID3. API gains `genre`/`tag` list filters + `GET /api/library/facets`; `songUpdateSchema` takes `genres`/`tags` arrays (replace). Curation UI shows genre/tag chips, a `+ tag` adder, and genre/tag facet dropdowns. Purpose: dynamic deck generation (filter a game by genre/tag/decade) — wire into room config at M3/M4.
2026-06-04 — M3 rooms/lobby/teams: shared room contract (`shared/src/room.ts`) + socket events (ack-based create/join). In-memory `RoomManager` (`server/src/room-service.ts`): 4-char codes (unambiguous alphabet), auto-balanced teams (Red/Blue/Green/Gold), reconnect-by-name, deck-filter pool sizing. `server/src/socket.ts` consolidates hello/ping + room handlers (create/join/setTeam/start/hub:join), broadcasting spoiler-safe `room:state`. Client: Admin (`/admin` config + deck genre/tag filter from facets, code+links, roster, start), Hub (`/hub/:code` big code + QR via `qrcode` + live roster), Join (`/?code=` mobile-first name → team switcher). Verified in preview: room 7CHA, 4 players auto-balanced + team switch, live roster on hub. Rooms are in-memory; persistence deferred to M9.
2026-06-05 — M4 core turn loop + hub audio: pure rules (`server/src/game.ts` + `game.test.ts` — placement correctness w/ ties+edges, insert, win, rotation) and deck-filtered sampler (`sampling.ts`). Game state machine lives in `RoomManager`: seed card per team, rotating team+placer, snippet pushed to hubs only via `audio:play`, reveal with correctness, auto-advance after 5s (`REVEAL_MS`), win at `targetLength`. Spoiler-safe `GameView` rides in `room:state` (mystery card carries no year/title; audio uses opaque song ids). Client: hub audio engine (`client/src/audio.ts` — snippet playback w/ fades + zero-asset synth SFX + tap-to-unlock), `HubGame` (mystery disc → reveal card, per-team timelines, scoreboard, winner), `Play` (mobile placement slots + reveal + scoreboard), `Join` renders `Play` once playing. Verified end-to-end in preview: 16 songs approved (1980–2005 spread), game started, Red placed 'Get Free' 2003 (correct via tie), scored 2/10, rotated to Blue; player placement UI confirmed. NOTE: approved a real ~16-song pool in the dev DB so M4 is playable.
2026-06-05 — Fixes/enhancements (user feedback): (1) RECONNECTION (fixes "stuck after placing") — `RoomManager.join` now re-associates a socket by name even mid-game; client `Join` re-emits join on every socket reconnect; per-turn `turnId` in `ActiveTurnView` resets the placement UI (solo = same placer twice in a row); active-placer disconnect auto-advances/pauses; reconnect resumes a paused turn. (2) BOTS — `admin:addBot`/`admin:removeBot`, random-placing bots auto-resolve their turn after a 1.8–3.4s delay (solo playtesting), 🤖 in roster; works as a full all-bot game. (3) CURATION — title/artist/album are inline-editable (`album` added to `songUpdateSchema` + `SCALAR_COLUMN`). Verified in preview: 4-bot game auto-played a sorted timeline to Red 4/10 with album art on the reveal; curation edit fields render. Single-placer-per-turn is the model; teammate suggestions/consensus is M8.
2026-06-05 — M5 tokens: per-player tokens (config `tokensPerPlayer`, default 2, set at game start, surfaced in `PlayerView`). SKIP (`player:useSkip`) — active placer spends a token to draw a NEW song for the same placer (new `turnId`). STEAL (`player:stealPlace`) — an opponent spends a token to place the song on their OWN timeline; resolves at the active placer's reveal: the stealer wins the card only if the placer was WRONG and the stealer's placement is correct (`TurnResultView.steal`, can also win the game). UI: Skip button on the placer screen, Steal button → amber steal-mode placement on opponent screens, steal status on the hub + steal result on the reveal. Verified in preview: skip 2→1 + new song/same placer; steal arm 2→1 + correct resolution (placer-wrong + stealer-wrong = no award); Steal button + steal-placement screenshots.
2026-06-05 — M6 emcee + extras. EMCEE: `ai/voice-generator-service.ts` (Voice API client — chars now carry meta tags; per-cue WAV cached to `server/cache/reveal-audio`, served at `/reveal-audio`, gpu-locked) + `ai/emcee-service.ts` (one host per game, random among host-tagged voices [wise/narrator/voice-over/...], Ouldeon-weighted; scripts a <18-word reveal line via Ollama in the host's persona; voices it). Pre-generated during placement (`ActiveTurn.emceePromise/emceeClip`), delivered at reveal via `emcee:play` to hubs ONLY (spoiler-safe; reveal extends to fit the clip). Fallback ladder: Ollama line → template line → no-voice + on-screen + SFX. Hub plays the clip + shows a caption (🎙 host). `pnpm --filter @songster/server emcee:smoke`. IMPORTANT: voice gen only works when the server runs in the HOST network namespace (reaches Ollama :11434 + Voice :3200) — i.e. `./start-songster.sh`, NOT inside the Claude preview's isolated namespace (there it degrades to voiceless, which is the intended fallback). Smoke proved it: host 'Morgan Freeman', real Ollama line + template fallback on a cold call, both voiced. REPLAY: `player:replay` re-plays the snippet on the hub, gated by `ActiveTurn.snippetEndsAt`→`snippetPlayingUntil` (rejected while playing, works after); 'Play again' button on player screens. CURATION IMAGE: `POST /api/library/songs/:id/art` (raw image body) → `data/art`; 🖼 button on the art thumbnail opens a file picker (cache-busted). All verified in preview (replay gating, art upload, voiceless graceful flow).
