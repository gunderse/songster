import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import QRCode from "qrcode";

import type { ShowcaseView } from "@songster/shared/game";

import { audioStreamUrl } from "../api";
import {
  audioUnlocked,
  burstConfetti,
  fadeOutSnippet,
  playCues,
  playSfx,
  playSnippet,
  playVoiceUrl,
  startBgMusic,
  stopBgMusic,
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
      });
    }

    socket.on("connect", register);
    socket.on("audio:play", onAudio);
    socket.on("emcee:play", onEmcee);
    socket.on("showcase:play", onShowcase);
    if (!socket.connected) socket.connect();
    else register();

    return () => {
      socket.off("connect", register);
      socket.off("audio:play", onAudio);
      socket.off("emcee:play", onEmcee);
      socket.off("showcase:play", onShowcase);
      if (voiceTimerRef.current !== undefined) window.clearTimeout(voiceTimerRef.current);
      if (audioOffTimerRef.current !== undefined) window.clearTimeout(audioOffTimerRef.current);
      stopSnippet();
      stopVoice();
      stopCues();
      stopBgMusic();
    };
  }, [code]);

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
      playSfx(won ? "correct" : "wrong");
      if (won) burstConfetti();
    }
    if (game.winnerTeamId !== null && !wonRef.current) {
      wonRef.current = true;
      stopSnippet();
      playSfx("win");
      winConfetti();
    }
  }, [room]);

  if (error !== null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-950 text-slate-100">
        <h1 className="text-3xl font-black">Room {code}</h1>
        <p className="text-rose-400">{error}</p>
        <p className="text-slate-500">Create it from the Admin screen first.</p>
      </main>
    );
  }

  const inLobby = room === null || room.status === "lobby";
  const countdownEndsAt = room?.game?.countdownEndsAt ?? null;
  const commentaryPending = room?.game?.commentaryPending ?? false;
  const playerCount = room?.players.filter((p) => p.connected || p.isBot).length ?? 0;
  const minSongsNeeded = room ? room.teams.length + 1 : 0;
  const hasEnoughSongs = room ? room.poolSize >= minSongsNeeded : false;
  const canStart = inLobby && playerCount >= 1 && hasEnoughSongs;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-slate-950 p-6 text-slate-100 sm:p-10">
      {/* Glowing glassmorphic ambient backdrops */}
      <div className="absolute top-[-20%] left-[-20%] h-[70%] w-[70%] rounded-full bg-indigo-500/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] h-[70%] w-[70%] rounded-full bg-purple-600/5 blur-[120px] pointer-events-none" />

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
          className="fixed bottom-6 right-6 z-40 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-6 py-3.5 text-sm font-bold text-white shadow-[0_0_30px_rgba(99,102,241,0.4)] hover:scale-105 active:scale-95 transition"
        >
          🔊 Tap to enable audio
        </button>
      )}

      {showcase !== null && <ShowcaseOverlay view={showcase} cueIndex={showcaseCue} />}

      {/* Pre-game countdown overlay */}
      {countdownEndsAt !== null && <Countdown endsAt={countdownEndsAt} />}

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
            <div className="mb-6 flex items-center justify-between text-slate-500 border-b border-slate-900 pb-4">
              <span className="text-xs font-bold uppercase tracking-[0.4em] bg-clip-text bg-gradient-to-r from-slate-400 to-slate-600">Songster · The Theater</span>
              <span className="flex items-center gap-3">
                <Waveform active={audioActive} />
                <span className="font-mono text-lg font-bold tracking-widest text-indigo-400 bg-indigo-950/40 border border-indigo-900/40 rounded-lg px-3 py-1 shadow-inner">{code}</span>
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
  playerCount,
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
  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-center gap-8 md:grid-cols-[1.3fr_1fr] bg-slate-900/40 border border-white/5 rounded-3xl p-8 backdrop-blur-md">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Join the show</div>
          <div 
            className="mt-1 leading-none tracking-[0.1em] text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 font-black font-heading" 
            style={{ fontSize: "min(16vw, 9.5rem)", textShadow: "0 0 40px rgba(99,102,241,0.1)" }}
          >
            {code}
          </div>
          <div className="mt-4 text-base text-slate-400 leading-relaxed">
            Open the browser on your phone, navigate to <span className="font-semibold text-slate-200 border-b border-indigo-500/30 pb-0.5">{window.location.host}</span>, and enter the code <span className="font-black text-indigo-300 bg-indigo-950/50 rounded px-1.5 py-0.5">{code}</span>
          </div>
        </div>
        {qr !== null && (
          <div className="justify-self-center rounded-3xl bg-slate-950/80 border border-white/10 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] md:justify-self-end">
            <img src={qr} alt={`Join ${code}`} className="h-auto w-full max-w-[280px] rounded-2xl" />
            <div className="mt-3 text-center text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Scan to join</div>
          </div>
        )}
      </div>

      <div className="mt-4">
        {room === null ? (
          <p className="text-slate-500 animate-pulse text-center py-6">Connecting to show server…</p>
        ) : (
          <>
            <h2 className="mb-4 text-lg font-bold uppercase tracking-wider text-slate-400 border-b border-slate-900 pb-2">
              {room.players.length === 0 ? "Waiting for players to join…" : `Roster (${room.players.length} active)`}
            </h2>
            <Roster room={room} size="big" />

            <div className="mt-12 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => socket.emit("room:start", { code })}
                disabled={!canStart}
                className="rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 px-16 py-5 text-2xl font-black text-white shadow-[0_10px_35px_rgba(16,185,129,0.3)] hover:scale-[1.03] active:scale-[0.98] disabled:scale-100 disabled:shadow-none disabled:cursor-not-allowed disabled:from-slate-800 disabled:to-slate-800 disabled:opacity-40 transition-all font-heading"
              >
                ▶ Start the show
              </button>
              <p className="text-xs tracking-wider uppercase text-slate-500 text-center max-w-md">
                {!hasEnoughSongs && room
                  ? `⚠ Insufficient approved songs (${room.poolSize}/${minSongsNeeded} needed). Go to /library to approve songs.`
                  : canStart
                    ? `${playerCount} player${playerCount > 1 ? "s" : ""} in lobby · countdown starts on launch`
                    : "Waiting for at least one player to join"}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Countdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
  if (remaining <= 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-md">
      <div className="text-sm font-bold uppercase tracking-[0.45em] text-amber-400">Get ready</div>
      <motion.div
        key={remaining}
        initial={{ scale: 0.6, opacity: 0, rotate: -10 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        exit={{ scale: 1.4, opacity: 0, rotate: 10 }}
        transition={{ type: "spring", stiffness: 180, damping: 11 }}
        className="mt-2 text-[14rem] font-black leading-none tabular-nums text-transparent bg-clip-text bg-gradient-to-b from-amber-300 to-amber-500 drop-shadow-[0_0_50px_rgba(245,158,11,0.5)] font-heading"
      >
        {remaining}
      </motion.div>
      <div className="mt-4 text-lg font-medium tracking-widest uppercase text-slate-400">The show starts in {remaining}…</div>
    </div>
  );
}
