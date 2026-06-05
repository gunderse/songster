import type { RoomState } from "@songster/shared/room";

export function Roster({ room, size = "normal" }: { room: RoomState; size?: "normal" | "big" }) {
  const big = size === "big";
  const columns = room.teams.length > 2 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2";

  return (
    <div className={`grid grid-cols-1 gap-3 ${columns}`}>
      {room.teams.map((team) => {
        const members = room.players.filter((player) => player.teamId === team.id);
        return (
          <div key={team.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className={`flex items-center gap-2 font-bold ${big ? "text-2xl" : ""}`} style={{ color: team.color }}>
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: team.color }} />
              {team.name}
              <span className="font-normal text-slate-500">· {members.length}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {members.map((player) => (
                <li
                  key={player.id}
                  className={`${big ? "text-xl" : "text-sm"} ${
                    player.connected ? "text-slate-100" : "text-slate-500 line-through"
                  }`}
                >
                  {player.name}
                </li>
              ))}
              {members.length === 0 && <li className={`italic text-slate-600 ${big ? "text-lg" : "text-sm"}`}>empty</li>}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
