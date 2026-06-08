import { useEffect, useState } from "react";

import type { LibraryFacets } from "@songster/shared/library";
import type { CreateAck, RoomConfig } from "@songster/shared/room";

import { fetchFacets, fetchPlexSettings, savePlexSettings, requestPlexPin, checkPlexAuth, testPlexSettings } from "../api";
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
  const [turnTimer, setTurnTimer] = useState(45);
  const [genres, setGenres] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [musicSource, setMusicSource] = useState<"local" | "plex" | "all">("all");

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
      turnTimerS: turnTimer,
      deck: { genres: genres.length > 0 ? genres : undefined, tags: tags.length > 0 ? tags : undefined },
      musicSource,
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

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <NumberField label="Teams" value={teamCount} min={2} max={4} onChange={setTeamCount} />
          <NumberField label="Win at" value={targetLength} min={3} max={20} onChange={setTargetLength} />
          <NumberField label="Tokens/player" value={tokens} min={0} max={5} onChange={setTokens} />
          <NumberField label="Snippet s" value={snippetLen} min={5} max={60} onChange={setSnippetLen} />
          <NumberField label="Turn timer s (0=off)" value={turnTimer} min={0} max={180} onChange={setTurnTimer} />
        </div>

        <div className="mt-6">
          <label className="text-xs uppercase tracking-wide text-slate-500 font-bold">Music Source</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ["all", "All Songs (Local + Plex)"],
              ["local", "Local Library Only"],
              ["plex", "Plex Server Only"],
            ].map(([value, label]) => {
              const active = musicSource === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMusicSource(value as any)}
                  className={`flex-1 min-w-[150px] rounded-xl py-3 px-4 text-sm font-bold border transition duration-200 active:scale-[0.98] cursor-pointer ${
                    active
                      ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-850 hover:text-slate-200"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
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

        <PlexSettingsForm />
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

function PlexSettingsForm() {
  const [url, setUrl] = useState("http://192.168.86.100:32400");
  const [libraryName, setLibraryName] = useState("Music");
  const [hasToken, setHasToken] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const [pinCode, setPinCode] = useState<string | null>(null);
  const [pinId, setPinId] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTest = async () => {
    setError(null);
    setSuccess(false);
    setTestResult(null);
    setTesting(true);
    try {
      const res = await testPlexSettings(url, libraryName);
      if (res.success) {
        setTestResult({ success: true, message: res.message || "Connected successfully!" });
      } else {
        setTestResult({ success: false, message: res.error || "Connection failed" });
      }
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : "Failed to run connection test" });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    fetchPlexSettings()
      .then((settings) => {
        setUrl(settings.url || "http://192.168.86.100:32400");
        setLibraryName(settings.libraryName);
        setHasToken(settings.hasToken);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    try {
      await savePlexSettings(url, libraryName);
      setSuccess(true);
    } catch (err) {
      setError("Failed to save settings");
    }
  };

  const handleConnect = async () => {
    setError(null);
    setPinCode(null);
    setPinId(null);
    try {
      await savePlexSettings(url, libraryName);
      const pin = await requestPlexPin();
      setPinCode(pin.code);
      setPinId(pin.pinId);
      setChecking(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request PIN from Plex.tv");
    }
  };

  useEffect(() => {
    if (!checking || pinId === null) return;
    let timer: number;
    
    const check = async () => {
      try {
        const res = await checkPlexAuth(pinId);
        if (res.connected) {
          setHasToken(true);
          setChecking(false);
          setPinCode(null);
          setPinId(null);
        } else {
          timer = window.setTimeout(check, 3000);
        }
      } catch {
        setChecking(false);
      }
    };
    
    timer = window.setTimeout(check, 3000);
    return () => clearTimeout(timer);
  }, [checking, pinId]);

  if (loading) return <div className="text-slate-500 text-sm mt-6">Loading settings…</div>;

  return (
    <section className="mt-8 border-t border-slate-900 pt-6">
      <h2 className="text-lg font-black font-heading text-slate-100">🔌 Plex Media Server (LAN)</h2>
      <p className="text-xs text-slate-550 mt-0.5">Link a local Plex Music Library to import tracks into your game library.</p>
      
      <form onSubmit={handleSave} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500 font-bold">
            Plex Server URL
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="e.g. http://192.168.1.100:32400"
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-slate-150 outline-none focus:border-indigo-500 transition shadow-inner"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500 font-bold">
            Plex Library Name
            <input
              type="text"
              value={libraryName}
              onChange={(e) => setLibraryName(e.target.value)}
              placeholder="e.g. Music"
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-slate-150 outline-none focus:border-indigo-500 transition shadow-inner"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            className="rounded-xl bg-slate-900 border border-slate-850 px-5 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-800 active:scale-[0.98] transition"
          >
            Save configurations
          </button>

          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="rounded-xl bg-slate-900 border border-slate-850 px-5 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-45 active:scale-[0.98] transition"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
          
          <button
            type="button"
            onClick={handleConnect}
            className={`rounded-xl px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-md active:scale-[0.98] transition ${
              hasToken ? "bg-emerald-600 hover:bg-emerald-500" : "bg-indigo-600 hover:bg-indigo-500"
            }`}
          >
            {hasToken ? "✓ Plex Connected" : "🔗 Connect Plex"}
          </button>
          
          {success && <span className="text-xs text-emerald-400 font-bold animate-pulse">✓ Saved!</span>}
          {error && <span className="text-xs text-rose-400 font-bold">{error}</span>}
        </div>
      </form>

      {testResult && (
        <div className={`mt-4 p-4 rounded-xl border text-sm ${
          testResult.success 
            ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-300" 
            : "border-rose-500/25 bg-rose-500/5 text-rose-300"
        }`}>
          <div className="font-bold flex items-center gap-1.5">
            {testResult.success ? "✓ Connection Successful" : "⚠ Connection Failed"}
          </div>
          <p className="mt-1 text-xs opacity-90 leading-relaxed whitespace-pre-line">{testResult.message}</p>
        </div>
      )}

      {pinCode && (
        <div className="mt-5 border border-indigo-500/25 bg-indigo-500/5 rounded-2xl p-5 text-center shadow-lg">
          <div className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Plex.tv Link Code</div>
          <div className="text-5xl font-black font-heading tracking-[0.25em] text-white my-3 animate-pulse">{pinCode}</div>
          <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
            Go to <a href="https://plex.tv/link" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline font-black">plex.tv/link</a> in your browser and enter the code to link your account.
          </p>
          <div className="mt-4 text-[10px] font-bold uppercase tracking-wider text-indigo-400/80">Checking link status…</div>
        </div>
      )}
    </section>
  );
}
