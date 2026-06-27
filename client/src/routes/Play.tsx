import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import type { TimelineCardView } from "@songster/shared/game";
import type { RoomState } from "@songster/shared/room";

import { socket } from "../socket";

export function Play({ room, playerId }: { room: RoomState; playerId: string }) {
  const game = room.game;
  const me = room.players.find((p) => p.id === playerId) ?? null;
  const myTeam = room.teams.find((t) => t.id === me?.teamId) ?? null;
  const myCards = game?.timelines.find((t) => t.teamId === me?.teamId)?.cards ?? [];
  const active = game?.activeTurn ?? null;
  const result = game?.lastResult ?? null;

  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [committed, setCommitted] = useState(false);
  const [stealMode, setStealMode] = useState(false);
  const [stealSlot, setStealSlot] = useState<number | null>(null);
  const [suggestMode, setSuggestMode] = useState(false);
  const [suggestSlot, setSuggestSlot] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // Reset placement state every turn
  const turnSig = active ? `${active.turnId}|${active.phase}` : "none";
  useEffect(() => {
    setSelectedSlot(null);
    setCommitted(false);
    setStealMode(false);
    setStealSlot(null);
    setSuggestMode(false);
    setSuggestSlot(null);
  }, [turnSig]);

  if (game === null || me === null) {
    return <Centered>Loading…</Centered>;
  }

  if (game.countdownEndsAt !== null) {
    const msLeft = Math.max(0, game.countdownEndsAt - now);
    const secsLeft = Math.ceil(msLeft / 1000);
    const countdownReady = game.countdownReady;

    // Before the intro clip is ready: show a neutral waiting screen (no Skip button)
    if (!countdownReady) {
      return (
        <main className="relative flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center text-slate-100 bg-slate-950 overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] h-[50%] w-[50%] rounded-full bg-indigo-500/5 blur-[80px]" />
          <div className="flex flex-col items-center gap-4 bg-slate-900/80 border border-white/5 p-8 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] max-w-sm">
            <div className="relative flex items-center justify-center w-16 h-16 bg-slate-800 rounded-full border border-white/5">
              <motion.div
                className="absolute w-12 h-12 rounded-full border-4 border-transparent border-t-amber-400"
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
              />
              <span className="text-xl">🎙️</span>
            </div>
            <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-slate-200 to-slate-400">
              Preparing the show…
            </h2>
            <p className="text-sm text-slate-400">
              Watch the Hub screen — your host is getting ready to introduce the teams!
            </p>
          </div>
        </main>
      );
    }

    // Intro clip is playing: show timer + Skip button
    return (
      <main className="relative flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center text-slate-100 bg-slate-950 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] h-[50%] w-[50%] rounded-full bg-indigo-500/5 blur-[80px]" />
        <div className="flex flex-col items-center gap-4 bg-slate-900/80 border border-white/5 p-8 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] max-w-sm">
          <div className="relative flex items-center justify-center w-16 h-16 bg-slate-800 rounded-full text-indigo-400 text-2xl font-bold border border-white/5 animate-bounce">
            🎙️
          </div>
          <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-100 to-indigo-300">
            Intro Narration
          </h2>
          <p className="text-sm text-slate-400">
            Your host is introducing the teams on the Hub screen — listen up!
          </p>
          <div className="text-xs text-slate-500 font-semibold tabular-nums mt-1">
            Game starts in {secsLeft}s…
          </div>
          <button
            type="button"
            onClick={() => socket.emit("room:skipIntro", { code: room.code })}
            className="w-full mt-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 px-5 py-3 text-sm font-bold text-white transition active:scale-[0.98] cursor-pointer"
          >
            ⏩ Skip Intro
          </button>
        </div>
      </main>
    );
  }

  // ── game over ─────────────────────────────────────────────────────────
  if (game.winnerTeamId !== null) {
    const won = game.winnerTeamId === me.teamId;
    const winningTeam = room.teams.find((t) => t.id === game.winnerTeamId);
    return (
      <Centered>
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-7xl drop-shadow-[0_0_20px_rgba(251,191,36,0.3)]"
        >
          {won ? "🏆" : "🎬"}
        </motion.div>
        <h1 className="text-3xl font-black font-heading mt-2">{won ? "Victory!" : "Game Over"}</h1>
        <p className="text-lg font-bold" style={{ color: winningTeam?.color }}>
          {winningTeam?.name} took the crown
        </p>
        <button
          type="button"
          onClick={() => socket.emit("room:start", { code: room.code })}
          className="mt-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 px-8 py-4 text-base font-black text-white hover:scale-[1.02] active:scale-[0.98] transition shadow-lg shadow-emerald-950/20"
        >
          🎮 Play another game
        </button>
      </Centered>
    );
  }

  if (game.paused) {
    return (
      <main className="relative flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center text-slate-100 bg-slate-950 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] h-[50%] w-[50%] rounded-full bg-indigo-500/5 blur-[80px]" />
        <div className="flex flex-col items-center gap-4 bg-slate-900/80 border border-white/5 p-8 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] max-w-xs">
          <div className="relative flex items-center justify-center w-16 h-16 bg-slate-800 rounded-full text-slate-400 text-2xl font-bold border border-white/5">
            ⏸
          </div>
          <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-slate-100 to-slate-300">
            Game Paused
          </h2>
          <p className="text-xs text-slate-400">
            The host has paused the game. Hang tight, we'll resume shortly!
          </p>
        </div>
      </main>
    );
  }

  const amPlacer = active !== null && active.placerId === me.id;
  const placerName = active !== null ? room.players.find((p) => p.id === active.placerId)?.name ?? "—" : "";
  const activeTeam = active !== null ? room.teams.find((t) => t.id === active.teamId) : null;

  // ── suspense (everyone holds breath; the year is hidden until reveal) ──
  if (active !== null && active.phase === "suspense") {
    return (
      <main className="relative flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center text-slate-100 bg-slate-950 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] h-[50%] w-[50%] rounded-full bg-amber-500/5 blur-[80px]" />
        <motion.div
          animate={{ scale: [1, 1.1, 1], rotate: [-4, 4, -4] }}
          transition={{ scale: { duration: 0.5, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 0.15, repeat: Infinity } }}
          className="text-7xl drop-shadow-[0_0_30px_rgba(245,158,11,0.4)]"
        >
          🥁
        </motion.div>
        <div className="text-2xl font-black font-heading text-amber-300 uppercase tracking-widest">Drumroll please…</div>
        <p className="text-slate-300 max-w-xs text-sm">
          Did <span className="font-bold" style={{ color: activeTeam?.color }}>{result?.placerName ?? active.placerName}</span> place it correctly?
        </p>
      </main>
    );
  }

  // ── reveal (everyone sees the result with an animated flip) ──────────
  if (active !== null && active.phase === "revealing" && result !== null) {
    const isWin = result.correct || result.steal?.correct === true;
    const borderCol = isWin ? "border-emerald-500 shadow-emerald-500/20" : "border-rose-500 shadow-rose-500/20";
    return (
      <main className="relative flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center text-slate-100 bg-slate-950 overflow-hidden" style={{ perspective: 1000 }}>
        <div className={`absolute top-[-10%] left-[-10%] h-[50%] w-[50%] rounded-full blur-[80px] ${isWin ? "bg-emerald-500/5" : "bg-rose-500/5"}`} />
        <motion.div
          initial={{ rotateY: 180, scale: 0.9, opacity: 0 }}
          animate={{ rotateY: 0, scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 100, damping: 14 }}
          style={{ transformStyle: "preserve-3d" }}
          className={`flex flex-col items-center gap-3 rounded-3xl border bg-slate-900/90 backdrop-blur-md px-10 py-8 shadow-2xl ${borderCol}`}
        >
          <div className="text-6xl">{result.correct ? "✅" : (result.timeout ? "⏰" : "❌")}</div>
          <div className="text-6xl font-black font-heading tabular-nums text-slate-100">{result.song.year}</div>
          <div className="text-xl font-bold font-heading line-clamp-1 text-slate-200 mt-2">{result.song.title ?? "Unknown"}</div>
          <div className="text-slate-400 text-sm line-clamp-1 font-semibold">{result.song.artist ?? ""}</div>
        </motion.div>
        <p className="mt-2 text-sm font-bold tracking-wide uppercase" style={{ color: result.correct ? "#34d399" : "#f43f5e" }}>
          {result.placerName} {result.correct ? "nailed it!" : (result.timeout ? "ran out of time!" : "missed")}
        </p>
        {result.steal !== null && (
          <p className="text-sm font-bold uppercase tracking-wider mt-1" style={{ color: result.steal.correct ? "#fbbf24" : "#64748b" }}>
            {result.steal.correct ? `🥷 STOLEN BY ${result.steal.playerName}!` : `${result.steal.playerName}'s steal missed`}
          </p>
        )}
      </main>
    );
  }

  // ── my turn to place ──────────────────────────────────────────────────
  if (amPlacer && active.phase === "placing") {
    const suggestions = active.suggestions ?? [];
    const deadlineMs = active.placeDeadline !== null ? Math.max(0, active.placeDeadline - now) : null;
    const hasDistraction = !!active.distraction;
    return (
      <main className="relative mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-3.5 py-5 sm:p-5 text-slate-100 bg-slate-950 landscape:max-w-3xl overflow-x-hidden">
        {/* Glow ambient shapes */}
        <div className="absolute top-[-10%] left-[-10%] h-[40%] w-[40%] rounded-full bg-indigo-500/5 blur-[80px]" />
        
        <div className="text-center relative z-10">
          <div className="text-xs uppercase tracking-widest font-bold text-indigo-400">Your turn, {me.name}</div>
          <h1 className="text-2xl font-black font-heading tracking-tight mt-1">Where does it fit?</h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">Listen to the snippet on the shared Hub screen 🔊, then choose the correct time slot.</p>
          {deadlineMs !== null && <TurnClock msLeft={deadlineMs} />}
        </div>

        {active.distraction && (
          <div className="relative z-10 text-center text-xs font-bold uppercase tracking-wider text-red-200 bg-red-950/40 border border-red-900/30 rounded-2xl py-3 px-4 animate-pulse">
            📢 {active.distraction.playerName} ({room.teams.find((t) => t.id === active.distraction?.teamId)?.name}) deployed a DISTRACTION!
          </div>
        )}

        <SuggestionsList suggestions={suggestions} cards={myCards} accentColor={myTeam?.color ?? "#6366f1"} onUse={(i) => setSelectedSlot(i)} />

        <div className="relative z-10 flex-1 flex flex-col justify-start">
          <TimelinePicker cards={myCards} teamColor={myTeam?.color ?? "#6366f1"} selected={selectedSlot} onSelect={setSelectedSlot} suggestionIndices={suggestions.map((s) => s.index)} eliminatedSlots={active.eliminatedSlots} />
        </div>

        <div className="mt-auto flex flex-col gap-2 relative z-10">
          <button
            type="button"
            disabled={selectedSlot === null || committed}
            onClick={() => {
              if (selectedSlot === null) return;
              socket.emit("player:placeCard", { index: selectedSlot });
              setCommitted(true);
            }}
            className="rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-4 text-lg font-black text-white hover:scale-[1.02] active:scale-[0.98] disabled:scale-100 disabled:opacity-40 disabled:from-slate-800 disabled:to-slate-800 disabled:cursor-not-allowed transition font-heading shadow-lg shadow-emerald-950/20"
          >
            {committed ? "Locked in…" : selectedSlot === null ? "Choose a slot above ↑" : "Lock in placement"}
          </button>
          {!committed && room.config.specialsPerTeam > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!(myTeam && myTeam.tokens > 0)}
                onClick={() => socket.emit("player:useSkip")}
                className="flex-1 rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md px-3 py-3 text-xs font-semibold text-slate-350 hover:bg-slate-800 hover:text-white transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                🎟️ Skip Song ({myTeam?.tokens ?? 0} left)
              </button>
              <button
                type="button"
                disabled={!(myTeam && myTeam.tokens > 0) || (active.eliminatedSlots && active.eliminatedSlots.length > 0)}
                onClick={() => socket.emit("player:use5050")}
                className="flex-1 rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md px-3 py-3 text-xs font-semibold text-slate-350 hover:bg-slate-800 hover:text-white transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                🌓 50/50
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <ReplayButton ready={now >= active.snippetPlayingUntil && !hasDistraction} disabled={hasDistraction} />
            <PlayMoreButton ready={now >= active.snippetPlayingUntil && !hasDistraction} disabled={hasDistraction} />
          </div>
        </div>
      </main>
    );
  }

  const canSteal =
    active !== null &&
    active.phase === "placing" &&
    me.teamId !== null &&
    me.teamId !== active.teamId &&
    room.config.specialsPerTeam > 0 &&
    myTeam !== null &&
    myTeam.tokens > 0 &&
    active.steal === null;

  const canDistract =
    active !== null &&
    active.phase === "placing" &&
    me.teamId !== null &&
    me.teamId !== active.teamId &&
    room.config.specialsPerTeam > 0 &&
    myTeam !== null &&
    myTeam.tokens > 0 &&
    active.distraction === null;

  const canSuggest =
    active !== null &&
    active.phase === "placing" &&
    me.teamId !== null &&
    me.teamId === active.teamId &&
    me.id !== active.placerId;

  const mySuggestion = active?.suggestions?.find((s) => s.playerId === me.id) ?? null;

  // ── suggest mode: send a non-binding hint to your placer ──────────────
  if (suggestMode && active !== null) {
    return (
      <main className="relative mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-3.5 py-5 sm:p-5 text-slate-100 bg-slate-950 landscape:max-w-3xl overflow-x-hidden">
        <div className="absolute top-[-10%] left-[-10%] h-[40%] w-[40%] rounded-full bg-indigo-500/5 blur-[80px]" />
        <div className="text-center relative z-10">
          <div className="text-xs uppercase tracking-widest font-bold text-indigo-300">💡 Teammate suggestion</div>
          <h1 className="text-2xl font-black font-heading mt-1">Help out {placerName}</h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">Suggest where the song belongs on your timeline. They will make the final decision.</p>
        </div>
        <div className="relative z-10 flex-1 flex flex-col justify-start">
          <TimelinePicker cards={myCards} teamColor={myTeam?.color ?? "#6366f1"} selected={suggestSlot} onSelect={setSuggestSlot} />
        </div>
        <div className="mt-auto flex flex-col gap-2 relative z-10">
          <button
            type="button"
            disabled={suggestSlot === null}
            onClick={() => {
              if (suggestSlot === null) return;
              socket.emit("player:suggestPlacement", { index: suggestSlot });
              setSuggestMode(false);
            }}
            className="rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 px-6 py-4 text-lg font-black text-white hover:scale-[1.02] active:scale-[0.98] disabled:scale-100 disabled:opacity-40 disabled:from-slate-800 disabled:to-slate-800 disabled:cursor-not-allowed transition font-heading shadow-lg shadow-indigo-950/20"
          >
            {suggestSlot === null ? "Choose a slot above ↑" : "Send suggestion 💡"}
          </button>
          <button type="button" onClick={() => setSuggestMode(false)} className="py-2.5 text-sm font-semibold text-slate-400 hover:text-white transition">
            Cancel
          </button>
        </div>
      </main>
    );
  }

  // ── steal mode: place your challenge on your own timeline ─────────────
  if (stealMode && active !== null) {
    return (
      <main className="relative mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-3.5 py-5 sm:p-5 text-slate-100 bg-slate-950 overflow-x-hidden">
        <div className="absolute top-[-10%] left-[-10%] h-[40%] w-[40%] rounded-full bg-amber-500/5 blur-[80px]" />
        <div className="text-center relative z-10">
          <div className="text-xs uppercase tracking-widest font-bold text-amber-400">🥷 Steal play</div>
          <h1 className="text-2xl font-black font-heading mt-1">Steal the card</h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
            Place it on your own timeline. If {placerName} guessed wrong and you guess right, your team steals the card!
          </p>
        </div>
        <div className="relative z-10 flex-1 flex flex-col justify-start">
          <TimelinePicker cards={myCards} teamColor={myTeam?.color ?? "#6366f1"} selected={stealSlot} onSelect={setStealSlot} accent="amber" />
        </div>
        <div className="mt-auto flex flex-col gap-2 relative z-10">
          <button
            type="button"
            disabled={stealSlot === null}
            onClick={() => {
              if (stealSlot === null) return;
              socket.emit("player:stealPlace", { index: stealSlot });
              setStealMode(false);
            }}
            className="rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-4 text-lg font-black text-white hover:scale-[1.02] active:scale-[0.98] disabled:scale-100 disabled:opacity-40 disabled:from-slate-800 disabled:to-slate-800 disabled:cursor-not-allowed transition font-heading shadow-lg shadow-amber-950/20"
          >
            {stealSlot === null ? "Choose a slot above ↑" : "Confirm Steal (1 Token)"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStealMode(false);
              setStealSlot(null);
            }}
            className="py-2.5 text-sm font-semibold text-slate-400 hover:text-white transition"
          >
            Cancel
          </button>
        </div>
      </main>
    );
  }

  // ── waiting (someone else is placing) ─────────────────────────────────
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-3.5 py-5 sm:p-5 text-slate-100 bg-slate-950 landscape:max-w-3xl overflow-x-hidden">
      <div className="absolute top-[-10%] left-[-10%] h-[40%] w-[40%] rounded-full bg-slate-800/10 blur-[80px]" />
      
      <div className="text-center relative z-10">
        <div className="text-xs uppercase tracking-widest font-bold text-slate-500">Room {room.code}</div>
        {active !== null ? (
          <h1 className="text-lg font-extrabold font-heading mt-1 leading-snug">
            <span style={{ color: activeTeam?.color }}>{activeTeam?.name}</span> is placing
            <div className="text-xs font-semibold text-slate-400 mt-1 font-sans">{placerName} is picking · listen on the hub 🔊</div>
          </h1>
        ) : (
          <h1 className="text-lg font-bold font-heading mt-1">Get ready…</h1>
        )}
      </div>

      {active !== null && active.distraction && (
        <p className="text-center text-xs font-bold uppercase tracking-wider text-red-200 bg-red-950/40 border border-red-900/30 rounded-xl py-2.5 px-4 relative z-10 animate-pulse">
          📢 {active.distraction.playerName} ({room.teams.find((t) => t.id === active.distraction?.teamId)?.name}) deployed a DISTRACTION!
        </p>
      )}

      {active !== null && me.teamId !== active.teamId && active.steal !== null && (
        <p className="text-center text-xs font-bold uppercase tracking-wider text-amber-400 bg-amber-950/20 border border-amber-900/30 rounded-xl py-2 px-4 relative z-10">
          🥷 {active.steal.playerName} is challenging with a STEAL!
        </p>
      )}
      
      <div className="flex flex-col gap-2 relative z-10 w-full max-w-sm mx-auto">
        {room.config.specialsPerTeam > 0 && (canSteal || canDistract) && (
          <div className="flex gap-2">
            {canSteal && (
              <button
                type="button"
                onClick={() => setStealMode(true)}
                className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-3.5 text-xs font-black text-white hover:scale-[1.02] active:scale-[0.98] transition shadow-lg shadow-amber-950/20"
              >
                🥷 Steal card ({myTeam?.tokens ?? 0} left)
              </button>
            )}
            {canDistract && (
              <button
                type="button"
                onClick={() => socket.emit("player:useDistraction")}
                className="flex-1 rounded-xl bg-gradient-to-r from-rose-500 to-red-650 px-4 py-3.5 text-xs font-black text-white hover:scale-[1.02] active:scale-[0.98] transition shadow-lg shadow-rose-950/20"
              >
                📢 Distract ({myTeam?.tokens ?? 0} left)
              </button>
            )}
          </div>
        )}
        {canSuggest && (
          <button
            type="button"
            onClick={() => {
              setSuggestSlot(mySuggestion?.index ?? null);
              setSuggestMode(true);
            }}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-6 py-3.5 text-sm font-black text-white hover:scale-[1.02] active:scale-[0.98] transition shadow-lg shadow-indigo-950/20"
          >
            💡 {mySuggestion !== null ? "Change hint" : "Suggest slot"}
          </button>
        )}
      </div>

      {active !== null && active.phase === "placing" && (
        <div className="mx-auto flex w-full max-w-sm gap-2 relative z-10 mt-2">
          <ReplayButton ready={now >= active.snippetPlayingUntil} />
          <PlayMoreButton ready={now >= active.snippetPlayingUntil} />
        </div>
      )}

      <div className="relative z-10 mt-2">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Your timeline {myTeam !== null ? `· ${myTeam.name}` : ""}</div>
        <MiniTimeline cards={myCards} teamColor={myTeam?.color ?? "#64748b"} />
      </div>

      <div className="relative z-10 mt-auto">
        <Scoreboard room={room} />
      </div>
    </main>
  );
}

/**
 * Vertical, explicitly-labeled placement picker (portrait-friendly).
 */
function TimelinePicker(props: {
  cards: TimelineCardView[];
  teamColor: string;
  selected: number | null;
  onSelect: (index: number) => void;
  accent?: "emerald" | "amber";
  suggestionIndices?: number[];
  eliminatedSlots?: number[];
}) {
  const { cards, teamColor, selected, onSelect, accent = "emerald", suggestionIndices = [], eliminatedSlots = [] } = props;
  
  const selClass =
    accent === "amber"
      ? "border-amber-400 bg-amber-500/20 text-amber-100 shadow-[0_0_15px_rgba(245,158,11,0.15)]"
      : "border-emerald-400 bg-emerald-500/20 text-emerald-100 shadow-[0_0_15px_rgba(16,185,129,0.15)]";

  const gapLabel = (i: number): string => {
    if (cards.length === 0) return "Place it here";
    if (i === 0) return `Before ${cards[0]!.year}`;
    if (i === cards.length) return `After ${cards[cards.length - 1]!.year}`;
    return `Between ${cards[i - 1]!.year} & ${cards[i]!.year}`;
  };

  const suggestCount = (i: number): number => suggestionIndices.filter((s) => s === i).length;

  const rows: React.ReactNode[] = [];
  for (let i = 0; i <= cards.length; i += 1) {
    const isSel = selected === i;
    const suggestN = suggestCount(i);
    const isEliminated = eliminatedSlots.includes(i);
    rows.push(
      <motion.button
        key={`gap-${i}`}
        type="button"
        whileTap={isEliminated ? undefined : { scale: 0.98 }}
        onClick={isEliminated ? undefined : () => onSelect(i)}
        disabled={isEliminated}
        className={`w-full relative flex items-center justify-center gap-2 rounded-2xl border-2 py-4 text-xs font-bold uppercase tracking-wider transition-all duration-200 ${
          isEliminated
            ? "border-rose-950/20 bg-rose-950/5 text-rose-500/40 line-through cursor-not-allowed opacity-40"
            : isSel
            ? `${selClass} border-solid`
            : "border-dashed border-slate-800 bg-slate-900/20 text-slate-400 hover:border-slate-700 hover:text-slate-200"
        }`}
      >
        <span className="text-sm">{isEliminated ? "✕" : (isSel ? "✓" : "＋")}</span>
        {isEliminated ? "Eliminated" : gapLabel(i)}
        {suggestN > 0 && !isEliminated && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-indigo-600 px-2 py-0.5 text-[9px] font-black text-white shadow-md animate-pulse">
            💡 {suggestN}
          </span>
        )}
      </motion.button>,
    );
    if (i < cards.length) {
      const card = cards[i]!;
      rows.push(
        <div
          key={`card-${card.songId}`}
          className="flex items-center gap-3 rounded-2xl border border-white/5 bg-slate-900/60 backdrop-blur-md px-4 py-3.5 shadow-sm"
          style={{ borderLeftColor: teamColor, borderLeftWidth: 4 }}
        >
          <div className="text-2xl font-black font-heading tabular-nums text-slate-100">{card.year}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-extrabold text-slate-200">{card.isSeed ? "Initial Milestone" : (card.title ?? "—")}</div>
            {card.artist !== null && !card.isSeed && <div className="truncate text-xs text-slate-400 font-semibold mt-0.5">{card.artist}</div>}
          </div>
        </div>,
      );
    }
  }

  return (
    <div className="rounded-3xl bg-slate-900/30 border border-white/5 p-2.5 py-4 sm:p-4 backdrop-blur-sm shadow-inner flex flex-col flex-1 max-h-[50vh]">
      <div className="mb-3 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-500 px-2 sm:px-1">
        <span>↑ Older</span>
        <span className="text-indigo-400 font-bold bg-indigo-950/30 rounded px-2 py-0.5 border border-indigo-900/20">Select gap</span>
        <span>Newer ↓</span>
      </div>
      <div className="flex-1 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
        {rows}
      </div>
    </div>
  );
}

/** Compact read-only horizontal strip for reference (waiting view). */
function MiniTimeline({ cards, teamColor }: { cards: TimelineCardView[]; teamColor: string }) {
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto rounded-2xl bg-slate-900/30 border border-white/5 p-3 scrollbar-hide">
      {cards.map((card) => (
        <div
          key={card.songId}
          className="flex w-24 shrink-0 flex-col items-center rounded-xl border border-white/5 bg-slate-900/80 p-2.5 text-center shadow-sm"
          style={{ borderTopColor: teamColor, borderTopWidth: 3 }}
        >
          <div className="text-lg font-black font-heading tabular-nums text-slate-100">{card.year}</div>
          <div className="line-clamp-2 text-[10px] leading-tight text-slate-400 font-semibold mt-0.5">{card.isSeed ? "Initial Milestone" : (card.title ?? "")}</div>
        </div>
      ))}
      {cards.length === 0 && (
        <div className="text-xs text-slate-500 py-3 text-center w-full uppercase tracking-wider font-bold">Timeline is empty</div>
      )}
    </div>
  );
}

function Scoreboard({ room }: { room: RoomState }) {
  const game = room.game;
  if (game === null) return null;
  return (
    <div className="space-y-2.5 bg-slate-900/30 border border-white/5 rounded-2xl p-4 backdrop-blur-sm shadow-sm">
      {room.teams.map((team) => {
        const len = game.timelines.find((t) => t.teamId === team.id)?.cards.filter((c) => !c.isSeed).length ?? 0;
        return (
          <div key={team.id} className="flex items-center gap-3 text-xs uppercase tracking-wider">
            <span className="w-16 font-black text-right" style={{ color: team.color }}>
              {team.name}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-950 border border-white/5 relative">
              <div 
                className="h-full rounded-full transition-all duration-300" 
                style={{ 
                  width: `${(len / game.target) * 100}%`, 
                  background: team.color,
                  boxShadow: `0 0 8px ${team.color}44`
                }} 
              />
            </div>
            <span className="w-10 tabular-nums text-right font-black text-slate-400">
              {len}/{game.target}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Compact "time left" pill — turns urgent when under 10s. */
function TurnClock({ msLeft }: { msLeft: number }) {
  const s = Math.ceil(msLeft / 1000);
  const urgent = s <= 10;
  return (
    <div
      className={`mt-3 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-wider tabular-nums border ${
        urgent 
          ? "bg-rose-500/10 border-rose-500/20 text-rose-300 shadow-[0_0_15px_rgba(239,68,68,0.1)] animate-pulse" 
          : "bg-slate-900 border-white/5 text-slate-300"
      }`}
    >
      ⏱️ {s}s left {urgent && s > 0 && <span className="font-normal opacity-85">— speed up!</span>}
    </div>
  );
}

function SuggestionsList({
  suggestions,
  cards,
  accentColor,
  onUse,
}: {
  suggestions: Array<{ playerId: string; playerName: string; index: number }>;
  cards: TimelineCardView[];
  accentColor: string;
  onUse: (index: number) => void;
}) {
  if (suggestions.length === 0) return null;
  const label = (i: number): string => {
    if (cards.length === 0) return "Place it here";
    if (i === 0) return `Before ${cards[0]!.year}`;
    if (i === cards.length) return `After ${cards[cards.length - 1]!.year}`;
    return `Between ${cards[i - 1]!.year} & ${cards[i]!.year}`;
  };
  return (
    <div className="rounded-2xl border border-indigo-500/20 bg-indigo-950/20 backdrop-blur-md p-4 relative z-10 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-indigo-300">
        💡 Partner suggestions
        <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px]" style={{ color: accentColor }}>
          {suggestions.length}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {suggestions.map((s) => (
          <li key={s.playerId}>
            <button
              type="button"
              onClick={() => onUse(s.index)}
              className="flex w-full items-center justify-between rounded-xl bg-slate-950/40 border border-white/5 px-3 py-2 text-left text-xs font-medium hover:bg-slate-900 hover:text-white transition"
            >
              <span>
                <span className="font-black text-indigo-200">{s.playerName}</span>
                <span className="text-slate-400 font-semibold"> → {label(s.index)}</span>
              </span>
              <span className="text-[9px] uppercase tracking-widest font-black text-indigo-300 bg-indigo-950/50 rounded px-2 py-0.5 border border-indigo-900/10">Apply</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center text-slate-100 bg-slate-950">
      <div className="absolute top-[-10%] left-[-10%] h-[50%] w-[50%] rounded-full bg-slate-800/10 blur-[80px]" />
      <div className="relative z-10 flex flex-col items-center gap-3">{children}</div>
    </main>
  );
}

function ReplayButton({ ready, disabled }: { ready: boolean; disabled?: boolean }) {
  const isDisable = !ready || disabled;
  return (
    <button
      type="button"
      disabled={isDisable}
      onClick={() => socket.emit("player:replay")}
      className="flex-1 rounded-2xl border border-white/5 bg-slate-900/60 backdrop-blur-md px-4 py-3.5 text-xs font-bold text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40 transition active:scale-[0.98]"
    >
      {disabled ? "🔇 Disabled by Distraction" : (ready ? "🔁 Replay audio" : "🔁 Playing…")}
    </button>
  );
}

function PlayMoreButton({ ready, disabled }: { ready: boolean; disabled?: boolean }) {
  const isDisable = !ready || disabled;
  return (
    <button
      type="button"
      disabled={isDisable}
      onClick={() => socket.emit("player:playMore")}
      className="flex-1 rounded-2xl border border-white/5 bg-slate-900/60 backdrop-blur-md px-4 py-3.5 text-xs font-bold text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40 transition active:scale-[0.98]"
    >
      {disabled ? "🔇 Disabled by Distraction" : (ready ? "⏩ Play more…" : "⏩ Playing…")}
    </button>
  );
}
