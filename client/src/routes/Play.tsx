import { useEffect, useState } from "react";

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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // Reset placement state every turn (turnId changes even when the same player
  // places twice in a row, e.g. solo play) and when the phase flips.
  const turnSig = active ? `${active.turnId}|${active.phase}` : "none";
  useEffect(() => {
    setSelectedSlot(null);
    setCommitted(false);
    setStealMode(false);
    setStealSlot(null);
  }, [turnSig]);

  if (game === null || me === null) {
    return <Centered>Loading…</Centered>;
  }

  // ── game over ─────────────────────────────────────────────────────────
  if (game.winnerTeamId !== null) {
    const won = game.winnerTeamId === me.teamId;
    const winningTeam = room.teams.find((t) => t.id === game.winnerTeamId);
    return (
      <Centered>
        <div className="text-7xl">{won ? "🏆" : "🎬"}</div>
        <h1 className="text-3xl font-black">{won ? "Your team wins!" : "Game over"}</h1>
        <p className="text-lg" style={{ color: winningTeam?.color }}>
          {winningTeam?.name} took it
        </p>
      </Centered>
    );
  }

  const amPlacer = active !== null && active.placerId === me.id;
  const placerName = active !== null ? room.players.find((p) => p.id === active.placerId)?.name ?? "—" : "";
  const activeTeam = active !== null ? room.teams.find((t) => t.id === active.teamId) : null;

  // ── reveal (everyone sees the result) ─────────────────────────────────
  if (active !== null && active.phase === "revealing" && result !== null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center text-slate-100">
        <div className="text-6xl">{result.correct ? "✅" : "❌"}</div>
        <div className="text-7xl font-black tabular-nums">{result.song.year}</div>
        <div className="text-xl font-semibold">{result.song.title ?? "Unknown"}</div>
        <div className="text-slate-400">{result.song.artist ?? ""}</div>
        <p className="mt-2 text-sm" style={{ color: result.correct ? "#34d399" : "#fb7185" }}>
          {result.placerName} {result.correct ? "nailed it" : "missed"} for {activeTeam?.name}
        </p>
        {result.steal !== null && (
          <p className="text-sm font-semibold" style={{ color: result.steal.correct ? "#fbbf24" : "#64748b" }}>
            {result.steal.correct ? `🥷 STOLEN by ${result.steal.playerName}!` : `${result.steal.playerName}'s steal missed`}
          </p>
        )}
      </main>
    );
  }

  // ── my turn to place ──────────────────────────────────────────────────
  if (amPlacer && active.phase === "placing") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-5 text-slate-100">
        <div className="text-center">
          <div className="text-sm text-slate-500">Your turn, {me.name}</div>
          <h1 className="text-2xl font-black">Where does it go?</h1>
          <p className="text-sm text-slate-400">Listen on the big screen 🔊, then tap the spot where this song fits by year.</p>
        </div>

        <TimelinePicker cards={myCards} teamColor={myTeam?.color ?? "#64748b"} selected={selectedSlot} onSelect={setSelectedSlot} />

        <div className="mt-auto flex flex-col gap-2">
          <button
            type="button"
            disabled={selectedSlot === null || committed}
            onClick={() => {
              if (selectedSlot === null) return;
              socket.emit("player:placeCard", { index: selectedSlot });
              setCommitted(true);
            }}
            className="rounded-xl bg-emerald-600 px-6 py-3 text-lg font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {committed ? "Locked in…" : selectedSlot === null ? "Tap a spot above ↑" : "Lock it in"}
          </button>
          {!committed && me.tokens > 0 && (
            <button
              type="button"
              onClick={() => socket.emit("player:useSkip")}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              🎟️ Skip this song · {me.tokens} {me.tokens === 1 ? "token" : "tokens"} left
            </button>
          )}
          <ReplayButton ready={now >= active.snippetPlayingUntil} />
        </div>
      </main>
    );
  }

  const canSteal =
    active !== null &&
    active.phase === "placing" &&
    me.teamId !== null &&
    me.teamId !== active.teamId &&
    me.tokens > 0 &&
    active.steal === null;

  // ── steal mode: place your challenge on your own timeline ─────────────
  if (stealMode && active !== null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-5 text-slate-100">
        <div className="text-center">
          <div className="text-sm font-semibold text-amber-400">🥷 Stealing from {activeTeam?.name}</div>
          <h1 className="text-2xl font-black">Where does it go?</h1>
          <p className="text-sm text-slate-400">
            Place it on YOUR timeline. If they're wrong and you're right, you take the card.
          </p>
        </div>
        <TimelinePicker cards={myCards} teamColor={myTeam?.color ?? "#64748b"} selected={stealSlot} onSelect={setStealSlot} accent="amber" />
        <div className="mt-auto flex flex-col gap-2">
          <button
            type="button"
            disabled={stealSlot === null}
            onClick={() => {
              if (stealSlot === null) return;
              socket.emit("player:stealPlace", { index: stealSlot });
              setStealMode(false);
            }}
            className="rounded-xl bg-amber-600 px-6 py-3 text-lg font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
          >
            {stealSlot === null ? "Tap a spot above ↑" : "Steal it here! (1 token)"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStealMode(false);
              setStealSlot(null);
            }}
            className="text-sm text-slate-500"
          >
            Cancel
          </button>
        </div>
      </main>
    );
  }

  // ── waiting (someone else is placing) ─────────────────────────────────
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-5 text-slate-100">
      <div className="text-center">
        <div className="text-sm text-slate-500">Room {room.code}</div>
        {active !== null ? (
          <h1 className="text-xl font-bold">
            <span style={{ color: activeTeam?.color }}>{activeTeam?.name}</span> is placing
            <div className="text-sm font-normal text-slate-400">{placerName} is choosing · listen on the hub 🔊</div>
          </h1>
        ) : (
          <h1 className="text-xl font-bold">Get ready…</h1>
        )}
      </div>

      {active !== null && me.teamId !== active.teamId && active.steal !== null && (
        <p className="text-center text-sm font-semibold text-amber-400">
          🥷 {active.steal.playerName} ({room.teams.find((t) => t.id === active.steal!.teamId)?.name}) is stealing!
        </p>
      )}
      {canSteal && (
        <button
          type="button"
          onClick={() => setStealMode(true)}
          className="self-center rounded-lg bg-amber-600/90 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-500"
        >
          🥷 Steal this song · {me.tokens} {me.tokens === 1 ? "token" : "tokens"}
        </button>
      )}

      {active !== null && active.phase === "placing" && (
        <div className="flex justify-center">
          <ReplayButton ready={now >= active.snippetPlayingUntil} />
        </div>
      )}

      <div>
        <div className="mb-1 text-sm text-slate-500">Your team{myTeam !== null ? ` · ${myTeam.name}` : ""}</div>
        <MiniTimeline cards={myCards} teamColor={myTeam?.color ?? "#64748b"} />
      </div>

      <Scoreboard room={room} />
    </main>
  );
}

/**
 * Vertical, explicitly-labeled placement picker (portrait-friendly).
 * Oldest at the top → newest at the bottom; tap a labeled gap to choose where
 * the mystery song belongs ("Before 1985", "Between 1985 and 1995", "After 1995").
 */
function TimelinePicker(props: {
  cards: TimelineCardView[];
  teamColor: string;
  selected: number | null;
  onSelect: (index: number) => void;
  accent?: "emerald" | "amber";
}) {
  const { cards, teamColor, selected, onSelect, accent = "emerald" } = props;
  const selClass =
    accent === "amber"
      ? "border-amber-400 bg-amber-500/25 text-amber-100"
      : "border-emerald-400 bg-emerald-500/25 text-emerald-100";

  const gapLabel = (i: number): string => {
    if (cards.length === 0) return "Place it here";
    if (i === 0) return `Before ${cards[0]!.year}`;
    if (i === cards.length) return `After ${cards[cards.length - 1]!.year}`;
    return `Between ${cards[i - 1]!.year} & ${cards[i]!.year}`;
  };

  const rows: React.ReactNode[] = [];
  for (let i = 0; i <= cards.length; i += 1) {
    const isSel = selected === i;
    rows.push(
      <button
        key={`gap-${i}`}
        type="button"
        onClick={() => onSelect(i)}
        className={`flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-bold transition ${
          isSel ? `${selClass} border-solid` : "border-dashed border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
        }`}
      >
        <span className="text-base">{isSel ? "✓" : "＋"}</span>
        {gapLabel(i)}
      </button>,
    );
    if (i < cards.length) {
      const card = cards[i]!;
      rows.push(
        <div
          key={`card-${card.songId}`}
          className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2"
          style={{ borderLeftColor: teamColor, borderLeftWidth: 4 }}
        >
          <div className="text-2xl font-black tabular-nums">{card.year}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-200">{card.title ?? "—"}</div>
            {card.artist !== null && <div className="truncate text-xs text-slate-500">{card.artist}</div>}
          </div>
        </div>,
      );
    }
  }

  return (
    <div className="rounded-2xl bg-slate-900/50 p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <span>↑ Older</span>
        <span className="text-slate-400">Tap where it fits</span>
        <span>Newer ↓</span>
      </div>
      <div className="flex max-h-[52vh] flex-col gap-1.5 overflow-y-auto pr-1">{rows}</div>
    </div>
  );
}

/** Compact read-only horizontal strip for reference (waiting view). */
function MiniTimeline({ cards, teamColor }: { cards: TimelineCardView[]; teamColor: string }) {
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto rounded-xl bg-slate-900/50 p-2">
      {cards.map((card) => (
        <div
          key={card.songId}
          className="flex w-20 shrink-0 flex-col items-center rounded-md border border-slate-700 bg-slate-800 p-2 text-center"
          style={{ borderTopColor: teamColor, borderTopWidth: 3 }}
        >
          <div className="text-lg font-black tabular-nums">{card.year}</div>
          <div className="line-clamp-2 text-[10px] leading-tight text-slate-400">{card.title ?? ""}</div>
        </div>
      ))}
    </div>
  );
}

function Scoreboard({ room }: { room: RoomState }) {
  const game = room.game;
  if (game === null) return null;
  return (
    <div className="mt-1 space-y-1.5">
      {room.teams.map((team) => {
        const len = game.timelines.find((t) => t.teamId === team.id)?.cards.length ?? 0;
        return (
          <div key={team.id} className="flex items-center gap-2 text-sm">
            <span className="w-12 font-semibold" style={{ color: team.color }}>
              {team.name}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full" style={{ width: `${(len / game.target) * 100}%`, background: team.color }} />
            </div>
            <span className="tabular-nums text-slate-400">
              {len}/{game.target}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center text-slate-100">{children}</main>;
}

function ReplayButton({ ready }: { ready: boolean }) {
  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => socket.emit("player:replay")}
      className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
    >
      {ready ? "🔁 Play again on the hub" : "🔁 Playing…"}
    </button>
  );
}
