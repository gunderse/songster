import { AnimatePresence, motion } from "framer-motion";

import type { TimelineCardView } from "@songster/shared/game";
import type { RoomState } from "@songster/shared/room";

import { artUrl } from "../api";
import { socket } from "../socket";

/** Splice in a "placeholder" sentinel at the guessed slot during the suspense. */
function timelineWithPlaceholder(
  cards: TimelineCardView[],
  placeholderIndex: number | null,
): Array<TimelineCardView | "placeholder"> {
  if (placeholderIndex === null) return [...cards];
  const out: Array<TimelineCardView | "placeholder"> = [];
  for (let i = 0; i <= cards.length; i += 1) {
    if (i === placeholderIndex) out.push("placeholder");
    if (i < cards.length) out.push(cards[i]!);
  }
  return out;
}

export function HubGame({
  room,
  emcee,
  commentaryPending = false,
}: {
  room: RoomState;
  emcee?: { hostName: string; text: string } | null;
  commentaryPending?: boolean;
}) {
  const game = room.game;
  if (game === null) return null;

  if (game.winnerTeamId !== null) {
    const team = room.teams.find((t) => t.id === game.winnerTeamId);
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
        {/* Confetti + trophy glow */}
        <motion.div 
          animate={{ scale: [1, 1.15, 1], rotate: [0, 5, -5, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          className="text-9xl drop-shadow-[0_0_50px_rgba(251,191,36,0.6)]"
        >
          🏆
        </motion.div>
        <div className="text-sm font-bold uppercase tracking-[0.4em] text-amber-400">Grand Champion</div>
        <div className="text-7xl font-black font-heading tracking-tight" style={{ color: team?.color, textShadow: `0 0 40px ${team?.color}33` }}>
          {team?.name}
        </div>
        <div className="mt-4 w-full max-w-xl">
          <Scoreboard room={room} />
        </div>
        {commentaryPending && (
          <div className="mt-8 flex items-center gap-3 rounded-full border border-amber-400/30 bg-amber-500/10 px-6 py-2.5 text-sm font-semibold text-amber-200 backdrop-blur-md">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-amber-400" />
            🎙 The host is writing the grand finale…
          </div>
        )}
        <button
          type="button"
          onClick={() => socket.emit("room:start", { code: room.code })}
          className="mt-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 px-10 py-4.5 text-xl font-black text-white hover:scale-[1.03] active:scale-[0.98] transition shadow-lg shadow-emerald-950/20 animate-bounce"
        >
          🎮 Play another game
        </button>
      </div>
    );
  }

  const active = game.activeTurn;
  if (active === null) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
        <motion.div 
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-6xl"
        >
          ⏸️
        </motion.div>
        <h2 className="text-2xl font-bold uppercase tracking-wider text-slate-400">Waiting for players…</h2>
        <div className="w-full max-w-xl">
          <Scoreboard room={room} />
        </div>
      </div>
    );
  }
  const result = game.lastResult;
  const activeTeam = room.teams.find((t) => t.id === active.teamId);
  const activeCards = game.timelines.find((t) => t.teamId === active.teamId)?.cards ?? [];
  const revealing = active.phase === "revealing" && result !== null;
  const suspense = active.phase === "suspense";

  return (
    <div className="flex flex-col gap-10">
      <div className="text-center">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-slate-500">Active Turn</div>
        <h2 className="mt-1.5 text-4xl font-black font-heading tracking-tight">
          <span style={{ color: activeTeam?.color, textShadow: `0 0 25px ${activeTeam?.color}22` }}>{activeTeam?.name}</span>
          <span className="text-slate-400 font-medium">
            {" · "}
            {active.placerName}
            {suspense ? " locked in a guess" : revealing ? (result.timeout ? "'s time ran out" : "'s result") : " is choosing"}
          </span>
        </h2>
        {active.steal !== null && !revealing && (
          <motion.p 
            animate={{ scale: [1, 1.03, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="mt-3 text-xl font-extrabold text-amber-400 tracking-wide"
          >
            🥷 {room.teams.find((t) => t.id === active.steal!.teamId)?.name} is challenging with a STEAL!
          </motion.p>
        )}
        {active.phase === "placing" && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => socket.emit("hub:skipSong")}
              className="rounded-xl border border-rose-900/40 bg-rose-950/20 text-rose-400 hover:bg-rose-900/30 hover:text-rose-200 px-5 py-2 text-xs font-bold uppercase tracking-wider transition duration-200 active:scale-95 cursor-pointer shadow-md"
              title="Skip song without deduction"
            >
              ⏭ Skip Song
            </button>
          </div>
        )}
      </div>

      {/* The card being placed: mystery (placing) → drumroll (suspense) → flip reveal (revealing). */}
      <div className="flex justify-center" style={{ perspective: 1500 }}>
        <AnimatePresence mode="wait">
          {revealing ? (
            <motion.div
              key="reveal"
              initial={{ rotateY: 180, scale: 0.9, opacity: 0 }}
              animate={{ rotateY: 0, scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ rotateY: { type: "spring", stiffness: 90, damping: 15 }, scale: { duration: 0.4 } }}
              style={{ transformStyle: "preserve-3d" }}
              className="relative flex w-80 flex-col items-center gap-3 rounded-3xl border-2 bg-gradient-to-b from-slate-900 to-slate-950 p-6 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)]"
            >
              {/* Outer Glow according to correctness */}
              <div
                className="absolute -inset-1.5 rounded-3xl"
                aria-hidden
                style={{ 
                  background: result.correct ? "radial-gradient(circle, rgba(52,211,153,0.15) 0%, transparent 70%)" : "radial-gradient(circle, rgba(251,113,133,0.15) 0%, transparent 70%)", 
                  filter: "blur(25px)", 
                  zIndex: -1 
                }}
              />
              <div 
                className="absolute inset-0 rounded-3xl border-2" 
                style={{ borderColor: result.correct ? "#10b981" : "#f43f5e", pointerEvents: "none", boxShadow: result.correct ? "0 0 25px rgba(16,185,129,0.2)" : "0 0 25px rgba(244,63,94,0.2)" }} 
                aria-hidden 
              />
              <div className="text-6xl">{result.correct ? "✅" : (result.timeout ? "⏰" : "❌")}</div>
              <div className="relative mt-2 h-32 w-32 group">
                {result.song.hasArt ? (
                  <img src={artUrl(result.song.songId)} alt="" className="h-full w-full rounded-2xl object-cover border border-white/10 shadow-lg transition-transform group-hover:scale-105" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-2xl bg-slate-800 text-5xl text-slate-500 border border-white/10">♪</div>
                )}
                {/* Vinyl record design peeking out */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -z-10 h-28 w-28 rounded-full bg-black border border-white/10 shadow-inner group-hover:translate-x-1 transition-transform" />
              </div>
              <div className="text-6xl font-black font-heading tabular-nums tracking-tight mt-3 text-slate-100">{result.song.year}</div>
              <div className="text-center text-xl font-bold font-heading line-clamp-1 text-slate-100">{result.song.title ?? "Unknown"}</div>
              <div className="text-center text-sm font-semibold text-slate-400 line-clamp-1">{result.song.artist ?? ""}</div>
              {result.steal !== null && (
                <div
                  className="mt-3 rounded-xl px-4 py-1.5 text-center text-xs uppercase tracking-widest font-extrabold border"
                  style={{
                    background: result.steal.correct ? "rgba(245,158,11,0.1)" : "rgba(30,41,59,0.4)",
                    borderColor: result.steal.correct ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.05)",
                    color: result.steal.correct ? "#fbbf24" : "#64748b",
                    boxShadow: result.steal.correct ? "0 0 15px rgba(245,158,11,0.1)" : "none"
                  }}
                >
                  {result.steal.correct ? `🥷 STOLEN BY ${result.steal.playerName}!` : `${result.steal.playerName}'s steal missed`}
                </div>
              )}
            </motion.div>
          ) : suspense ? (
            <motion.div
              key="suspense"
              initial={{ scale: 0.9 }}
              animate={{ scale: [1, 1.08, 1], rotate: [-2, 2, -2] }}
              exit={{ rotateY: 90, opacity: 0 }}
              transition={{ scale: { duration: 0.6, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 0.15, repeat: Infinity } }}
              className="relative flex h-48 w-48 items-center justify-center rounded-3xl border-4 border-amber-400 bg-slate-900 text-7xl shadow-[0_0_40px_rgba(245,158,11,0.4)]"
            >
              {/* Pulsing spotlight behind the drums */}
              <div className="absolute inset-[-20px] rounded-full bg-amber-500/10 blur-xl animate-pulse pointer-events-none" />
              🥁
            </motion.div>
          ) : (
            <motion.div
              key="mystery"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative w-64 h-64 flex items-center justify-center"
            >
              {/* Outer glowing ambient background */}
              <div 
                className="absolute inset-2 rounded-full animate-pulse blur-xl"
                style={{
                  background: `radial-gradient(circle, ${activeTeam?.color ?? '#6366f1'}44 0%, transparent 70%)`
                }}
              />
              
              {/* Spinning Vinyl Record */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                className="relative w-56 h-56 rounded-full bg-black flex items-center justify-center shadow-[0_20px_50px_rgba(0,0,0,0.8)] border border-neutral-800"
                style={{
                  backgroundImage: 'repeating-radial-gradient(circle, #0c0a09, #0c0a09 2px, #1c1917 3px, #0c0a09 4px)'
                }}
              >
                {/* Center Record Label (colored by team) */}
                <div 
                  className="w-20 h-20 rounded-full flex items-center justify-center shadow-inner relative"
                  style={{ 
                    backgroundColor: activeTeam?.color ?? "#6366f1",
                    boxShadow: "inset 0 0 12px rgba(0,0,0,0.5)"
                  }}
                >
                  {/* Music note center */}
                  <span className="text-3xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] select-none">🎵</span>
                </div>

                {/* Spindle hole */}
                <div className="absolute w-4 h-4 rounded-full bg-slate-950 shadow-inner" />
              </motion.div>

              {/* Static Specular Shiny Highlights (reflection doesn't rotate) */}
              <div 
                className="absolute w-56 h-56 rounded-full pointer-events-none mix-blend-screen opacity-50"
                style={{
                  background: 'conic-gradient(from 0deg, transparent 15%, rgba(255,255,255,0.12) 25%, transparent 35%, transparent 65%, rgba(255,255,255,0.12) 75%, transparent 85%)'
                }}
              />

              {/* Pulsing Outer Ring */}
              <motion.div
                animate={{ scale: [1, 1.05, 1], opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                className="absolute w-60 h-60 rounded-full border-2 border-dashed pointer-events-none"
                style={{ borderColor: activeTeam?.color ?? "#6366f1" }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Suspense caption — generates excitement during the drumroll. */}
      {suspense && (
        <motion.div
          key="suspense-caption"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto text-center"
        >
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-amber-300">Drumroll please…</div>
          <p className="mt-1.5 text-2xl font-bold text-slate-200">Did {active.placerName} place it correctly?</p>
          {commentaryPending && (
            <div className="mt-4 inline-flex items-center gap-2.5 rounded-full border border-amber-400/20 bg-amber-500/5 px-5 py-2 text-xs font-semibold text-amber-300 backdrop-blur-md">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
              🎙 Writing commentary…
            </div>
          )}
        </motion.div>
      )}

      {emcee != null && emcee.text.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-2xl text-center bg-slate-900/40 border border-white/5 rounded-2xl p-5 backdrop-blur-md shadow-lg"
        >
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-amber-400">🎙 {emcee.hostName}</div>
          <p className="mt-2 text-xl font-medium italic text-slate-200 leading-relaxed">“{emcee.text}”</p>
        </motion.div>
      ) : null}

      {/* Active team's timeline (with a "?" placeholder at the guessed slot during suspense). */}
      <div className="bg-slate-900/20 border border-white/5 rounded-3xl p-6 backdrop-blur-sm">
        <div className="mb-4 text-center text-xs font-bold uppercase tracking-widest text-slate-400" style={{ color: activeTeam?.color }}>
          {activeTeam?.name}'s timeline
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {timelineWithPlaceholder(activeCards, suspense ? active.pendingPlacement?.index ?? null : null).map((entry, i) =>
            entry === "placeholder" ? (
              <motion.div
                key={`ph-${i}`}
                animate={{ scale: [1, 1.05, 1], boxShadow: ["0 0 10px rgba(245,158,11,0.2)", "0 0 20px rgba(245,158,11,0.4)", "0 0 10px rgba(245,158,11,0.2)"] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="flex w-28 flex-col items-center rounded-xl border-2 border-dashed border-amber-400 bg-slate-950/80 p-3 text-center"
                style={{ borderTopColor: activeTeam?.color, borderTopWidth: 4 }}
              >
                <div className="text-3xl font-black text-amber-300 font-heading">?</div>
                <div className="line-clamp-2 text-[10px] leading-tight text-amber-300/80 font-semibold mt-1">{active.placerName}'s guess</div>
              </motion.div>
            ) : (
              <div
                key={entry.songId}
                className="flex w-28 flex-col items-center rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-center shadow-md hover:border-slate-700 transition"
                style={{ borderTopColor: activeTeam?.color, borderTopWidth: 4 }}
              >
                <div className="text-2xl font-black font-heading tabular-nums text-slate-100">{entry.year}</div>
                <div className="line-clamp-2 text-[10px] leading-snug text-slate-400 mt-1 font-medium">{entry.isSeed ? "Initial Milestone" : (entry.title ?? "")}</div>
              </div>
            ),
          )}
        </div>
      </div>

      <Scoreboard room={room} />
    </div>
  );
}

function Scoreboard({ room }: { room: RoomState }) {
  const game = room.game;
  if (game === null) return null;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 bg-slate-900/30 border border-white/5 rounded-2xl p-5 backdrop-blur-sm">
      {room.teams.map((team) => {
        const len = game.timelines.find((t) => t.teamId === team.id)?.cards.filter((c) => !c.isSeed).length ?? 0;
        const playersForTeam = room.players.filter((p) => p.teamId === team.id).map((p) => p.name);
        return (
          <div key={team.id} className="flex items-center gap-4">
            <div className="w-28 flex flex-col items-end select-none min-w-0">
              <span className="font-black font-heading text-sm uppercase tracking-wider leading-none" style={{ color: team.color }}>
                {team.name}
              </span>
              <span className="text-[10px] text-slate-500 font-semibold truncate max-w-[110px] mt-1" title={playersForTeam.join(", ")}>
                {playersForTeam.length > 0 ? playersForTeam.join(", ") : "no players"}
              </span>
            </div>
            <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-slate-950 border border-white/5 p-[2px]">
              <div 
                className="h-full rounded-full transition-all duration-500 relative overflow-hidden" 
                style={{ 
                  width: `${(len / game.target) * 100}%`, 
                  background: `linear-gradient(to right, ${team.color}cc, ${team.color})`,
                  boxShadow: `0 0 12px ${team.color}55`
                }} 
              >
                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.1),rgba(255,255,255,0.3)_50%,rgba(255,255,255,0.1))] w-[200%] -translate-x-[50%] animate-[shimmer_3s_infinite]" style={{ transform: "skewX(-20deg)" }} />
              </div>
            </div>
            <span className="w-12 tabular-nums text-right text-xs font-bold text-slate-400">
              {len}/{game.target}
            </span>
          </div>
        );
      })}
    </div>
  );
}
