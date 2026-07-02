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
      const local = localStorage.getItem(NAME_KEY);
      if (local) return local;
      
      const cookieValue = document.cookie
        .split("; ")
        .find((row) => row.startsWith(`${NAME_KEY}=`))
        ?.split("=")[1];
      if (cookieValue) return decodeURIComponent(cookieValue);
    } catch {
      // ignore
    }
    return "";
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
      document.cookie = `${NAME_KEY}=${encodeURIComponent(trimmedName)}; max-age=31536000; path=/; SameSite=Lax`;
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
    const codeChars = (code + "    ").slice(0, 4).split("");
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center p-6 bg-base text-text-main font-sans">
        <div className="w-full max-w-xs flex flex-col gap-6">
          {/* Logo Row */}
          <div className="flex items-center justify-center gap-2">
            <span className="h-[11px] w-[11px] rounded-full bg-gold-yellow shadow-[0_0_10px_#ffd23f]" />
            <span className="font-display text-[19px] font-extrabold tracking-[0.14em] uppercase text-text-main">Songster</span>
          </div>

          {/* Headline */}
          <div className="text-center my-2">
            <h1 className="font-display text-[64px] font-black leading-[0.84] uppercase">
              JOIN <br />
              <span className="text-accent-magenta">THE SHOW</span>
            </h1>
            <p className="mt-3 text-sm text-text-dim">Enter the 4-letter code from the big screen.</p>
          </div>

          {/* Code boxes flex */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-text-faint">Room Code</span>
            <div className="flex gap-3 justify-center relative">
              {codeChars.map((char, idx) => {
                const isActive = code.length === idx || (code.length === 4 && idx === 3);
                return (
                  <div
                    key={idx}
                    className={`flex-1 h-[74px] flex items-center justify-center bg-surface border-2 rounded-[14px] font-display text-[40px] font-extrabold transition-all duration-150 ${isActive ? "border-accent-magenta shadow-[0_0_0_4px_rgba(255,45,120,0.15)] text-accent-magenta" : "border-line text-text-main"
                      }`}
                  >
                    {char.trim()}
                  </div>
                );
              })}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/gu, "").slice(0, 4))}
                onKeyDown={(e) => e.key === "Enter" && join()}
                maxLength={4}
                className="absolute inset-0 w-full h-full opacity-0 cursor-text z-10"
                autoFocus={code.length < 4}
              />
            </div>
          </div>

          {/* Name input */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-text-faint">Your Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && join()}
              placeholder="Your name"
              maxLength={24}
              autoFocus={code.length === 4 && name.length === 0}
              className="w-full h-16 rounded-[14px] border-2 border-line bg-surface px-4 py-3 text-center text-[23px] font-bold text-text-main caret-accent-magenta outline-none focus:border-accent-magenta focus:ring-4 focus:ring-accent-magenta/15 transition-all"
            />
          </div>

          {error !== null && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-kick-red text-center text-sm font-semibold">{error}</p>
              {error === "This room has been destroyed by the host." && (
                <a href="/admin" className="mt-1 rounded-xl bg-surface border border-line px-4 py-2 text-xs font-semibold text-text-dim hover:text-text-main transition">
                  Go to Admin Screen
                </a>
              )}
            </div>
          )}

          {/* Join button */}
          <button
            type="button"
            onClick={join}
            disabled={busy || name.trim().length === 0 || !CODE_RE.test(code.trim().toUpperCase())}
            className="w-full h-[68px] rounded-[16px] bg-accent-magenta hover:bg-magenta-soft text-[#1a1110] font-display text-[28px] font-black uppercase tracking-[0.04em] shadow-[0_12px_30px_rgba(255,45,120,0.4)] transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none disabled:scale-100 disabled:cursor-not-allowed cursor-pointer"
          >
            {busy ? "Joining…" : "Join the show ▸"}
          </button>

          {/* Footer */}
          <div className="text-center mt-2 text-[12px] text-text-faint">
            No app needed · runs in your browser
          </div>
        </div>
      </main>
    );
  }

  // ── lobby ───────────────────────────────────────────────────────────────
  const me = room?.players.find((player) => player.id === playerId) ?? null;

  if (room !== null && room.status !== "lobby") {
    return <Play room={room} playerId={playerId} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6 bg-base text-text-main font-sans">
      <div className="text-center mt-4">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-text-faint">Room {code}</div>
        <div className="text-3xl font-display font-black uppercase mt-1">Hi {me?.name ?? name} 👋</div>
        <p className="text-text-dim text-sm mt-1.5">Pick your team, then wait for the host to start.</p>
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
              className={`rounded-2xl border-2 p-4 text-left transition duration-200 active:scale-95 cursor-pointer flex flex-col justify-between h-28 ${active ? "bg-surface-2" : "border-line bg-surface/40 hover:border-text-faint"
                }`}
              style={active ? { borderColor: team.color } : undefined}
            >
              <div className="flex items-center gap-2 text-lg font-bold" style={{ color: team.color }}>
                <span className="h-3 w-3 rounded-full" style={{ background: team.color }} />
                {team.name}
              </div>
              <div className="text-xs font-mono text-text-faint uppercase">
                {count} player{count === 1 ? "" : "s"} {active && "· you"}
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-[14px] border border-line bg-surface p-4">
        <div className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-text-faint mb-2">In the room</div>
        <div className="flex flex-wrap gap-2">
          {room?.players.map((player) => {
            const team = room.teams.find((t) => t.id === player.teamId);
            return (
              <span
                key={player.id}
                className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: `${team?.color ?? "#334155"}22`, color: team?.color ?? "#c4a79c", border: `1px solid ${team?.color ?? "#334155"}44` }}
              >
                {player.name}
              </span>
            );
          })}
        </div>
      </div>

      <p className="mt-auto text-center text-xs font-mono uppercase tracking-[0.15em] text-text-faint animate-pulse">
        Waiting for the host to start…
      </p>
    </main>
  );
}
