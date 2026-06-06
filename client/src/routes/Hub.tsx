import { useEffect, useRef, useState } from "react";

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
    function onEmcee(payload: { audioUrl: string; hostName: string; text: string }) {
      // Fade the song out, then let the host speak after a beat (not an abrupt cut).
      fadeOutSnippet(1600);
      setEmcee({ hostName: payload.hostName, text: payload.text });
      if (voiceTimerRef.current !== undefined) window.clearTimeout(voiceTimerRef.current);
      voiceTimerRef.current = window.setTimeout(() => playVoiceUrl(payload.audioUrl), 1400);
      // Reasonable upper bound; cleared on next audio/showcase.
      setAudioFor(25_000);
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
  const canStart = inLobby && playerCount >= 1; // at least one player; teams auto-balance

  return (
    <main className="relative min-h-dvh bg-slate-950 p-6 text-slate-100 sm:p-10">
      {/* Small, non-obscuring audio-unlock banner (so the QR + code stay readable). */}
      {!audioReady && (
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            setAudioReady(true);
            // If a snippet is already mid-play (game started before this tap), play it now.
            const pending = pendingSnippetRef.current;
            if (pending !== null && pending.until > Date.now()) {
              playSnippet(pending.url, pending.startS, pending.lenS);
              setAudioFor(pending.lenS * 1000);
            }
          }}
          className="fixed bottom-6 right-6 z-40 rounded-full bg-indigo-500 px-5 py-3 text-sm font-bold text-white shadow-2xl shadow-indigo-500/30 hover:bg-indigo-400"
        >
          🔊 Tap to enable audio
        </button>
      )}

      {showcase !== null && <ShowcaseOverlay view={showcase} cueIndex={showcaseCue} />}

      {/* Pre-game countdown overlay so players know the show's about to start. */}
      {countdownEndsAt !== null && <Countdown endsAt={countdownEndsAt} />}

      <div className="mx-auto max-w-6xl">
        {inLobby ? (
          <LobbyView code={code} qr={qr} room={room} canStart={canStart} playerCount={playerCount} />
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between text-slate-500">
              <span className="text-sm uppercase tracking-[0.3em]">Songster</span>
              <span className="flex items-center gap-3">
                <Waveform active={audioActive} />
                <span className="font-mono text-lg tracking-widest text-slate-400">{code}</span>
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
}: {
  code: string;
  qr: string | null;
  room: ReturnType<typeof useRoomState>;
  canStart: boolean;
  playerCount: number;
}) {
  return (
    <>
      <div className="grid items-start gap-8 md:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="text-sm uppercase tracking-[0.3em] text-slate-500">Join the show</div>
          <div className="mt-1 leading-none tracking-[0.18em] text-indigo-300" style={{ fontSize: "min(20vw, 12rem)", fontWeight: 900 }}>
            {code}
          </div>
          <div className="mt-4 text-lg text-slate-400">
            On your phone, go to <span className="font-semibold text-slate-200">{window.location.host}</span> and enter <span className="font-bold text-indigo-300">{code}</span>
          </div>
        </div>
        {qr !== null && (
          <div className="justify-self-center rounded-3xl bg-white p-4 shadow-2xl md:justify-self-end">
            <img src={qr} alt={`Join ${code}`} className="h-auto w-full max-w-[360px]" />
            <div className="mt-2 text-center text-sm font-semibold text-slate-700">Scan to join</div>
          </div>
        )}
      </div>

      <div className="mt-10">
        {room === null ? (
          <p className="text-slate-500">Connecting…</p>
        ) : (
          <>
            <h2 className="mb-3 text-xl text-slate-400">
              {room.players.length === 0 ? "Waiting for players to join…" : `${room.players.length} in the room`}
            </h2>
            <Roster room={room} size="big" />

            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => socket.emit("room:start", { code })}
                disabled={!canStart}
                className="rounded-2xl bg-emerald-500 px-12 py-5 text-2xl font-black text-white shadow-2xl shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:opacity-50 disabled:shadow-none"
              >
                ▶ Start the show
              </button>
              <p className="text-sm text-slate-500">
                {canStart
                  ? `${playerCount} ready · late joiners get a 6-second grace period`
                  : "Need at least one player to start"}
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Pre-game / first-turn countdown overlay. Updates every 250ms. */
function Countdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
  if (remaining <= 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur">
      <div className="text-sm uppercase tracking-[0.4em] text-amber-300">Get ready</div>
      <div className="mt-2 text-[16rem] font-black leading-none tabular-nums text-amber-300 drop-shadow-[0_0_60px_rgba(251,191,36,0.4)]">
        {remaining}
      </div>
      <div className="mt-4 text-2xl text-slate-200">The show starts in {remaining}…</div>
    </div>
  );
}
