import { useEffect, useState } from "react";

import type { LibraryFacets } from "@songster/shared/library";
import type { CreateAck, RoomConfig } from "@songster/shared/room";

import { fetchFacets } from "../api";
import { socket } from "../socket";
import { Roster } from "../components/Roster";
import { hubUrl, joinUrl, useRoomState } from "../useRoom";

export function Admin() {
  const room = useRoomState();
  const [code, setCode] = useState<string | null>(null);
  const [facets, setFacets] = useState<LibraryFacets | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [teamCount, setTeamCount] = useState(2);
  const [targetLength, setTargetLength] = useState(7);
  const [tokens, setTokens] = useState(2);
  const [snippetLen, setSnippetLen] = useState(30);
  const [genres, setGenres] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    fetchFacets().then(setFacets).catch(() => undefined);
  }, []);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function createRoom() {
    setError(null);
    const config: RoomConfig = {
      teamCount,
      targetLength,
      tokensPerPlayer: tokens,
      snippetLenS: snippetLen,
      deck: { genres: genres.length > 0 ? genres : undefined, tags: tags.length > 0 ? tags : undefined },
    };
    if (!socket.connected) socket.connect();
    socket.emit("room:create", { config }, (res: CreateAck) => {
      if (res.ok) setCode(res.code);
      else setError(res.error);
    });
  }

  if (code === null) {
    return (
      <main className="mx-auto max-w-2xl p-6 text-slate-100">
        <h1 className="text-2xl font-black">🎛️ Songster · Admin</h1>
        <p className="mt-1 text-slate-400">Create a game room.</p>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumberField label="Teams" value={teamCount} min={2} max={4} onChange={setTeamCount} />
          <NumberField label="Win at" value={targetLength} min={3} max={20} onChange={setTargetLength} />
          <NumberField label="Tokens/player" value={tokens} min={0} max={5} onChange={setTokens} />
          <NumberField label="Snippet s" value={snippetLen} min={5} max={60} onChange={setSnippetLen} />
        </div>

        <Section title="Deck filter (optional)" hint="Restrict the song pool by genre / tag. Leave empty for all approved songs.">
          <ChipRow label="Genres" options={facets?.genres ?? []} selected={genres} onToggle={(v) => toggle(genres, setGenres, v)} />
          <ChipRow label="Tags" options={facets?.tags ?? []} selected={tags} onToggle={(v) => toggle(tags, setTags, v)} />
        </Section>

        {error !== null && <p className="mt-4 text-rose-400">{error}</p>}
        <button
          type="button"
          onClick={createRoom}
          className="mt-6 rounded-lg bg-indigo-500 px-6 py-2.5 font-semibold text-white hover:bg-indigo-400"
        >
          Create room
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6 text-slate-100">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500">Room code</div>
          <div className="text-5xl font-black tracking-[0.3em] text-indigo-300">{code}</div>
        </div>
        <div className="ml-auto text-right text-sm text-slate-400">
          <div>
            Hub: <a className="text-indigo-300 hover:underline" href={hubUrl(code)} target="_blank" rel="noreferrer">{hubUrl(code)}</a>
          </div>
          <div>
            Join: <a className="text-indigo-300 hover:underline" href={joinUrl(code)} target="_blank" rel="noreferrer">{joinUrl(code)}</a>
          </div>
        </div>
      </div>

      {room !== null && (
        <>
          <div className="mt-4 flex items-center gap-3 text-sm text-slate-400">
            <span className="rounded bg-slate-800 px-2 py-1">{room.players.length} players</span>
            <span className="rounded bg-slate-800 px-2 py-1">pool: {room.poolSize} songs</span>
            <span className="rounded bg-slate-800 px-2 py-1">status: {room.status}</span>
            {room.poolSize < room.config.targetLength && (
              <span className="text-amber-400">⚠ pool smaller than the win target — approve/curate more songs</span>
            )}
          </div>

          <div className="mt-5">
            <Roster room={room} />
          </div>

          {room.status === "lobby" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => socket.emit("admin:addBot", { code })}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
              >
                + Add bot 🤖
              </button>
              {room.players
                .filter((p) => p.isBot)
                .map((bot) => (
                  <button
                    key={bot.id}
                    type="button"
                    onClick={() => socket.emit("admin:removeBot", { code, playerId: bot.id })}
                    className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-rose-900/40"
                    title="Remove bot"
                  >
                    {bot.name} ✕
                  </button>
                ))}
            </div>
          )}

          <p className="mt-6 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
            🎬 Open the <a className="text-indigo-300 underline" href={hubUrl(code)} target="_blank" rel="noreferrer">Hub</a> on the big screen — start the game from there once players have joined.
          </p>
        </>
      )}
    </main>
  );
}

function NumberField(props: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500">
      {props.label}
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        onChange={(e) => props.onChange(Math.max(props.min, Math.min(props.max, Number(e.target.value) || props.min)))}
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-lg text-slate-100 outline-none focus:border-indigo-500"
      />
    </label>
  );
}

function Section(props: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-slate-300">{props.title}</h2>
      {props.hint !== undefined && <p className="text-xs text-slate-500">{props.hint}</p>}
      <div className="mt-2 space-y-2">{props.children}</div>
    </section>
  );
}

function ChipRow(props: {
  label: string;
  options: Array<{ value: string; count: number }>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (props.options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-14 text-xs text-slate-500">{props.label}</span>
      {props.options.slice(0, 12).map((option) => {
        const active = props.selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => props.onToggle(option.value)}
            className={`rounded-full px-2.5 py-1 text-xs ${
              active ? "bg-indigo-500 text-white" : "border border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {option.value} <span className="opacity-60">{option.count}</span>
          </button>
        );
      })}
    </div>
  );
}
