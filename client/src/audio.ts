// Hub audio: song-snippet playback (with fades) + zero-asset synthesized SFX.
// The hub is the sole audio source during gameplay.

import confetti from "canvas-confetti";

/** Celebrate a correct placement — a quick burst from both lower corners. */
export function burstConfetti(): void {
  const opts = { particleCount: 70, spread: 70, startVelocity: 45, ticks: 200 } as const;
  void confetti({ ...opts, origin: { x: 0.1, y: 0.9 }, angle: 60 });
  void confetti({ ...opts, origin: { x: 0.9, y: 0.9 }, angle: 120 });
}

/** A longer celebratory shower for the winner's circle. */
export function winConfetti(): void {
  const end = Date.now() + 2600;
  const colors = ["#fbbf24", "#34d399", "#60a5fa", "#f472b6", "#a78bfa"];
  const frame = () => {
    void confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0, y: 0.85 }, colors });
    void confetti({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1, y: 0.85 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}

const SILENT_AUDIO = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA";

let ctx: AudioContext | null = null;
let unlocked = false;
let snippetStopTimer: ReturnType<typeof setTimeout> | null = null;

const snippetEl = new Audio(SILENT_AUDIO);
const voiceEl = new Audio(SILENT_AUDIO);
const bgEl = new Audio(SILENT_AUDIO);
const distractionEl = new Audio(SILENT_AUDIO);
const sfxCorrectEl = new Audio("/effects/correct.mp3");
const sfxIncorrectEl = new Audio("/effects/incorrect.mp3");
const sfxTimesUpEl = new Audio("/effects/times-up.mp3");

function getCtx(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

export function audioUnlocked(): boolean {
  return unlocked;
}

/** Call from a user gesture (tap) to satisfy autoplay policies. */
export function unlockAudio(): void {
  unlocked = true;
  const context = getCtx();
  if (context.state !== "running") void context.resume();

  // Bless all audio elements synchronously inside this user gesture so Safari/iOS allows dynamic play
  for (const el of [snippetEl, voiceEl, bgEl, distractionEl, sfxCorrectEl, sfxIncorrectEl, sfxTimesUpEl]) {
    void el.play().then(() => {
      el.pause();
    }).catch(() => undefined);
  }
}

function fade(el: HTMLAudioElement, from: number, to: number, ms: number): void {
  const steps = 12;
  let i = 0;
  const id = setInterval(() => {
    i += 1;
    el.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
    if (i >= steps) clearInterval(id);
  }, ms / steps);
}

export function playSnippet(url: string, startS: number, lenS: number, maxVolume = 1): void {
  stopSnippet(false);
  if (!unlocked) return;
  const el = snippetEl;
  el.src = url;
  el.preload = "auto";
  el.volume = 0;

  const onMetadata = () => {
    el.onloadedmetadata = null;
    try {
      el.currentTime = startS;
    } catch {
      // ignore
    }
  };

  if (el.readyState >= 1) {
    onMetadata();
  } else {
    el.onloadedmetadata = onMetadata;
  }

  el.load();
  void el.play().catch(() => undefined);
  fade(el, 0, maxVolume, 400);

  snippetStopTimer = setTimeout(
    () => {
      fade(el, el.volume, 0, 500);
      setTimeout(stopSnippet, 520);
    },
    Math.max(800, lenS * 1000 - 500),
  );
}

export function stopSnippet(releaseConnection = true): void {
  if (snippetStopTimer !== null) {
    clearTimeout(snippetStopTimer);
    snippetStopTimer = null;
  }
  const el = snippetEl;
  el.oncanplay = null;
  el.onloadedmetadata = null;
  try {
    el.pause();
    if (releaseConnection) {
      el.src = SILENT_AUDIO;
    }
  } catch {
    // ignore
  }
}

/** Gracefully fade the snippet out (used at the reveal so it isn't an abrupt cut). */
export function fadeOutSnippet(ms = 1600): void {
  if (snippetStopTimer !== null) {
    clearTimeout(snippetStopTimer);
    snippetStopTimer = null;
  }
  fade(snippetEl, snippetEl.volume, 0, ms);
  setTimeout(stopSnippet, ms + 80);
}

/** Play a generated emcee voice clip (separate from the song snippet). `null` = caption-only. */
export function playVoiceUrl(url: string | null): void {
  stopVoice(false);
  if (url === null || !unlocked) return;
  const el = voiceEl;
  el.onended = null;
  el.onerror = null;
  el.src = url;
  el.volume = 1;
  el.load();
  void el.play().catch(() => undefined);
}

export function stopVoice(releaseConnection = true): void {
  const el = voiceEl;
  el.onended = null;
  el.onerror = null;
  try {
    el.pause();
    if (releaseConnection) {
      el.src = SILENT_AUDIO;
    }
  } catch {
    // ignore
  }
}

// ── showcase playback: a looped music bed + sequential voiced cues ──────────

let cueChain: { cancelled: boolean } | null = null;

export function startBgMusic(url: string, volume = 0.18): void {
  stopBgMusic(false);
  if (!unlocked) return;
  const el = bgEl;
  el.src = url;
  el.loop = true;
  el.volume = volume;
  el.load();
  void el.play().catch(() => undefined);
}

export function stopBgMusic(releaseConnection = true): void {
  try {
    bgEl.pause();
    if (releaseConnection) {
      bgEl.src = SILENT_AUDIO;
    }
  } catch {
    // ignore
  }
}

/** Play voiced cues in order. `onIndex(i)` advances captions; `onIndex(-1)` signals done. */
export function playCues(cues: Array<{ audioUrl: string | null; durationMs: number; songId?: string; snippetStartS?: number; snippetLenS?: number }>, onIndex: (index: number) => void): void {
  stopVoice(false);
  const token = { cancelled: false };
  cueChain = token;
  let i = 0;
  const next = () => {
    if (token.cancelled) return;
    if (i >= cues.length) {
      onIndex(-1);
      return;
    }
    const cue = cues[i]!;
    onIndex(i);
    const advance = () => {
      i += 1;
      next();
    };
    if (cue.audioUrl !== null && unlocked) {
      const el = voiceEl;
      el.src = cue.audioUrl;
      el.volume = 1;
      el.onended = advance;
      el.onerror = () => window.setTimeout(advance, 400);
      el.load();
      void el.play().catch(() => window.setTimeout(advance, cue.durationMs));

      // Play the background song snippet concurrently if present
      if (cue.songId) {
        const snippetUrl = "/audio/" + cue.songId;
        const snippetStart = cue.snippetStartS ?? 30;
        const snippetDuration = Math.max(3, cue.durationMs / 1000);
        playSnippet(snippetUrl, snippetStart, snippetDuration, 0.15);
      }
    } else {
      if (cue.songId && unlocked) {
        const snippetUrl = "/audio/" + cue.songId;
        const snippetStart = cue.snippetStartS ?? 30;
        const snippetDuration = Math.max(3, cue.durationMs / 1000);
        playSnippet(snippetUrl, snippetStart, snippetDuration, 0.15);
      }
      window.setTimeout(advance, cue.durationMs);
    }
  };
  next();
}

export function stopCues(): void {
  if (cueChain !== null) cueChain.cancelled = true;
  cueChain = null;
  stopVoice();
  stopSnippet();
  stopDistraction();
}

export function playDistraction(url: string): void {
  if (!unlocked) return;
  try {
    distractionEl.src = url;
    distractionEl.volume = 1.0;
    distractionEl.load();
    void distractionEl.play().catch(() => undefined);
  } catch {
    // ignore
  }
}

export function stopDistraction(): void {
  try {
    distractionEl.pause();
    distractionEl.src = SILENT_AUDIO;
  } catch {
    // ignore
  }
}

interface Tone {
  f: number;
  d: number;
  g: number;
  t?: OscillatorType;
  o?: number;
}

const SFX = {
  turn: [
    { f: 784, d: 0.09, g: 0.05, o: 0 },
    { f: 1046, d: 0.14, g: 0.05, o: 0.11 },
  ],
  reveal: [
    { f: 262, d: 0.15, g: 0.06, o: 0 },
    { f: 330, d: 0.16, g: 0.07, o: 0.1 },
    { f: 523, d: 0.24, g: 0.08, o: 0.2 },
  ],
  // Bright, unmistakable "ding-ding-ding!" rising major arpeggio.
  correct: [
    { f: 659, d: 0.13, g: 0.13, o: 0 },
    { f: 880, d: 0.13, g: 0.13, o: 0.12 },
    { f: 1046, d: 0.13, g: 0.13, o: 0.24 },
    { f: 1318, d: 0.34, g: 0.15, o: 0.36 },
  ],
  // Classic descending "wah-wah" buzzer — clearly a miss.
  wrong: [
    { f: 233, d: 0.22, g: 0.12, t: "sawtooth" as OscillatorType, o: 0 },
    { f: 196, d: 0.22, g: 0.12, t: "sawtooth" as OscillatorType, o: 0.2 },
    { f: 155, d: 0.45, g: 0.13, t: "sawtooth" as OscillatorType, o: 0.4 },
  ],
  win: [
    { f: 392, d: 0.14, g: 0.07, o: 0 },
    { f: 523, d: 0.14, g: 0.07, o: 0.14 },
    { f: 659, d: 0.14, g: 0.07, o: 0.28 },
    { f: 784, d: 0.32, g: 0.08, o: 0.42 },
  ],
} satisfies Record<string, Tone[]>;

export type SfxName = keyof typeof SFX | "times-up";

export function playSfx(name: SfxName): void {
  if (!unlocked) return;
  if (name === "correct") {
    sfxCorrectEl.currentTime = 0;
    sfxCorrectEl.volume = 0.8;
    void sfxCorrectEl.play().catch(() => undefined);
  } else if (name === "wrong") {
    sfxIncorrectEl.currentTime = 0;
    sfxIncorrectEl.volume = 0.8;
    void sfxIncorrectEl.play().catch(() => undefined);
  } else if (name === "times-up") {
    sfxTimesUpEl.currentTime = 0;
    sfxTimesUpEl.volume = 0.8;
    void sfxTimesUpEl.play().catch(() => undefined);
  } else {
    const context = getCtx();
    if (context.state !== "running") return;
    const now = context.currentTime + 0.01;
    for (const tone of SFX[name as keyof typeof SFX]) {
      scheduleTone(context, now + (tone.o ?? 0), tone);
    }
  }
}

function scheduleTone(context: AudioContext, at: number, tone: Tone): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = tone.t ?? "sine";
  osc.frequency.setValueAtTime(tone.f, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(tone.g, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.d);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start(at);
  osc.stop(at + tone.d + 0.02);
}
