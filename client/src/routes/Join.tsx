import { useState } from "react";

import { socket } from "../socket";
import { useRoomState } from "../useRoom";

export function Join({ code }: { code: string }) {
  const room = useRoomState();
  const [name, setName] = useState("");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function join() {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    const emit = () =>
      socket.emit("room:join", { code, name: trimmed }, (res) => {
        setBusy(false);
        if (res.ok) setPlayerId(res.playerId);
        else setError(res.error);
      });
    if (socket.connected) emit();
    else {
      socket.once("connect", emit);
      socket.connect();
    }
  }

  // ── name entry ──────────────────────────────────────────────────────────
  if (playerId === null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-slate-100">
        <h1 className="text-4xl font-black">🎵 Songster</h1>
        <p className="text-slate-400">
          Joining room <span className="font-bold tracking-widest text-indigo-300">{code}</span>
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && join()}
          placeholder="Your name"
          maxLength={24}
          autoFocus
          className="w-full max-w-xs rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-center text-xl outline-none focus:border-indigo-500"
        />
        {error !== null && <p className="text-rose-400">{error}</p>}
        <button
          type="button"
          onClick={join}
          disabled={busy || name.trim().length === 0}
          className="w-full max-w-xs rounded-xl bg-indigo-500 px-6 py-3 text-lg font-semibold text-white hover:bg-indigo-400 disabled:opacity-40"
        >
          {busy ? "Joining…" : "Join game"}
        </button>
      </main>
    );
  }

  // ── lobby ───────────────────────────────────────────────────────────────
  const me = room?.players.find((player) => player.id === playerId) ?? null;
  const myTeam = room?.teams.find((team) => team.id === me?.teamId) ?? null;

  if (room !== null && room.status !== "lobby") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center text-slate-100">
        <div className="text-6xl">🎶</div>
        <h1 className="text-3xl font-black">The show is starting!</h1>
        {myTeam !== null && (
          <p className="text-lg" style={{ color: myTeam.color }}>
            You're on {myTeam.name}
          </p>
        )}
        <p className="text-sm text-slate-500">Watch the big screen. (Gameplay arrives in M4.)</p>
      </main>
    );
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
