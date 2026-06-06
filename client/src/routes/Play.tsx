import { useEffect, useState } from "react";

import { motion } from "framer-motion";

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

  // Reset placement state every turn (turnId changes even when the same player
  // places twice in a row, e.g. solo play) and when the phase flips.
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

  // ── suspense (everyone holds breath; the year is hidden until reveal) ──
  if (active !== null && active.phase === "suspense") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center text-slate-100">
        <motion.div
          animate={{ scale: [1, 1.1, 1], rotate: [-3, 3, -3] }}
          transition={{ scale: { duration: 0.5, repeat: Infinity }, rotate: { duration: 0.18, repeat: Infinity } }}
          className="text-7xl"
        >
          🥁
        </motion.div>
        <div className="text-2xl font-black text-amber-300">Drumroll please…</div>
        <p className="text-slate-300">
          Did <span className="font-semibold" style={{ color: activeTeam?.color }}>{result?.placerName ?? active.placerName}</span> get it right?
        </p>
      </main>
    );
  }

  // ── reveal (everyone sees the result with an animated flip) ──────────
  if (active !== null && active.phase === "revealing" && result !== null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center text-slate-100" style={{ perspective: 1000 }}>
        <motion.div
          initial={{ rotateY: 180, scale: 0.9 }}
          animate={{ rotateY: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 100, damping: 14 }}
          style={{ transformStyle: "preserve-3d" }}
          className="flex flex-col items-center gap-2 rounded-2xl border-2 bg-slate-900/80 px-8 py-6"
          // eslint-disable-next-line react/forbid-dom-props
          // border colour matches the verdict
        >
          <div className="text-6xl">{result.correct ? "✅" : "❌"}</div>
          <div className="text-7xl font-black tabular-nums">{result.song.year}</div>
          <div className="text-xl font-semibold">{result.song.title ?? "Unknown"}</div>
          <div className="text-slate-400">{result.song.artist ?? ""}</div>
        </motion.div>
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
    const suggestions = active.suggestions ?? [];
    const deadlineMs = active.placeDeadline !== null ? Math.max(0, active.placeDeadline - now) : null;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-5 text-slate-100 landscape:max-w-3xl">
        <div className="text-center">
          <div className="text-sm text-slate-500">Your turn, {me.name}</div>
          <h1 className="text-2xl font-black">Where does it go?</h1>
          <p className="text-sm text-slate-400">Listen on the big screen 🔊, then tap the spot where this song fits by year.</p>
          {deadlineMs !== null && <TurnClock msLeft={deadlineMs} />}
        </div>

        <SuggestionsList suggestions={suggestions} cards={myCards} accentColor={myTeam?.color ?? "#64748b"} onUse={(i) => setSelectedSlot(i)} />

        <TimelinePicker cards={myCards} teamColor={myTeam?.color ?? "#64748b"} selected={selectedSlot} onSelect={setSelectedSlot} suggestionIndices={suggestions.map((s) => s.index)} />

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
          <div className="flex gap-2">
            <ReplayButton ready={now >= active.snippetPlayingUntil} />
            <PlayMoreButton ready={now >= active.snippetPlayingUntil} />
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
    me.tokens > 0 &&
    active.steal === null;

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
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-5 text-slate-100 landscape:max-w-3xl">
        <div className="text-center">
          <div className="text-sm font-semibold text-indigo-300">💡 Suggesting to {placerName}</div>
          <h1 className="text-2xl font-black">Where do you think it fits?</h1>
          <p className="text-sm text-slate-400">Your hint shows up on the placer's screen — they decide.</p>
        </div>
        <TimelinePicker cards={myCards} teamColor={myTeam?.color ?? "#64748b"} selected={suggestSlot} onSelect={setSuggestSlot} />
        <div className="mt-auto flex flex-col gap-2">
          <button
            type="button"
            disabled={suggestSlot === null}
            onClick={() => {
              if (suggestSlot === null) return;
              socket.emit("player:suggestPlacement", { index: suggestSlot });
              setSuggestMode(false);
            }}
            className="rounded-xl bg-indigo-500 px-6 py-3 text-lg font-semibold text-white hover:bg-indigo-400 disabled:opacity-40"
          >
            {suggestSlot === null ? "Tap a spot above ↑" : "Send suggestion 💡"}
          </button>
          <button type="button" onClick={() => setSuggestMode(false)} className="text-sm text-slate-500">
            Cancel
          </button>
        </div>
      </main>
    );
  }

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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-5 text-slate-100 landscape:max-w-3xl">
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
      <div className="flex flex-wrap justify-center gap-2">
        {canSteal && (
          <button
            type="button"
            onClick={() => setStealMode(true)}
            className="rounded-lg bg-amber-600/90 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-500"
          >
            🥷 Steal · {me.tokens} {me.tokens === 1 ? "token" : "tokens"}
          </button>
        )}
        {canSuggest && (
          <button
            type="button"
            onClick={() => {
              setSuggestSlot(mySuggestion?.index ?? null);
              setSuggestMode(true);
            }}
            className="rounded-lg bg-indigo-500/90 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
          >
            💡 {mySuggestion !== null ? "Update suggestion" : "Suggest a spot"}
          </button>
        )}
      </div>

      {active !== null && active.phase === "placing" && (
        <div className="mx-auto flex w-full max-w-sm gap-2">
          <ReplayButton ready={now >= active.snippetPlayingUntil} />
          <PlayMoreButton ready={now >= active.snippetPlayingUntil} />
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
  /** Indices the placer's teammates have suggested — badged but not selected. */
  suggestionIndices?: number[];
}) {
  const { cards, teamColor, selected, onSelect, accent = "emerald", suggestionIndices = [] } = props;
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

  const suggestCount = (i: number): number => suggestionIndices.filter((s) => s === i).length;

  const rows: React.ReactNode[] = [];
  for (let i = 0; i <= cards.length; i += 1) {
    const isSel = selected === i;
    const suggestN = suggestCount(i);
    rows.push(
      <button
        key={`gap-${i}`}
        type="button"
        onClick={() => onSelect(i)}
        className={`relative flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-bold transition ${
          isSel ? `${selClass} border-solid` : "border-dashed border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
        }`}
      >
        <span className="text-base">{isSel ? "✓" : "＋"}</span>
        {gapLabel(i)}
        {suggestN > 0 && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] text-white">
            💡 {suggestN}
          </span>
        )}
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

/** Compact "time left" pill — turns urgent when under 10s. */
function TurnClock({ msLeft }: { msLeft: number }) {
  const s = Math.ceil(msLeft / 1000);
  const urgent = s <= 10;
  return (
    <div
      className={`mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold tabular-nums ${
        urgent ? "bg-rose-500/20 text-rose-300" : "bg-slate-800 text-slate-300"
      }`}
    >
      ⏱ {s}s {urgent && s > 0 && <span className="text-xs font-normal opacity-80">— time's running out!</span>}
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
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-200">
        💡 Teammate suggestions
        <span className="rounded-full bg-indigo-500/30 px-1.5 py-0.5 text-[10px]" style={{ color: accentColor }}>
          {suggestions.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {suggestions.map((s) => (
          <li key={s.playerId}>
            <button
              type="button"
              onClick={() => onUse(s.index)}
              className="flex w-full items-center justify-between rounded-lg bg-slate-900/60 px-3 py-1.5 text-left text-sm hover:bg-slate-900"
            >
              <span>
                <span className="font-semibold text-indigo-200">{s.playerName}</span>
                <span className="text-slate-400"> → {label(s.index)}</span>
              </span>
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Use</span>
            </button>
          </li>
        ))}
      </ul>
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
      className="flex-1 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
    >
      {ready ? "🔁 Play again" : "🔁 Playing…"}
    </button>
  );
}

function PlayMoreButton({ ready }: { ready: boolean }) {
  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => socket.emit("player:playMore")}
      className="flex-1 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
    >
      {ready ? "⏩ Play more…" : "⏩ Playing…"}
    </button>
  );
}
