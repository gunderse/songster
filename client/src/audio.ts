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

let ctx: AudioContext | null = null;
let unlocked = false;
let snippetEl: HTMLAudioElement | null = null;
let snippetStopTimer: ReturnType<typeof setTimeout> | null = null;

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

export function playSnippet(url: string, startS: number, lenS: number): void {
  stopSnippet();
  if (!unlocked) return;
  const el = new Audio();
  el.src = url;
  el.preload = "auto";
  el.volume = 0;
  snippetEl = el;

  const onReady = () => {
    try {
      el.currentTime = startS;
    } catch {
      // seeking may be unsupported until more data loads; fall back to start
    }
    void el.play().catch(() => undefined);
    fade(el, 0, 1, 400);
    snippetStopTimer = setTimeout(
      () => {
        fade(el, el.volume, 0, 500);
        setTimeout(stopSnippet, 520);
      },
      Math.max(800, lenS * 1000 - 500),
    );
  };
  el.addEventListener("canplay", onReady, { once: true });
  el.load();
}

export function stopSnippet(): void {
  if (snippetStopTimer !== null) {
    clearTimeout(snippetStopTimer);
    snippetStopTimer = null;
  }
  if (snippetEl !== null) {
    try {
      snippetEl.pause();
    } catch {
      // ignore
    }
    snippetEl = null;
  }
}

/** Gracefully fade the snippet out (used at the reveal so it isn't an abrupt cut). */
export function fadeOutSnippet(ms = 1600): void {
  if (snippetStopTimer !== null) {
    clearTimeout(snippetStopTimer);
    snippetStopTimer = null;
  }
  const el = snippetEl;
  if (el === null) return;
  fade(el, el.volume, 0, ms);
  setTimeout(() => {
    if (snippetEl === el) stopSnippet();
  }, ms + 80);
}

let voiceEl: HTMLAudioElement | null = null;

/** Play a generated emcee voice clip (separate from the song snippet). `null` = caption-only. */
export function playVoiceUrl(url: string | null): void {
  stopVoice();
  if (url === null || !unlocked) return;
  const el = new Audio(url);
  el.volume = 1;
  voiceEl = el;
  void el.play().catch(() => undefined);
}

export function stopVoice(): void {
  if (voiceEl !== null) {
    try {
      voiceEl.pause();
    } catch {
      // ignore
    }
    voiceEl = null;
  }
}

// ── showcase playback: a looped music bed + sequential voiced cues ──────────

let bgEl: HTMLAudioElement | null = null;
let cueChain: { cancelled: boolean } | null = null;

export function startBgMusic(url: string, volume = 0.18): void {
  stopBgMusic();
  if (!unlocked) return;
  const el = new Audio(url);
  el.loop = true;
  el.volume = volume;
  bgEl = el;
  void el.play().catch(() => undefined);
}

export function stopBgMusic(): void {
  if (bgEl !== null) {
    try {
      bgEl.pause();
    } catch {
      // ignore
    }
    bgEl = null;
  }
}

/** Play voiced cues in order. `onIndex(i)` advances captions; `onIndex(-1)` signals done. */
export function playCues(cues: Array<{ audioUrl: string | null; durationMs: number }>, onIndex: (index: number) => void): void {
  stopVoice();
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
      const el = new Audio(cue.audioUrl);
      el.volume = 1;
      voiceEl = el;
      el.addEventListener("ended", advance, { once: true });
      el.addEventListener("error", () => window.setTimeout(advance, 400), { once: true });
      void el.play().catch(() => window.setTimeout(advance, cue.durationMs));
    } else {
      window.setTimeout(advance, cue.durationMs);
    }
  };
  next();
}

export function stopCues(): void {
  if (cueChain !== null) cueChain.cancelled = true;
  cueChain = null;
  stopVoice();
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

export type SfxName = keyof typeof SFX;

export function playSfx(name: SfxName): void {
  if (!unlocked) return;
  const context = getCtx();
  if (context.state !== "running") return;
  const now = context.currentTime + 0.01;
  for (const tone of SFX[name]) {
    scheduleTone(context, now + (tone.o ?? 0), tone);
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
