# Songster 🎵

```
conda activate ./.conda-env
./start-songster.sh
```

Songster is a LAN-only, theater-style web party game — a digital reimagining of *Hitster* with **no cards and no QR-on-cards**. 

Teams hear a song snippet on a shared **hub** screen (e.g. your TV or computer monitor) and place it chronologically on their team's timeline. The first team to build a correct timeline of 7 (or 10) songs wins the game. 

The game features a **generative AI game-show host**: a persistent host emcees the year reveal every round, complete with fully voiced Multi-Character Showcase segments at dramatic high points (steals, lead changes, streaks, and the finale).

---

## Architecture Overview

Songster is a pnpm monorepo consisting of:
- `shared/` (`@songster/shared`): Common TypeScript models, room contracts, schemas, and Socket.IO event types.
- `server/` (`@songster/server`): Express server, Socket.IO gateway, SQLite database, and background AI services (Ollama & Voice generation).
- `client/` (`@songster/client`): React SPA built with Vite + Tailwind CSS v4, Socket.IO client, and Framer Motion.

---

## Quick Start (Local Development)

### 1. Requirements
- **Conda** (Miniconda or Anaconda) installed on your system.
- Node.js >= v22.13 (packaged inside the project's local Conda environment).

### 2. Environment Setup
Create the project-local environment (this installs the correct Node.js version, pnpm, and Python dependencies automatically inside the `.conda-env` directory):
```bash
conda env create --prefix ./.conda-env --file ./environment.yml
```

If you ever see a **pnpm node version error** like:
`ERROR: This version of pnpm requires at least Node.js v22.13`
it is because your active shell is using a global system version of Node instead of the Conda environment node. Always activate the environment before running commands manually:
```bash
conda activate ./.conda-env
```

### 3. Launching the App
Simply run the launcher script:
```bash
./start-songster.sh
```
This launcher:
1. Automatically activates the project's local Conda environment (updating your `PATH` and active Node/pnpm versions).
2. Installs workspace dependencies.
3. Automatically scans your network to detect your local LAN IP address.
4. Frees up the default ports (`4337` and `4338`) if they are in use by previous runs.
5. Runs database migrations.
6. Starts the client and server dev processes concurrently.

Once running, the terminal will print URLs you can visit:
- **Hub (Large TV Screen)**: `http://<your-lan-ip>:4337/hub/ABCD`
- **Admin Panel**: `http://<your-lan-ip>:4337/admin`
- **Library/Curation**: `http://<your-lan-ip>:4337/library`
- **Player Screen (Phones)**: `http://<your-lan-ip>:4337/?code=ABCD`

---

## Audio and Music Sources

### Opaque Audio Stream
To avoid spoilers, songs are streamed to the hub screen from `/audio/:id/stream` using a randomized SHA-256 opaque ID derived from the path. The phone screens are completely silent and never receive the song title, artist, or release year before the reveal.

### Library Scanners
1. **Local Files**: Place `.mp3`, `.m4a`, or `.flac` files into `assets/music/<genre>/`. Running a scan (via the curation tab or `pnpm scan`) will extract ID3 tags, album art, and import them.
2. **Plex Server**: Configure your local Plex Media Server details on the **Admin** panel (under "Connect Plex" settings) or define env variables:
   - `SONGSTER_PLEX_URL`: `http://<plex-lan-ip>:32400`
   - `SONGSTER_PLEX_TOKEN`: Your Plex token
   - `SONGSTER_PLEX_LIBRARY_NAME`: e.g. `"Music"`
   Scanning will index tracks directly from your Plex library.

---

## AI Game-Show Host (Emcee & Showcases)

Songster runs entirely offline on your LAN:
- **Scripts**: Generated via a local **Ollama** server running `gemma4:latest` (configurable via `SONGSTER_OLLAMA_MODEL`).
- **Voices**: Synthesized using a **Voice API** (a TTS container running on port `3200`).
- **GPU Lock**: Emcee script and audio generation are serialized under a single lock so host actions never overlap on a single GPU.

If AI services are down, the game automatically degrades gracefully to text-only captions and retro synthesizer sound effects.

## Ideas
- Waiting for the reveal we need to see something more exciting on the hub screen instead of just a floating question mark.
- End of game recap showing songs?
- slot selection on the phone UI the button slot show stretch to fill the horizontal space available.  
- at the end of game need a button to play another game
- better plex import - working images confirmed year, auto tagging?
