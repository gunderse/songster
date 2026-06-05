import { useEffect, useState } from "react";

import type { Hello, Pong } from "@songster/shared/events";

import { socket } from "./socket";

export function App() {
  const [connected, setConnected] = useState(false);
  const [hello, setHello] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onHello(payload: Hello) {
      setHello(payload.message);
    }
    function onPong(payload: Pong) {
      setLatencyMs(Date.now() - payload.sentAt);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("hello", onHello);
    socket.on("pong", onPong);
    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("hello", onHello);
      socket.off("pong", onPong);
      socket.disconnect();
    };
  }, []);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-6 p-6 text-slate-100">
      <h1 className="text-4xl font-black tracking-tight">🎵 Songster</h1>

      <div className="flex items-center gap-2 text-sm">
        <span className={`h-3 w-3 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-500"}`} />
        {connected ? "Connected" : "Disconnected"}
      </div>

      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-sm text-slate-400">
        <dt>server says</dt>
        <dd className="text-slate-200">{hello ?? "…"}</dd>
        <dt>ping latency</dt>
        <dd className="text-slate-200">{latencyMs === null ? "—" : `${latencyMs} ms`}</dd>
      </dl>

      <button
        type="button"
        onClick={() => socket.emit("ping", { sentAt: Date.now() })}
        className="rounded-lg bg-indigo-500 px-5 py-2 font-semibold text-white transition hover:bg-indigo-400 active:scale-95"
      >
        Ping server
      </button>

      <p className="max-w-xs text-center text-xs text-slate-500">
        M0 scaffold — server + client + Socket.IO round-trip. Game screens arrive in later milestones.
      </p>
    </main>
  );
}
