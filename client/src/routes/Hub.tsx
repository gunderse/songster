import { useEffect, useRef, useState } from "react";

import QRCode from "qrcode";

import { audioStreamUrl } from "../api";
import { audioUnlocked, playSfx, playSnippet, stopSnippet, unlockAudio } from "../audio";
import { HubGame } from "../components/HubGame";
import { Roster } from "../components/Roster";
import { socket } from "../socket";
import { joinUrl, useRoomState } from "../useRoom";

export function Hub({ code }: { code: string }) {
  const room = useRoomState();
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(audioUnlocked());

  useEffect(() => {
    QRCode.toDataURL(joinUrl(code), { width: 360, margin: 1 }).then(setQr).catch(() => undefined);

    function register() {
      socket.emit("hub:join", { code }, (res) => setError(res.ok ? null : res.error));
    }
    function onAudio(payload: { songId: string; startS: number; lenS: number }) {
      playSfx("turn");
      playSnippet(audioStreamUrl(payload.songId), payload.startS, payload.lenS);
    }

    socket.on("connect", register);
    socket.on("audio:play", onAudio);
    if (!socket.connected) socket.connect();
    else register();

    return () => {
      socket.off("connect", register);
      socket.off("audio:play", onAudio);
      stopSnippet();
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
      stopSnippet();
      playSfx(r!.correct ? "correct" : "wrong");
    }
    if (game.winnerTeamId !== null && !wonRef.current) {
      wonRef.current = true;
      stopSnippet();
      playSfx("win");
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

  return (
    <main className="relative min-h-dvh bg-slate-950 p-8 text-slate-100">
      {!started && (
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            setStarted(true);
          }}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-slate-950/95"
        >
          <div className="text-6xl">🔊</div>
          <div className="text-3xl font-black">Tap to start the show</div>
          <div className="text-slate-500">Room {code} · audio plays here</div>
        </button>
      )}

      <div className="mx-auto max-w-5xl">
        {inLobby ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <div className="text-sm uppercase tracking-[0.3em] text-slate-500">Join at {window.location.host}</div>
                <div className="mt-1 text-[8rem] font-black leading-none tracking-[0.15em] text-indigo-300">{code}</div>
              </div>
              {qr !== null && (
                <div className="rounded-2xl bg-white p-3">
                  <img src={qr} alt={`Join ${code}`} width={200} height={200} />
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
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between text-slate-500">
              <span className="text-sm uppercase tracking-[0.3em]">Songster</span>
              <span className="font-mono text-lg tracking-widest text-slate-400">{code}</span>
            </div>
            <HubGame room={room} />
          </>
        )}
      </div>
    </main>
  );
}
