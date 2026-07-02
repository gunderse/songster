import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import QRCode from "qrcode";

import type { ShowcaseView } from "@songster/shared/game";

import { audioStreamUrl } from "../api";
import {
  audioUnlocked,
  burstConfetti,
  fadeOutSnippet,
  continueRecentSnippet,
  playCues,
  playSfx,
  playSnippet,
  playVoiceUrl,
  startBgMusic,
  stopBgMusic,
  playDistraction,
  stopDistraction,
  stopCues,
  stopSnippet,
  stopVoice,
  unlockAudio,
  winConfetti,
} from "../audio";
import { HubGame } from "../components/HubGame";
import { Roster } from "../components/Roster";
import { ShowcaseOverlay } from "../components/ShowcaseOverlay";
import { Waveform } from "../components/Waveform";
import { socket } from "../socket";
import { joinUrl, useRoomState } from "../useRoom";

export function Hub({ code }: { code: string }) {
  const room = useRoomState();
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioReady, setAudioReady] = useState(audioUnlocked());
  const [emcee, setEmcee] = useState<{ hostName: string; text: string } | null>(null);
  const [showcase, setShowcase] = useState<ShowcaseView | null>(null);
  const [showcaseCue, setShowcaseCue] = useState(0);
  const [audioActive, setAudioActive] = useState(false);
  const pendingSnippetRef = useRef<{ url: string; startS: number; lenS: number; until: number } | null>(null);
  const voiceTimerRef = useRef<number | undefined>(undefined);
  const audioOffTimerRef = useRef<number | undefined>(undefined);
  const prevCountdownEndsAtRef = useRef<number | null | undefined>(undefined);

  function setAudioFor(ms: number) {
    setAudioActive(true);
    if (audioOffTimerRef.current !== undefined) window.clearTimeout(audioOffTimerRef.current);
    audioOffTimerRef.current = window.setTimeout(() => setAudioActive(false), ms);
  }

  useEffect(() => {
    QRCode.toDataURL(joinUrl(code), { width: 520, margin: 1 }).then(setQr).catch(() => undefined);

    function register() {
      socket.emit("hub:join", { code }, (res) => setError(res.ok ? null : res.error));
    }
    function onAudio(payload: { songId: string; startS: number; lenS: number }) {
      if (voiceTimerRef.current !== undefined) window.clearTimeout(voiceTimerRef.current);
      setEmcee(null);
      stopVoice();
      stopCues();
      stopBgMusic();
      stopDistraction();
      setShowcase(null);
      const url = audioStreamUrl(payload.songId);
      // Remember it so a late audio-unlock can replay the in-progress snippet.
      pendingSnippetRef.current = { url, startS: payload.startS, lenS: payload.lenS, until: Date.now() + payload.lenS * 1000 + 1000 };
      playSfx("turn");
      playSnippet(url, payload.startS, payload.lenS);
      setAudioFor(payload.lenS * 1000);
    }
    function onEmcee(payload: { audioUrl: string | null; hostName: string; text: string }) {
      // Fade the song out, then let the host speak after a beat (not an abrupt cut).
      // audioUrl null = caption-only fallback (Voice API failed); still show the line.
      fadeOutSnippet(1600);
      stopDistraction();
      setEmcee({ hostName: payload.hostName, text: payload.text });
      if (voiceTimerRef.current !== undefined) window.clearTimeout(voiceTimerRef.current);
      if (payload.audioUrl !== null) {
        voiceTimerRef.current = window.setTimeout(() => playVoiceUrl(payload.audioUrl), 1400);
        setAudioFor(25_000);
      }
    }
    function onShowcase(view: ShowcaseView) {
      fadeOutSnippet(900);
      stopVoice();
      stopDistraction();
      setEmcee(null);
      setShowcase(view);
      setShowcaseCue(0);
      if (view.bgMusicUrl !== null) startBgMusic(view.bgMusicUrl, 0.18);
      const total = view.cues.reduce((sum, c) => sum + c.durationMs, 0) + 2000;
      setAudioFor(total);
      playCues(view.cues, (i) => {
        if (i === -1) {
          window.setTimeout(() => {
            stopBgMusic();
            setShowcase(null);
            setAudioActive(false);
          }, 1400);
        } else {
          setShowcaseCue(i);
        }
      }, view.reason === "finale");
    }
    function onDistraction(payload: { url: string }) {
      playDistraction(payload.url, () => {
        socket.emit("hub:distractionFinished");
      });
    }

    function onDestroyed() {
      setError("This room has been destroyed by the host.");
    }
    socket.on("connect", register);
    socket.on("audio:play", onAudio);
    socket.on("emcee:play", onEmcee);
    socket.on("showcase:play", onShowcase);
    socket.on("audio:distraction", onDistraction);
    socket.on("room:destroyed", onDestroyed);
    if (!socket.connected) socket.connect();
    else register();

    return () => {
      socket.off("connect", register);
      socket.off("audio:play", onAudio);
      socket.off("emcee:play", onEmcee);
      socket.off("showcase:play", onShowcase);
      socket.off("audio:distraction", onDistraction);
      socket.off("room:destroyed", onDestroyed);
      if (voiceTimerRef.current !== undefined) window.clearTimeout(voiceTimerRef.current);
      if (audioOffTimerRef.current !== undefined) window.clearTimeout(audioOffTimerRef.current);
      stopSnippet();
      stopVoice();
      stopCues();
      stopBgMusic();
    };
  }, [code]);

  function togglePause() {
    if (!room || !room.game) return;
    if (room.game.paused) {
      socket.emit("room:resume", { code });
    } else {
      socket.emit("room:pause", { code });
    }
  }

  function skipSong() {
    socket.emit("hub:skipSong");
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space" || e.key === " ") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
          return;
        }
        e.preventDefault();
        togglePause();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [room, code]);

  useEffect(() => {
    if (room?.game?.paused) {
      stopSnippet();
      stopVoice();
      stopCues();
      stopBgMusic();
      setAudioActive(false);
    }
  }, [room?.game?.paused]);

  // Background music for Lobby / Winner Circle
  useEffect(() => {
    if (!audioReady) {
      return;
    }
    const inLobbyVal = room === null || room.status === "lobby";
    const countdownEndsAtVal = room?.game?.countdownEndsAt ?? null;
    const showWinner = room?.game !== null && room?.game !== undefined && room.game.winnerTeamId !== null;
    const playLobbyMusic = (inLobbyVal || showWinner) && countdownEndsAtVal === null && showcase === null;

    if (playLobbyMusic) {
      startBgMusic("/bgmusic/Songster.wav", 0.08);
    } else {
      // Transitioning to gameplay, showcase, or countdown
      stopBgMusic();
    }
  }, [room?.status, room?.game?.winnerTeamId, room?.game?.countdownEndsAt, showcase, audioReady]);

  // Reveal / win SFX (fire once per event).
  const lastResultRef = useRef<string | null>(null);
  const wonRef = useRef(false);
  useEffect(() => {
    const game = room?.game;
    if (game === null || game === undefined) return;
    const r = game.lastResult;
    const sig = r === null ? null : `${r.teamId}:${r.song.songId}:${r.placedIndex}:${r.correct}`;
    if (sig !== null && sig !== lastResultRef.current) {
      lastResultRef.current = sig;
      fadeOutSnippet(2000);
      const won = r!.correct || r!.steal?.correct === true;
      if (r!.timeout) {
        playSfx("times-up");
      } else {
        playSfx(won ? "correct" : "wrong");
      }
      if (won) burstConfetti();
    }
    if (game.winnerTeamId !== null && !wonRef.current) {
      wonRef.current = true;
      stopSnippet();
      playSfx("win");
      winConfetti();
    }
  }, [room]);

  // Clear emcee bubble/voice only when countdown transitions from non-null → null (intro finished or skipped)
  useEffect(() => {
    const current = room?.game?.countdownEndsAt ?? null;
    const prev = prevCountdownEndsAtRef.current;
    // prev === undefined means first render — skip
    if (prev !== undefined && prev !== null && current === null) {
      setEmcee(null);
      stopVoice();
    }
    prevCountdownEndsAtRef.current = current;
  }, [room?.game?.countdownEndsAt]);

  const prevPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    const activeTurn = room?.game?.activeTurn;
    const phase = activeTurn?.phase ?? null;
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    if (phase === "suspense" && prevPhase === "placing" && pendingSnippetRef.current !== null) {
      const pending = pendingSnippetRef.current;
      continueRecentSnippet(pending.url, pending.startS);
    }
  }, [room?.game?.activeTurn?.phase]);

  if (error !== null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-950 text-slate-100">
        <h1 className="text-3xl font-black">Room {code}</h1>
        <p className="text-rose-400">{error}</p>
        <p className="text-slate-500">Create it from the <a href="/admin">Admin screen</a> first.</p>
        <a href="/admin" className="mt-4 rounded-xl bg-slate-900 border border-white/10 px-5 py-2.5 text-sm font-semibold hover:bg-slate-800 transition">
          Go to Admin Screen
        </a>
      </main>
    );
  }

  const inLobby = room === null || room.status === "lobby";
  const countdownEndsAt = room?.game?.countdownEndsAt ?? null;
  const countdownReady = room?.game?.countdownReady ?? false;
  const commentaryPending = room?.game?.commentaryPending ?? false;
  const playerCount = room?.players.filter((p) => p.connected || p.isBot).length ?? 0;
  const minSongsNeeded = room ? room.teams.length + 1 : 0;
  const hasEnoughSongs = room ? room.poolSize >= minSongsNeeded : false;
  const canStart = inLobby && playerCount >= 1 && hasEnoughSongs;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-base p-6 text-text-main sm:p-10 font-sans select-none">
      {/* Top Bulb Strip */}
      <div className="absolute top-0 left-0 w-full h-[10px] bg-[radial-gradient(circle,#ffd23f_0_3px,transparent)] [background-size:26px_10px] opacity-80 z-20" />

      {/* Back to Admin Button */}
      <a
        href="/admin"
        className="fixed top-6 left-6 z-40 flex items-center justify-center w-10 h-10 rounded-full border border-line bg-surface hover:bg-surface-2 text-text-dim hover:text-text-main transition shadow-lg backdrop-blur-md cursor-pointer hover:scale-105 active:scale-95"
        title="Back to Admin"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
      </a>

      {/* Glowing glassmorphic ambient backdrops */}
      <div className="absolute top-[-20%] left-[-20%] h-[70%] w-[70%] rounded-full bg-accent-magenta/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] h-[70%] w-[70%] rounded-full bg-gold-yellow/5 blur-[120px] pointer-events-none" />

      {/* Small, non-obscuring audio-unlock banner */}
      {!audioReady && (
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            setAudioReady(true);
            const pending = pendingSnippetRef.current;
            if (pending !== null && pending.until > Date.now()) {
              playSnippet(pending.url, pending.startS, pending.lenS);
              setAudioFor(pending.lenS * 1000);
            }
          }}
          className="fixed bottom-6 right-6 z-40 rounded-full bg-accent-magenta hover:bg-magenta-soft px-6 py-3.5 text-sm font-bold text-[#1a1110] shadow-[0_12px_30px_rgba(255,45,120,0.4)] hover:scale-105 active:scale-95 transition"
        >
          🔊 Tap to enable audio
        </button>
      )}

      {showcase !== null && <ShowcaseOverlay view={showcase} cueIndex={showcaseCue} />}

      {/* Pre-game countdown overlay */}
      {countdownEndsAt !== null && <Countdown endsAt={countdownEndsAt} ready={countdownReady} emcee={emcee} code={code} />}

      {/* Paused Overlay */}
      {room?.game?.paused && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-bg-deep/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 md:gap-8 max-w-3xl w-full bg-surface border border-line p-6 md:p-8 rounded-3xl shadow-[0_30px_80px_rgba(0,0,0,0.45)] items-center">
            {/* Left Column: Pause Controls */}
            <div className="flex flex-col items-center text-center gap-4">
              <div className="relative flex items-center justify-center w-20 h-20 bg-accent-magenta rounded-full text-[#1a1110] text-3xl font-bold shadow-[0_12px_30px_rgba(255,45,120,0.4)]">
                <span className="animate-pulse">⏸</span>
              </div>
              <h2 className="text-3xl font-display font-black uppercase text-text-main tracking-wide">
                Show Paused
              </h2>
              <p className="text-sm text-text-dim">
                The game is temporarily paused.
              </p>
              <button
                type="button"
                onClick={togglePause}
                className="mt-2 w-full rounded-xl bg-accent-magenta hover:bg-magenta-soft text-[#1a1110] font-display font-black text-sm px-6 py-3 transition active:scale-95 cursor-pointer shadow-lg"
              >
                Resume Game
              </button>
              <div className="text-[10px] font-mono text-text-faint uppercase tracking-widest font-bold animate-pulse">
                Or Press Spacebar
              </div>
            </div>

            {/* Vertical Divider for larger screens */}
            <div className="hidden md:block self-stretch w-px bg-line" />
            <div className="h-px w-full bg-line md:hidden" />

            {/* Right Column: Connection info for new players */}
            <div className="flex flex-col items-center text-center gap-4">
              <div className="text-xs font-mono font-bold uppercase tracking-[0.25em] text-text-faint">Want to join?</div>
              <div
                className="leading-none tracking-[0.15em] text-accent-magenta font-display font-black text-4xl md:text-5xl"
                style={{ textShadow: "0 0 30px rgba(255,45,120,0.25)" }}
              >
                {code}
              </div>
              
              {qr !== null ? (
                <div className="h-44 w-44 bg-white p-3 rounded-2xl flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-200 shrink-0">
                  <img src={qr} alt={`Join ${code}`} className="h-full w-full rounded-lg" />
                </div>
              ) : (
                <div className="h-44 w-44 bg-surface rounded-2xl flex items-center justify-center text-text-faint text-xs border border-line">
                  Generating QR…
                </div>
              )}
              
              <p className="text-[11px] font-mono text-text-dim leading-relaxed max-w-[245px] uppercase tracking-wider">
                Scan QR or visit <span className="font-semibold text-text-main border-b border-accent-magenta/30">{window.location.host}</span> and enter code <span className="font-bold text-accent-magenta">{code}</span>
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 mx-auto max-w-6xl">
        {inLobby ? (
          <LobbyView
            code={code}
            qr={qr}
            room={room}
            canStart={canStart}
            playerCount={playerCount}
            hasEnoughSongs={hasEnoughSongs}
            minSongsNeeded={minSongsNeeded}
          />
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between text-text-dim border-b border-line pb-4 pt-2">
              <span className="text-xs font-mono font-bold uppercase tracking-[0.4em] text-text-faint">Songster · The Theater</span>
              <span className="flex items-center gap-3">
                <Waveform active={audioActive && !room?.game?.paused} />
                {room?.game && (
                  <button
                    type="button"
                    onClick={togglePause}
                    className={`rounded-xl border px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition duration-200 active:scale-95 cursor-pointer shadow-md ${
                      room.game.paused
                        ? "bg-emerald-600 border-emerald-500 text-white shadow-emerald-600/10 hover:bg-emerald-500"
                        : "bg-surface border-line text-text-dim shadow-slate-950/20 hover:bg-surface-2 hover:text-text-main"
                    }`}
                    title="Press Spacebar to toggle"
                  >
                    {room.game.paused ? "▶ Resume" : "⏸ Pause"}
                  </button>
                )}
                {room?.game && room.game.activeTurn && room.game.activeTurn.phase === "placing" && (
                  <button
                    type="button"
                    onClick={skipSong}
                    className="rounded-xl border border-line bg-surface text-text-dim hover:bg-surface-2 hover:text-kick-red hover:border-kick-red/50 px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition duration-200 active:scale-95 cursor-pointer shadow-md"
                    title="Skip the current song without deduction"
                  >
                    ⏭ Skip
                  </button>
                )}
                <span className="font-mono text-lg font-bold tracking-widest text-accent-magenta bg-surface-2 border border-line rounded-lg px-3 py-1 shadow-inner">{code}</span>
              </span>
            </div>
            <HubGame room={room} emcee={emcee} commentaryPending={commentaryPending} />
          </>
        )}
      </div>
    </main>
  );
}

function LobbyView({
  code,
  qr,
  room,
  canStart,
  hasEnoughSongs,
  minSongsNeeded,
}: {
  code: string;
  qr: string | null;
  room: ReturnType<typeof useRoomState>;
  canStart: boolean;
  playerCount: number;
  hasEnoughSongs: boolean;
  minSongsNeeded: number;
}) {
  if (room === null) return <p className="text-text-faint animate-pulse text-center py-6">Connecting to show server…</p>;
  return (
    <div className="flex flex-col gap-6">
      {/* Lobby Header */}
      <div className="flex flex-col md:flex-row items-center justify-between border-b border-line pb-4 pt-2 gap-4">
        <div className="text-xs font-mono font-bold uppercase tracking-[0.28em] text-text-dim">● LOBBY</div>
        <h1 className="font-display text-[66px] font-black leading-none uppercase tracking-[0.04em] text-text-main">
          SONG<span className="text-accent-magenta">STER</span>
        </h1>
        <div className="flex items-center gap-2 rounded-full bg-surface border border-line px-4 py-1.5 shadow-sm">
          <span className="h-2.5 w-2.5 rounded-full bg-accent-magenta animate-sc-pulse" />
          <span className="text-[11px] font-mono font-bold uppercase tracking-[0.28em] text-accent-magenta">LIVE</span>
        </div>
      </div>

      {/* Main split lobby panels */}
      <div className="grid items-stretch gap-6 md:grid-cols-[1.45fr_1fr]">
        {/* Left: Join Info Panel */}
        <div className="rounded-[18px] border border-line bg-surface p-8 grid sm:grid-cols-[1.1fr_0.9fr] items-center gap-8 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          {/* Giant QR Code on the Left */}
          {qr !== null ? (
            <div className="flex flex-col items-center gap-3 w-full">
              <div className="w-full aspect-square max-w-[340px] bg-white p-4 rounded-[22px] flex items-center justify-center shadow-2xl hover:scale-[1.02] transition-transform duration-200">
                <img src={qr} alt={`Join ${code}`} className="h-full w-full rounded-xl" />
              </div>
              <div className="text-[10px] font-mono font-bold uppercase tracking-[0.15em] text-text-faint text-center">
                Scan to join instantly
              </div>
            </div>
          ) : (
            <div className="w-full aspect-square max-w-[340px] bg-bg-deep rounded-[22px] border border-line flex items-center justify-center text-text-faint text-sm">
              Generating QR…
            </div>
          )}

          {/* Join Text & Room Code on the Right */}
          <div className="flex flex-col gap-6 h-full justify-between py-2">
            <div>
              <div className="text-[11px] font-mono font-bold uppercase tracking-[0.28em] text-text-faint">JOIN AT</div>
              <div className="font-display text-[32px] md:text-[36px] font-black text-gold-yellow tracking-wide mt-1 select-all break-all leading-tight">
                {window.location.host}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-mono font-bold uppercase tracking-[0.28em] text-text-faint mb-2">ROOM CODE</div>
              <div className="flex gap-2">
                {code.split("").map((char, i) => (
                  <div key={i} className="flex-1 h-[76px] rounded-[12px] border-2 border-line bg-bg-deep flex items-center justify-center font-display text-[42px] font-extrabold text-text-main">
                    {char}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Roster Panel */}
        <div className="rounded-[18px] border border-line bg-surface p-8 flex flex-col justify-between gap-4 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          <div className="flex flex-col gap-4 flex-1">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="text-[11px] font-mono font-bold uppercase tracking-[0.28em] text-text-faint">IN THE ROOM</span>
              <span className="text-xs font-mono font-bold uppercase text-accent-magenta">{room.players.length} Players</span>
            </div>
            <div className="flex-1 min-h-[220px]">
              <Roster room={room} size="big" />
            </div>
          </div>

          {/* Bot Management Panel */}
          <div className="mt-4 pt-4 border-t border-line flex flex-col gap-3">
            <div className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-text-faint">Manage Bots</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => socket.emit("admin:addBot", { code })}
                className="rounded-xl bg-surface-2 hover:bg-line border border-line text-text-main font-mono font-bold text-xs uppercase px-4 py-2.5 transition cursor-pointer shadow-sm"
              >
                + Add Bot 🤖
              </button>
              {room.players.filter((p) => p.isBot).map((bot) => (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => socket.emit("admin:removeBot", { code, playerId: bot.id })}
                  className="rounded-xl bg-surface-2 hover:bg-kick-red/20 hover:text-kick-red border border-line text-text-dim px-3 py-2.5 transition cursor-pointer shadow-sm text-xs font-semibold"
                  title="Remove bot"
                >
                  {bot.name} ✕
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer Banner */}
      <div className="mt-4 rounded-2xl bg-accent-magenta text-[#1a1110] p-6 flex flex-col md:flex-row items-center justify-between gap-4 shadow-[0_12px_40px_rgba(255,45,120,0.25)]">
        <div className="flex flex-col md:flex-row items-center gap-4 text-center md:text-left">
          <div className="text-xs font-mono font-bold uppercase tracking-[0.2em] border-2 border-[#1a1110] px-3 py-1 rounded-md">
            UP NEXT
          </div>
          <div className="font-display text-[26px] font-black uppercase tracking-[0.05em]">
            Trivia Timeline Rush · {room.teams.length} Teams · Target {room.config.targetLength} Cards
          </div>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto justify-center md:justify-end">
          {canStart ? (
            <button
              type="button"
              onClick={() => socket.emit("room:start", { code })}
              className="rounded-xl bg-[#1a1110] hover:bg-surface text-accent-magenta font-display font-black text-xl uppercase px-8 py-3.5 hover:scale-[1.03] active:scale-[0.98] transition cursor-pointer shadow-md"
            >
              Start the show ▸
            </button>
          ) : (
            <div className="text-xs font-mono font-bold uppercase tracking-[0.1em] opacity-85 text-[#1a1110]">
              {!hasEnoughSongs
                ? `⚠ Need more approved songs (${room.poolSize}/${minSongsNeeded})`
                : "Waiting for players to join..."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Countdown({ endsAt, ready, emcee, code }: { endsAt: number; ready: boolean; emcee: { hostName: string; text: string } | null; code: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  
  useEffect(() => {
    startBgMusic("/showcase/music/jeopardy-theme.mp3", 0.25);
    return () => {
      stopBgMusic();
    };
  }, []);

  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
  if (remaining <= 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-bg-deep/90 backdrop-blur-md px-6">
      <div className="text-[11px] font-mono font-bold uppercase tracking-[0.45em] text-gold-yellow">Get ready</div>

      {!ready ? (
        <>
          <div className="relative w-48 h-48 my-8 flex items-center justify-center">
            <div className="absolute w-32 h-32 rounded-full border-4 border-line" />
            <motion.div
              className="absolute w-32 h-32 rounded-full border-4 border-transparent border-t-gold-yellow border-r-accent-magenta"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
            />
            <div className="absolute text-xs font-mono font-bold uppercase tracking-widest text-gold-yellow/70 animate-pulse">
              Loading
            </div>
          </div>
          <div className="mt-4 text-sm font-mono tracking-widest uppercase text-text-dim">Preparing the show…</div>
        </>
      ) : (
        <>
          <motion.div
            key={remaining}
            initial={{ scale: 0.6, opacity: 0, rotate: -10 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 1.4, opacity: 0, rotate: 10 }}
            transition={{ type: "spring", stiffness: 180, damping: 11 }}
            className="mt-2 text-[14rem] font-black leading-none tabular-nums text-transparent bg-clip-text bg-gradient-to-b from-gold-yellow to-[#f59e0b] drop-shadow-[0_0_50px_rgba(255,210,63,0.5)] font-display"
          >
            {remaining}
          </motion.div>
          <div className="mt-4 text-sm font-mono tracking-widest uppercase text-text-dim">The show starts in {remaining}…</div>
        </>
      )}

      {emcee !== null && emcee.text.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 mx-auto max-w-xl text-center bg-surface border border-line rounded-2xl p-5 backdrop-blur-md shadow-lg"
        >
          <div className="text-[11px] font-mono font-bold uppercase tracking-[0.3em] text-accent-magenta">🎙 {emcee.hostName}</div>
          <p className="mt-2 text-base font-semibold italic text-text-main leading-relaxed">"{emcee.text}"</p>
        </motion.div>
      )}

      {ready && (
        <button
          type="button"
          className="pointer-events-auto mt-8 rounded-xl bg-surface hover:bg-surface-2 border border-line px-7 py-3 text-xs font-mono font-bold uppercase tracking-wider text-text-dim hover:text-text-main transition active:scale-[0.98] cursor-pointer backdrop-blur-sm shadow-lg"
          onClick={() => socket.emit("room:skipIntro", { code })}
        >
          ⏩ Skip Intro
        </button>
      )}
    </div>
  );
}
