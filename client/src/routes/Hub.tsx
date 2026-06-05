import { useEffect, useState } from "react";

import QRCode from "qrcode";

import { socket } from "../socket";
import { Roster } from "../components/Roster";
import { joinUrl, useRoomState } from "../useRoom";

export function Hub({ code }: { code: string }) {
  const room = useRoomState();
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(joinUrl(code), { width: 360, margin: 1 }).then(setQr).catch(() => undefined);

    function register() {
      socket.emit("hub:join", { code }, (res) => {
        setError(res.ok ? null : res.error);
      });
    }
    socket.on("connect", register);
    if (!socket.connected) socket.connect();
    else register();

    return () => {
      socket.off("connect", register);
    };
  }, [code]);

  return (
    <main className="min-h-dvh bg-slate-950 p-8 text-slate-100">
      {error !== null ? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
          <h1 className="text-3xl font-black">Room {code}</h1>
          <p className="text-rose-400">{error}</p>
          <p className="text-slate-500">Create it from the Admin screen first.</p>
        </div>
      ) : (
        <div className="mx-auto max-w-5xl">
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
            ) : room.status === "lobby" ? (
              <>
                <h2 className="mb-3 text-xl text-slate-400">
                  {room.players.length === 0 ? "Waiting for players to join…" : `${room.players.length} in the room`}
                </h2>
                <Roster room={room} size="big" />
              </>
            ) : (
              <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3">
                <div className="text-6xl">🎵</div>
                <h2 className="text-4xl font-black">The show is starting…</h2>
                <p className="text-slate-500">(gameplay arrives in M4)</p>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
