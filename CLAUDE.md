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
