import { AnimatePresence, motion } from "framer-motion";

import type { TimelineCardView } from "@songster/shared/game";
import type { RoomState } from "@songster/shared/room";

import { artUrl } from "../api";

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
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
        <div className="text-8xl">🏆</div>
        <div className="text-2xl uppercase tracking-[0.3em] text-slate-500">Winner</div>
        <div className="text-7xl font-black" style={{ color: team?.color }}>
          {team?.name}
        </div>
        <Scoreboard room={room} />
        {commentaryPending && (
          <div className="mt-6 flex items-center gap-3 rounded-full border border-amber-400/40 bg-amber-500/10 px-5 py-2 text-amber-200">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-amber-300" />
            🎙 The host is writing the finale…
          </div>
        )}
      </div>
    );
  }

  const active = game.activeTurn;
  if (active === null) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <div className="text-5xl">⏸️</div>
        <h2 className="text-2xl font-bold text-slate-400">Waiting for players…</h2>
        <Scoreboard room={room} />
      </div>
    );
  }
  const result = game.lastResult;
  const activeTeam = room.teams.find((t) => t.id === active.teamId);
  const activeCards = game.timelines.find((t) => t.teamId === active.teamId)?.cards ?? [];
  const revealing = active.phase === "revealing" && result !== null;
  const suspense = active.phase === "suspense";

  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <div className="text-sm uppercase tracking-[0.3em] text-slate-500">Now playing</div>
        <h2 className="mt-1 text-4xl font-black">
          <span style={{ color: activeTeam?.color }}>{activeTeam?.name}</span>
          <span className="text-slate-400">
            {" · "}
            {active.placerName}
            {suspense ? " locked it in" : revealing ? "'s pick" : " is placing"}
          </span>
        </h2>
        {active.steal !== null && !revealing && (
          <p className="mt-2 text-2xl font-bold text-amber-400">
            🥷 {room.teams.find((t) => t.id === active.steal!.teamId)?.name} is stealing!
          </p>
        )}
      </div>

      {/* The card being placed: mystery (placing) → drumroll (suspense) → flip reveal (revealing). */}
      <div className="flex justify-center" style={{ perspective: 1200 }}>
        <AnimatePresence mode="wait">
          {revealing ? (
            <motion.div
              key="reveal"
              initial={{ rotateY: 180, scale: 0.9 }}
              animate={{ rotateY: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ rotateY: { type: "spring", stiffness: 90, damping: 14 }, scale: { duration: 0.4 } }}
              style={{ transformStyle: "preserve-3d" }}
              className="flex w-72 flex-col items-center gap-2 rounded-2xl border-2 bg-slate-900 p-5 shadow-2xl"
            >
              <div
                className="absolute -inset-1 rounded-2xl"
                aria-hidden
                style={{ background: result.correct ? "#34d39933" : "#fb718533", filter: "blur(20px)", zIndex: -1 }}
              />
              <div className="absolute inset-0 rounded-2xl border-2" style={{ borderColor: result.correct ? "#34d399" : "#fb7185", pointerEvents: "none" }} aria-hidden />
              <div className="text-5xl">{result.correct ? "✅" : "❌"}</div>
              {result.song.hasArt ? (
                <img src={artUrl(result.song.songId)} alt="" className="h-28 w-28 rounded-lg object-cover" />
              ) : (
                <div className="flex h-28 w-28 items-center justify-center rounded-lg bg-slate-800 text-4xl text-slate-600">♪</div>
              )}
              <div className="text-6xl font-black tabular-nums">{result.song.year}</div>
              <div className="text-center text-lg font-semibold">{result.song.title ?? "Unknown"}</div>
              <div className="text-center text-slate-400">{result.song.artist ?? ""}</div>
              {result.steal !== null && (
                <div
                  className="mt-1 rounded-lg px-3 py-1 text-center text-sm font-bold"
                  style={{
                    background: result.steal.correct ? "#78350f" : "transparent",
                    color: result.steal.correct ? "#fbbf24" : "#64748b",
                  }}
                >
                  {result.steal.correct ? `🥷 STOLEN by ${result.steal.playerName}!` : `${result.steal.playerName}'s steal missed`}
                </div>
              )}
            </motion.div>
          ) : suspense ? (
            <motion.div
              key="suspense"
              initial={{ scale: 0.95 }}
              animate={{ scale: [1, 1.06, 1], rotate: [-1.5, 1.5, -1.5] }}
              exit={{ rotateY: 90, opacity: 0 }}
              transition={{ scale: { duration: 0.6, repeat: Infinity }, rotate: { duration: 0.18, repeat: Infinity } }}
              className="flex h-44 w-44 items-center justify-center rounded-2xl border-4 border-amber-400 bg-slate-900 text-6xl shadow-2xl shadow-amber-500/30"
            >
              🥁
            </motion.div>
          ) : (
            <motion.div
              key="mystery"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-44 w-44 animate-pulse items-center justify-center rounded-full border-4 border-slate-700 bg-slate-900 text-7xl"
            >
              ❔
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Suspense caption — generates excitement during the drumroll. */}
      {suspense && (
        <motion.div
          key="suspense-caption"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto text-center"
        >
          <div className="text-sm uppercase tracking-[0.3em] text-amber-300">Drumroll please…</div>
          <p className="mt-1 text-2xl font-bold text-slate-200">Did {active.placerName} get it right?</p>
          {commentaryPending && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-4 py-1.5 text-sm text-amber-200">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-300" />
              🎙 Writing commentary…
            </div>
          )}
        </motion.div>
      )}

      {emcee != null && emcee.text.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mx-auto max-w-2xl text-center"
        >
          <div className="text-sm uppercase tracking-[0.25em] text-amber-300">🎙 {emcee.hostName}</div>
          <p className="mt-1 text-xl italic text-slate-200">“{emcee.text}”</p>
        </motion.div>
      ) : null}

      {/* Active team's timeline (with a "?" placeholder at the guessed slot during suspense). */}
      <div>
        <div className="mb-2 text-center text-sm text-slate-500" style={{ color: activeTeam?.color }}>
          {activeTeam?.name}'s timeline
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {timelineWithPlaceholder(activeCards, suspense ? active.pendingPlacement?.index ?? null : null).map((entry, i) =>
            entry === "placeholder" ? (
              <motion.div
                key={`ph-${i}`}
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 0.7, repeat: Infinity }}
                className="flex w-24 flex-col items-center rounded-lg border-2 border-dashed border-amber-400 bg-slate-900 p-2 text-center"
                style={{ borderTopColor: activeTeam?.color, borderTopWidth: 3 }}
              >
                <div className="text-2xl font-black text-amber-300">?</div>
                <div className="line-clamp-2 text-[11px] leading-tight text-amber-300/80">{active.placerName}'s guess</div>
              </motion.div>
            ) : (
              <div
                key={entry.songId}
                className="flex w-24 flex-col items-center rounded-lg border border-slate-700 bg-slate-800 p-2 text-center"
                style={{ borderTopColor: activeTeam?.color, borderTopWidth: 3 }}
              >
                <div className="text-2xl font-black tabular-nums">{entry.year}</div>
                <div className="line-clamp-2 text-[11px] leading-tight text-slate-400">{entry.title ?? ""}</div>
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
    <div className="mx-auto w-full max-w-2xl space-y-2">
      {room.teams.map((team) => {
        const len = game.timelines.find((t) => t.teamId === team.id)?.cards.length ?? 0;
        return (
          <div key={team.id} className="flex items-center gap-3">
            <span className="w-16 text-right font-bold" style={{ color: team.color }}>
              {team.name}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full transition-all" style={{ width: `${(len / game.target) * 100}%`, background: team.color }} />
            </div>
            <span className="w-12 tabular-nums text-slate-400">
              {len}/{game.target}
            </span>
          </div>
        );
      })}
    </div>
  );
}
