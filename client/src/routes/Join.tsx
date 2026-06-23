import { useEffect, useRef, useState } from "react";

import { socket } from "../socket";
import { useRoomState } from "../useRoom";
import { Play } from "./Play";

const NAME_KEY = "songster:lastName";
const CODE_RE = /^[A-Z0-9]{4}$/u;

export function Join({ initialCode }: { initialCode: string | null }) {
  const room = useRoomState();
  const [code, setCode] = useState<string>((initialCode ?? "").toUpperCase());
  const [name, setName] = useState<string>(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const joinedRef = useRef<{ code: string; name: string } | null>(null);

  // Re-associate this socket with our player after any reconnect (so a phone
  // that briefly drops mid-game keeps its place instead of getting stuck).
  useEffect(() => {
    function onReconnect() {
      const j = joinedRef.current;
      if (j !== null) socket.emit("room:join", { code: j.code, name: j.name }, () => undefined);
    }
    function onDestroyed() {
      setPlayerId(null);
      joinedRef.current = null;
      setError("This room has been destroyed by the host.");
    }
    socket.on("connect", onReconnect);
    socket.on("room:destroyed", onDestroyed);
    return () => {
      socket.off("connect", onReconnect);
      socket.off("room:destroyed", onDestroyed);
    };
  }, []);

  function join() {
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    if (trimmedName.length === 0) {
      setError("Enter your name.");
      return;
    }
    if (!CODE_RE.test(trimmedCode)) {
      setError("Enter the 4-letter room code from the hub.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(NAME_KEY, trimmedName);
    } catch {
      // ignore (private mode, etc.)
    }
    const emit = () =>
      socket.emit("room:join", { code: trimmedCode, name: trimmedName }, (res) => {
        setBusy(false);
        if (res.ok) {
          joinedRef.current = { code: trimmedCode, name: trimmedName };
          setPlayerId(res.playerId);
        } else {
          setError(res.error);
        }
      });
    if (socket.connected) emit();
    else {
      socket.once("connect", emit);
      socket.connect();
    }
  }

  // ── code + name entry ──────────────────────────────────────────────────
  if (playerId === null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-slate-100">
        <h1 className="text-4xl font-black">🎵 Songster</h1>
        <p className="text-slate-400">Enter the 4-letter code from the big screen.</p>

        <label className="flex w-full max-w-xs flex-col items-stretch gap-1">
          <span className="text-xs uppercase tracking-widest text-slate-500">Room code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/gu, "").slice(0, 4))}
            onKeyDown={(e) => e.key === "Enter" && join()}
            placeholder="ABCD"
            inputMode="text"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={4}
            autoFocus={code.length < 4}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-center text-3xl font-black tracking-[0.4em] uppercase outline-none focus:border-indigo-500"
          />
        </label>

        <label className="flex w-full max-w-xs flex-col items-stretch gap-1">
          <span className="text-xs uppercase tracking-widest text-slate-500">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && join()}
            placeholder="Your name"
            maxLength={24}
            autoFocus={code.length === 4 && name.length === 0}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-center text-xl outline-none focus:border-indigo-500"
          />
        </label>

        {error !== null && <p className="text-rose-400">{error}</p>}
        <button
          type="button"
          onClick={join}
          disabled={busy || name.trim().length === 0 || !CODE_RE.test(code.trim().toUpperCase())}
          className="w-full max-w-xs rounded-xl bg-indigo-500 px-6 py-3 text-lg font-semibold text-white hover:bg-indigo-400 disabled:opacity-40"
        >
          {busy ? "Joining…" : "Join game"}
        </button>
      </main>
    );
  }

  // ── lobby ───────────────────────────────────────────────────────────────
  const me = room?.players.find((player) => player.id === playerId) ?? null;

  if (room !== null && room.status !== "lobby") {
    return <Play room={room} playerId={playerId} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 p-6 text-slate-100">
      <div className="text-center">
        <div className="text-sm text-slate-500">Room {code}</div>
        <div className="text-2xl font-black">Hi {me?.name ?? name} 👋</div>
        <p className="text-slate-400">Pick your team, then wait for the host to start.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {room?.teams.map((team) => {
          const active = team.id === me?.teamId;
          const count = room.players.filter((p) => p.teamId === team.id).length;
          return (
            <button
              key={team.id}
              type="button"
              onClick={() => socket.emit("room:setTeam", { teamId: team.id })}
              className={`rounded-2xl border-2 p-4 text-left transition ${active ? "bg-slate-900" : "border-slate-800 bg-slate-900/40"}`}
              style={active ? { borderColor: team.color } : undefined}
            >
              <div className="flex items-center gap-2 text-lg font-bold" style={{ color: team.color }}>
                <span className="h-3 w-3 rounded-full" style={{ background: team.color }} />
                {team.name}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {count} player{count === 1 ? "" : "s"} {active && "· you"}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-sm">
        <div className="mb-1 text-slate-500">In the room</div>
        <div className="flex flex-wrap gap-1.5">
          {room?.players.map((player) => {
            const team = room.teams.find((t) => t.id === player.teamId);
            return (
              <span
                key={player.id}
                className="rounded-full px-2 py-0.5"
                style={{ background: `${team?.color ?? "#334155"}22`, color: team?.color ?? "#cbd5e1" }}
              >
                {player.name}
              </span>
            );
          })}
        </div>
      </div>

      <p className="mt-auto text-center text-sm text-slate-500">Waiting for the host to start…</p>
    </main>
  );
}
