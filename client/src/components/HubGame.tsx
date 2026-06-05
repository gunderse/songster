import type { RoomState } from "@songster/shared/room";

import { artUrl } from "../api";

export function HubGame({ room }: { room: RoomState }) {
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
      </div>
    );
  }

  const active = game.activeTurn;
  const result = game.lastResult;
  const activeTeam = active !== null ? room.teams.find((t) => t.id === active.teamId) : null;
  const activeCards = active !== null ? game.timelines.find((t) => t.teamId === active.teamId)?.cards ?? [] : [];
  const revealing = active !== null && active.phase === "revealing" && result !== null;

  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <div className="text-sm uppercase tracking-[0.3em] text-slate-500">Now playing</div>
        {active !== null && (
          <h2 className="mt-1 text-4xl font-black">
            <span style={{ color: activeTeam?.color }}>{activeTeam?.name}</span>
            <span className="text-slate-400"> · {active.placerName} is placing</span>
          </h2>
        )}
      </div>

      {/* The card being placed: a mystery disc while placing, the reveal when revealing. */}
      <div className="flex justify-center">
        {revealing ? (
          <div className="flex w-72 flex-col items-center gap-2 rounded-2xl border-2 bg-slate-900 p-5" style={{ borderColor: result.correct ? "#34d399" : "#fb7185" }}>
            <div className="text-5xl">{result.correct ? "✅" : "❌"}</div>
            {result.song.hasArt ? (
              <img src={artUrl(result.song.songId)} alt="" className="h-28 w-28 rounded-lg object-cover" />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-lg bg-slate-800 text-4xl text-slate-600">♪</div>
            )}
            <div className="text-6xl font-black tabular-nums">{result.song.year}</div>
            <div className="text-center text-lg font-semibold">{result.song.title ?? "Unknown"}</div>
            <div className="text-center text-slate-400">{result.song.artist ?? ""}</div>
          </div>
        ) : (
          <div className="flex h-44 w-44 animate-pulse items-center justify-center rounded-full border-4 border-slate-700 bg-slate-900 text-7xl">
            ❔
          </div>
        )}
      </div>

      {/* Active team's timeline */}
      {active !== null && (
        <div>
          <div className="mb-2 text-center text-sm text-slate-500" style={{ color: activeTeam?.color }}>
            {activeTeam?.name}'s timeline
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {activeCards.map((card) => (
              <div key={card.songId} className="flex w-24 flex-col items-center rounded-lg border border-slate-700 bg-slate-800 p-2 text-center" style={{ borderTopColor: activeTeam?.color, borderTopWidth: 3 }}>
                <div className="text-2xl font-black tabular-nums">{card.year}</div>
                <div className="line-clamp-2 text-[11px] leading-tight text-slate-400">{card.title ?? ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}

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
