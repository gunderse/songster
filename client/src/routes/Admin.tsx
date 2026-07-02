import { useEffect, useRef, useState } from "react";

import type { LibraryFacets } from "@songster/shared/library";
import type { CreateAck, RoomConfig } from "@songster/shared/room";

import {
  fetchFacets, fetchPlexSettings, savePlexSettings, requestPlexPin, checkPlexAuth, testPlexSettings,
  fetchAdminHealth, runAdminBenchmark, runShowcaseSmoketest, fetchActiveRooms, destroyRoom, destroyAllRooms,
  audioStreamUrl, fetchSongs, fetchSongPlays, resetSongPlays, fetchShowcaseThemes,
  type AdminHealthResult, type BenchmarkResults, type BenchmarkPhase, type ActiveRoom, type SongPlayStat, type ShowcaseThemeInfo,
} from "../api";
import type { ShowcaseView } from "@songster/shared/game";
import { playCues, startBgMusic, stopBgMusic, stopCues, unlockAudio, playSnippet, stopSnippet } from "../audio";
import { socket } from "../socket";
import { Roster } from "../components/Roster";
import { ShowcaseOverlay } from "../components/ShowcaseOverlay";
import { hubUrl, joinUrl, useRoomState } from "../useRoom";

export function Admin() {
  const room = useRoomState();
  const [code, setCode] = useState<string | null>(null);
  const [facets, setFacets] = useState<LibraryFacets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);

  const [teamCount, setTeamCount] = useState(2);
  const [targetLength, setTargetLength] = useState(7);
  const [tokens, setTokens] = useState(2);
  const [snippetLen, setSnippetLen] = useState(30);
  const [turnTimer, setTurnTimer] = useState(60);
  const [genres, setGenres] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [musicSource, setMusicSource] = useState<"local" | "plex" | "all">("all");
  const [showcaseSteals, setShowcaseSteals] = useState(false);
  const [showcaseLeadChanges, setShowcaseLeadChanges] = useState(false);
  const [showcaseStreaks, setShowcaseStreaks] = useState(false);
  const [showcaseMilestones, setShowcaseMilestones] = useState(false);
  const [narratorVoice, setNarratorVoice] = useState("cycle");
  const [voices, setVoices] = useState<{ name: string; tags: string[] }[]>([]);
  const [songPlays, setSongPlays] = useState<SongPlayStat[]>([]);

  const loadPlays = () => {
    fetchSongPlays().then(setSongPlays).catch(() => undefined);
  };

  useEffect(() => {
    fetchFacets().then(setFacets).catch(() => undefined);
    fetch("/api/admin/voices")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.voices)) {
          setVoices(data.voices);
        }
      })
      .catch(() => undefined);
    loadPlays();
  }, []);

  useEffect(() => {
    if (code === null) {
      fetchActiveRooms().then((res) => setActiveRooms(res.rooms)).catch(() => undefined);
    }
  }, [code]);

  async function handleDestroyRoom(targetCode: string) {
    try {
      const res = await destroyRoom(targetCode);
      if (res.ok) {
        if (code === targetCode) {
          setCode(null);
        } else {
          fetchActiveRooms().then((res) => setActiveRooms(res.rooms)).catch(() => undefined);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to destroy room");
    }
  }

  async function handleDestroyAllRooms() {
    try {
      const res = await destroyAllRooms();
      if (res.ok) {
        setCode(null);
        setActiveRooms([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to destroy all rooms");
    }
  }

  async function handleResetPlays() {
    if (!window.confirm("Are you sure you want to reset all song play statistics?")) return;
    try {
      const res = await resetSongPlays();
      if (res.ok) {
        setSongPlays([]);
        loadPlays();
      }
    } catch (err) {
      console.error("failed to reset song play stats:", err);
    }
  }

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function createRoom() {
    setError(null);
    const config: RoomConfig = {
      teamCount,
      targetLength,
      specialsPerTeam: tokens,
      snippetLenS: snippetLen,
      turnTimerS: turnTimer,
      deck: { genres: genres.length > 0 ? genres : undefined, tags: tags.length > 0 ? tags : undefined },
      musicSource,
      showcaseSteals,
      showcaseLeadChanges,
      showcaseStreaks,
      showcaseMilestones,
      narratorVoice,
    };
    if (!socket.connected) socket.connect();
    socket.emit("room:create", { config }, (res: CreateAck) => {
      if (res.ok) setCode(res.code);
      else setError(res.error);
    });
  }

  if (code === null) {
    return (
      <main className="mx-auto max-w-2xl p-6 text-text-main font-sans">
        <h1 className="text-3xl font-display font-black uppercase tracking-wide">🎛️ Songster · Admin</h1>
        <p className="mt-1 text-text-dim">Create a game room.</p>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <NumberField label="Teams" value={teamCount} min={2} max={4} onChange={setTeamCount} />
          <NumberField label="Win at" value={targetLength} min={3} max={20} onChange={setTargetLength} />
          <NumberField label="Specials/team" value={tokens} min={0} max={10} onChange={setTokens} />
          <NumberField label="Snippet s" value={snippetLen} min={5} max={60} onChange={setSnippetLen} />
          <NumberField label="Turn timer s" value={turnTimer} min={0} max={180} onChange={setTurnTimer} />
        </div>

        <div className="mt-6">
          <label className="text-xs uppercase tracking-wide text-text-faint font-bold font-mono">Music Source</label>
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
                  className={`flex-1 min-w-[150px] rounded-xl py-3 px-4 text-sm font-bold border transition duration-200 active:scale-[0.98] cursor-pointer ${active
                      ? "bg-accent-magenta border-accent-magenta text-[#1a1110] shadow-lg shadow-accent-magenta/20"
                      : "bg-surface border-line text-text-dim hover:bg-surface-2 hover:text-text-main"
                    }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6">
          <label className="text-xs uppercase tracking-wide text-text-faint font-bold font-mono">Narrator Voice</label>
          <div className="mt-2">
            <select
              value={narratorVoice}
              onChange={(e) => setNarratorVoice(e.target.value)}
              className="w-full rounded-xl bg-surface border border-line text-text-main px-4 py-3 text-sm outline-none focus:border-accent-magenta transition font-semibold"
            >
              <option value="random">🎲 Random (Biased to Fraiser/Host voices)</option>
              <option value="cycle">🔄 Cycle (new voice each turn)</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  🎙️ {v.name} {v.tags.length > 0 ? `(${v.tags.slice(0, 2).join(", ")})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6">
          <label className="text-xs uppercase tracking-wide text-text-faint font-bold font-mono">Multi-Character Showcase Highlights (Finale only by default)</label>
          <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Steals", showcaseSteals, setShowcaseSteals],
              ["Lead Changes", showcaseLeadChanges, setShowcaseLeadChanges],
              ["Streaks (3+ in a row)", showcaseStreaks, setShowcaseStreaks],
              ["Milestones (Every 4th turn)", showcaseMilestones, setShowcaseMilestones],
            ].map(([label, value, onChange]) => {
              const active = !!value;
              return (
                <button
                  key={label as string}
                  type="button"
                  onClick={() => (onChange as any)(!value)}
                  className={`rounded-xl py-3 px-4 text-sm font-bold border transition duration-200 active:scale-[0.98] cursor-pointer ${active
                      ? "bg-accent-magenta border-accent-magenta text-[#1a1110] shadow-lg shadow-accent-magenta/20"
                      : "bg-surface border-line text-text-dim hover:bg-surface-2 hover:text-text-main"
                    }`}
                >
                  {active ? "✓ " : "+ "} {label as string}
                </button>
              );
            })}
          </div>
        </div>

        <Section title="Deck filter (optional)" hint="Restrict the song pool by genre / tag. Leave empty for all approved songs.">
          <ChipRow label="Genres" options={facets?.genres ?? []} selected={genres} onToggle={(v) => toggle(genres, setGenres, v)} />
          <ChipRow label="Tags" options={facets?.tags ?? []} selected={tags} onToggle={(v) => toggle(tags, setTags, v)} />
        </Section>

        {error !== null && <p className="mt-4 text-kick-red">{error}</p>}
        <button
          type="button"
          onClick={createRoom}
          className="mt-6 rounded-lg bg-accent-magenta hover:bg-magenta-soft text-[#1a1110] px-6 py-2.5 font-bold shadow-[0_4px_12px_rgba(255,45,120,0.2)] transition active:scale-95 cursor-pointer"
        >
          Create room
        </button>

        <PlexSettingsForm />
        <AiBenchmarkPanel />
        <HubAudioSmokeTestPanel />

        {/* Active Rooms Listing */}
        <section className="mt-8 border-t border-line pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-display font-black uppercase text-text-main">🎮 Active Game Rooms</h2>
              <p className="text-xs text-text-faint mt-0.5">Currently active and running rooms in memory.</p>
            </div>
            {activeRooms.length > 0 && (
              <button
                type="button"
                onClick={handleDestroyAllRooms}
                className="rounded-xl bg-kick-red/10 hover:bg-kick-red/20 border border-kick-red/20 text-kick-red px-4 py-2 text-xs font-bold transition active:scale-[0.98] cursor-pointer"
              >
                🔴 Destroy All Rooms
              </button>
            )}
          </div>

          <div className="mt-4 space-y-3">
            {activeRooms.length === 0 ? (
              <p className="text-sm text-text-faint italic py-2">No active rooms found.</p>
            ) : (
              activeRooms.map((r) => (
                <div key={r.code} className="flex items-center justify-between rounded-xl border border-line bg-surface/60 p-4 hover:border-text-faint transition">
                  <div>
                    <span className="text-lg font-display font-black tracking-wider text-accent-magenta mr-3">{r.code}</span>
                    <span className={`text-xs uppercase px-2 py-0.5 rounded-md font-mono font-bold ${r.status === "lobby" ? "bg-amber-950/40 text-gold-yellow border border-amber-800/30" :
                        r.status === "playing" ? "bg-emerald-950/40 text-emerald-300 border border-emerald-800/30" :
                        "bg-surface text-text-dim border border-line"
                      }`}>
                      {r.status}
                    </span>
                    <div className="text-xs text-text-faint mt-1">
                      {r.playerCount} player{r.playerCount !== 1 ? "s" : ""} · {r.teamCount} teams · Created {new Date(r.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCode(r.code)}
                      className="rounded-lg bg-surface hover:bg-surface-2 border border-line px-3 py-1.5 text-xs font-bold text-text-dim cursor-pointer"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDestroyRoom(r.code)}
                      className="rounded-lg bg-rose-955/30 hover:bg-rose-900/40 border border-rose-800/30 px-3 py-1.5 text-xs font-bold text-rose-350 cursor-pointer"
                    >
                      Destroy
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Played Songs Distribution Stats */}
        <section className="mt-8 border-t border-slate-900 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-100">📊 Played Songs Statistics</h2>
              <p className="text-xs text-slate-500 mt-0.5">Distribution of songs played during all games.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={loadPlays}
                className="rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-850 text-slate-300 px-4 py-2 text-xs font-bold transition active:scale-[0.98] cursor-pointer"
              >
                🔄 Refresh
              </button>
              {songPlays.length > 0 && (
                <button
                  type="button"
                  onClick={handleResetPlays}
                  className="rounded-xl bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/20 text-rose-450 px-4 py-2 text-xs font-bold transition active:scale-[0.98] cursor-pointer"
                >
                  🗑️ Reset Stats
                </button>
              )}
            </div>
          </div>

          <div className="mt-4">
            {songPlays.length === 0 ? (
              <div className="rounded-xl border border-slate-850 bg-slate-950/60 p-6 text-center">
                <p className="text-sm text-slate-600 italic">No songs have been played yet.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-850 bg-slate-900/40 text-slate-400 font-bold uppercase tracking-wider">
                        <th className="p-3">Song Details</th>
                        <th className="p-3 text-center w-24">Play Count</th>
                        <th className="p-3 text-right w-44">Last Played At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850 text-slate-350">
                      {songPlays.map((sp) => (
                        <tr key={sp.songId} className="hover:bg-slate-900/30 transition">
                          <td className="p-3 font-semibold">
                            <span className="text-slate-100">{sp.title}</span>
                            <span className="text-slate-500 ml-1.5 font-normal">by {sp.artist}</span>
                          </td>
                          <td className="p-3 text-center font-bold text-indigo-400 tabular-nums">
                            {sp.playCount}
                          </td>
                          <td className="p-3 text-right text-slate-500 tabular-nums">
                            {new Date(sp.lastPlayedAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6 text-text-main font-sans">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-text-faint font-mono">Room code</div>
          <div className="flex items-center gap-3">
            <div className="text-5xl font-display font-black tracking-[0.3em] text-accent-magenta">{code}</div>
            <button
              type="button"
              onClick={() => handleDestroyRoom(code)}
              className="rounded-xl bg-kick-red/10 hover:bg-kick-red/20 border border-kick-red/20 text-kick-red px-3.5 py-1.5 text-xs font-bold transition active:scale-[0.98] cursor-pointer"
            >
              🔴 Destroy Room
            </button>
            <button
              type="button"
              onClick={() => setCode(null)}
              className="rounded-xl bg-surface hover:bg-surface-2 border border-line text-text-dim px-3.5 py-1.5 text-xs font-bold transition active:scale-[0.98] cursor-pointer"
            >
              Back to List
            </button>
          </div>
        </div>
        <div className="ml-auto text-right text-sm text-text-dim">
          <div>
            Hub: <a className="text-accent-magenta hover:underline" href={hubUrl(code)} target="_blank" rel="noreferrer">{hubUrl(code)}</a>
          </div>
          <div>
            Join: <a className="text-accent-magenta hover:underline" href={joinUrl(code)} target="_blank" rel="noreferrer">{joinUrl(code)}</a>
          </div>
        </div>
      </div>

      {room !== null && (
        <>
          <div className="mt-4 flex items-center gap-3 text-sm text-text-dim">
            <span className="rounded bg-surface border border-line px-2 py-1">{room.players.length} players</span>
            <span className="rounded bg-surface border border-line px-2 py-1">pool: {room.poolSize} songs</span>
            <span className="rounded bg-surface border border-line px-2 py-1">status: {room.status}</span>
            {room.poolSize < room.config.targetLength && (
              <span className="text-gold-yellow">⚠ pool smaller than the win target — approve/curate more songs</span>
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
                className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-2 bg-surface text-text-main"
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
                    className="rounded-full bg-surface border border-line px-2.5 py-1 text-xs text-text-dim hover:bg-kick-red/20 hover:text-kick-red hover:border-kick-red/35"
                    title="Remove bot"
                  >
                    {bot.name} ✕
                  </button>
                ))}
            </div>
          )}

          {room.status === "playing" && (
            <div className="mt-6 rounded-lg border border-line bg-surface/40 p-4">
              <h3 className="text-sm font-bold text-text-dim">🎮 Game Controls</h3>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => socket.emit(room.game?.paused ? "room:resume" : "room:pause", { code })}
                  className="rounded-lg bg-surface hover:bg-surface-2 border border-line px-4 py-2 text-xs font-bold text-text-dim hover:text-text-main transition active:scale-[0.98] cursor-pointer"
                >
                  {room.game?.paused ? "▶ Resume Game" : "⏸ Pause Game"}
                </button>
                {room.game?.countdownEndsAt !== null && room.game?.countdownReady && (
                  <button
                    type="button"
                    onClick={() => socket.emit("room:skipIntro", { code })}
                    className="rounded-lg bg-accent-magenta hover:bg-magenta-soft border border-accent-magenta px-4 py-2 text-xs font-bold text-bg-deep transition active:scale-[0.98] cursor-pointer"
                  >
                    ⏩ Skip Intro
                  </button>
                )}
              </div>
            </div>
          )}

          <p className="mt-6 rounded-lg border border-line bg-surface/40 px-4 py-3 text-sm text-text-dim">
            🎬 Open the <a className="text-accent-magenta underline" href={hubUrl(code)} target="_blank" rel="noreferrer">Hub</a> on the big screen — start the game from there once players have joined.
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
            className={`rounded-full px-2.5 py-1 text-xs ${active ? "bg-indigo-500 text-white" : "border border-slate-700 text-slate-300 hover:bg-slate-800"
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
            className={`rounded-xl px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-md active:scale-[0.98] transition ${hasToken ? "bg-emerald-600 hover:bg-emerald-500" : "bg-indigo-600 hover:bg-indigo-500"
              }`}
          >
            {hasToken ? "✓ Plex Connected" : "🔗 Connect Plex"}
          </button>

          {success && <span className="text-xs text-emerald-400 font-bold animate-pulse">✓ Saved!</span>}
          {error && <span className="text-xs text-rose-400 font-bold">{error}</span>}
        </div>
      </form>

      {testResult && (
        <div className={`mt-4 p-4 rounded-xl border text-sm ${testResult.success
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

// ── AI Benchmark & Smoke Test ────────────────────────────────────────────────

const AVAILABLE_MODELS = ["gemma4:latest", "qwen3.5:4b"];

function PhaseRow({ label, phase }: { label: string; phase: BenchmarkPhase | undefined }) {
  if (!phase) return null;
  const ok = phase.ok;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-1">
      <div className="flex items-center gap-2">
        <span className={`text-lg ${ok ? "text-emerald-400" : "text-rose-400"}`}>{ok ? "✓" : "✗"}</span>
        <span className="text-xs font-bold uppercase tracking-wide text-slate-300">{label}</span>
        {phase.latencyMs !== undefined && (
          <span className="ml-auto text-xs tabular-nums text-slate-500">{phase.latencyMs.toLocaleString()} ms</span>
        )}
      </div>
      {phase.error && <p className="text-xs text-rose-400">{phase.error}</p>}
      {phase.warning && <p className="text-xs text-amber-400">{phase.warning}</p>}
      {phase.models && phase.models.length > 0 && (
        <p className="text-xs text-slate-500">Models: {phase.models.join(", ")}</p>
      )}
      {phase.characters !== undefined && (
        <p className="text-xs text-slate-500">{phase.characters} voice character{phase.characters !== 1 ? "s" : ""} available</p>
      )}
      {(phase.text ?? phase.fallbackText) && (
        <p className="text-xs text-slate-300 italic leading-relaxed">"{phase.text ?? phase.fallbackText}"</p>
      )}
    </div>
  );
}

function AudioPreview({ audioUrl, durationMs }: { audioUrl: string | undefined; durationMs: number | undefined }) {
  const ref = useRef<HTMLAudioElement>(null);
  if (!audioUrl) return null;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-emerald-400 text-lg">🔊</span>
        <span className="text-xs font-bold uppercase tracking-wide text-slate-300">Voice Preview</span>
        {durationMs !== undefined && (
          <span className="ml-auto text-xs tabular-nums text-slate-500">{(durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>
      <audio ref={ref} src={audioUrl} controls className="w-full h-8 accent-indigo-500" />
    </div>
  );
}

function AiBenchmarkPanel() {
  const [health, setHealth] = useState<AdminHealthResult | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const [model, setModel] = useState("gemma4:latest");
  const [think, setThink] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BenchmarkResults | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [smoketestLoading, setSmoketestLoading] = useState(false);
  const [showcase, setShowcase] = useState<ShowcaseView | null>(null);
  const [smoketestError, setSmoketestError] = useState<string | null>(null);
  const [smoketestLatency, setSmoketestLatency] = useState<number | null>(null);

  const [showcasePlaying, setShowcasePlaying] = useState(false);
  const [activeCueIndex, setActiveCueIndex] = useState<number>(-1);

  const [showcaseThemes, setShowcaseThemes] = useState<ShowcaseThemeInfo[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<string>("random");

  useEffect(() => {
    fetchShowcaseThemes().then(setShowcaseThemes).catch(() => undefined);
    return () => {
      stopCues();
      stopBgMusic();
    };
  }, []);

  const startShowcasePlay = () => {
    if (!showcase) return;
    unlockAudio();
    setShowcasePlaying(true);
    setActiveCueIndex(0);

    if (showcase.bgMusicUrl) {
      startBgMusic(showcase.bgMusicUrl, 0.18);
    }

    playCues(showcase.cues, (idx) => {
      if (idx === -1) {
        window.setTimeout(() => {
          stopBgMusic();
          setShowcasePlaying(false);
          setActiveCueIndex(-1);
        }, 1400);
      } else {
        setActiveCueIndex(idx);
      }
    }, showcase.reason === "finale");
  };

  const stopShowcasePlay = () => {
    stopCues();
    stopBgMusic();
    setShowcasePlaying(false);
    setActiveCueIndex(-1);
  };

  const runSmoketest = async () => {
    setSmoketestLoading(true);
    setSmoketestError(null);
    setShowcase(null);
    setSmoketestLatency(null);
    stopShowcasePlay();
    try {
      const res = await runShowcaseSmoketest({
        model,
        think,
        themeId: selectedThemeId !== "random" ? selectedThemeId : undefined,
      });
      if (res.ok && res.showcase) {
        setShowcase(res.showcase);
        setSmoketestLatency(res.latencyMs ?? null);
      } else {
        setSmoketestError(res.error ?? "Failed to generate showcase");
      }
    } catch (err) {
      setSmoketestError(err instanceof Error ? err.message : "Showcase smoke test failed");
    } finally {
      setSmoketestLoading(false);
    }
  };

  const checkHealth = async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const h = await fetchAdminHealth();
      setHealth(h);
      // Pre-fill model from default if available
      if (h.defaultModel && !model) setModel(h.defaultModel);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : "Failed to fetch health");
    } finally {
      setHealthLoading(false);
    }
  };

  const runBenchmark = async () => {
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      const res = await runAdminBenchmark({ model, think });
      setResult(res);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Benchmark failed");
    } finally {
      setRunning(false);
    }
  };

  const allModels = Array.from(new Set([
    ...AVAILABLE_MODELS,
    ...(health?.ollama?.models ?? []),
  ]));

  return (
    <section className="mt-8 border-t border-slate-900 pt-6">
      <h2 className="text-lg font-black text-slate-100">🧪 AI Smoke Test &amp; Benchmark</h2>
      <p className="text-xs text-slate-500 mt-0.5">
        Check Ollama and Voice API health, then run a full turn simulation to benchmark end-to-end latency.
      </p>

      {/* Service Health */}
      <div className="mt-4 flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={checkHealth}
          disabled={healthLoading}
          className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40 transition active:scale-[0.98]"
        >
          {healthLoading ? "Checking…" : "Check Service Health"}
        </button>
        {health && (
          <>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${health.ollama.ok ? "bg-emerald-900/40 text-emerald-300 border border-emerald-700/30" : "bg-rose-900/40 text-rose-300 border border-rose-700/30"}`}>
              {health.ollama.ok ? "✓" : "✗"} Ollama
            </span>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${health.voice.ok ? "bg-emerald-900/40 text-emerald-300 border border-emerald-700/30" : "bg-rose-900/40 text-rose-300 border border-rose-700/30"}`}>
              {health.voice.ok ? "✓" : "✗"} Voice API ({health.voice.characters} chars)
            </span>
            {health.ollama.models.length > 0 && (
              <span className="text-xs text-slate-500">{health.ollama.models.length} model{health.ollama.models.length !== 1 ? "s" : ""} available</span>
            )}
          </>
        )}
        {healthError && <span className="text-xs text-rose-400">{healthError}</span>}
      </div>

      {/* Benchmark Config */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500 font-bold">
          Ollama Model
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-indigo-500 transition"
          >
            {allModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-500 font-bold mt-5 cursor-pointer select-none">
          <div
            role="checkbox"
            aria-checked={think}
            onClick={() => setThink(!think)}
            className={`relative w-10 h-5 rounded-full transition cursor-pointer border ${think ? "bg-indigo-600 border-indigo-500" : "bg-slate-800 border-slate-700"}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${think ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span>
            Thinking {think ? <span className="text-indigo-400 normal-case">(on – slower but more creative)</span> : <span className="text-slate-600 normal-case">(off – faster)</span>}
          </span>
        </label>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={runBenchmark}
          disabled={running}
          className="rounded-xl bg-indigo-600 border border-indigo-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-40 transition active:scale-[0.98] shadow-lg shadow-indigo-600/20"
        >
          {running ? (
            <span className="flex items-center gap-2"><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Running benchmark…</span>
          ) : "▶ Run Benchmark"}
        </button>
      </div>

      {runError && <p className="mt-3 text-sm text-rose-400">{runError}</p>}

      {result && (
        <div className="mt-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className={`text-sm font-bold ${result.ok ? "text-emerald-400" : "text-rose-400"}`}>
              {result.ok ? "✓ Benchmark complete" : "✗ Benchmark failed"}
            </span>
            {result.results.totalE2eMs !== undefined && (
              <span className="text-xs text-slate-500 tabular-nums">
                total e2e: {(result.results.totalE2eMs / 1000).toFixed(1)}s
              </span>
            )}
            <span className="text-xs text-slate-600">model: {result.model} · think: {result.think ? "on" : "off"}</span>
          </div>
          <PhaseRow label="Ollama Health" phase={result.results.ollamaHealth} />
          <PhaseRow label="Voice API Health" phase={result.results.voiceHealth} />
          <PhaseRow label="Narration — Win Path" phase={result.results.ollamaWinNarration} />
          <PhaseRow label="Narration — Lose Path" phase={result.results.ollamaLoseNarration} />
          <PhaseRow label="Voice Generation" phase={result.results.voiceGeneration} />
          {result.results.voiceGeneration?.audioUrl && (
            <AudioPreview
              audioUrl={result.results.voiceGeneration.audioUrl}
              durationMs={result.results.voiceGeneration.durationMs}
            />
          )}
          {result.error && <p className="text-xs text-rose-400">{result.error}</p>}
        </div>
      )}

      {/* Showcase Smoke Test controls */}
      <div className="mt-8 border-t border-slate-900 pt-6">
        <h3 className="text-md font-bold text-slate-200">🎬 Final Showcase Smoke Test</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Generate an expanded winning finale showcase for a fictional 5-turn game to test recap prompts, layout segments, and TTS voice generation.
        </p>

        <div className="mt-4 max-w-xs">
          <label className="text-xs uppercase tracking-wide text-slate-500 font-bold">Showcase Theme (Smoke Test)</label>
          <div className="mt-1">
            <select
              value={selectedThemeId}
              onChange={(e) => setSelectedThemeId(e.target.value)}
              className="w-full rounded-xl bg-slate-900 border border-slate-800 text-slate-350 px-3 py-2 text-xs outline-none focus:border-indigo-500 transition font-semibold"
            >
              <option value="random">🎲 Random (Shuffle themes)</option>
              {showcaseThemes.map((t) => (
                <option key={t.id} value={t.id}>
                  🎬 {t.label} ({t.tagline})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={runSmoketest}
            disabled={smoketestLoading}
            className="rounded-xl bg-violet-600 border border-violet-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-40 transition active:scale-[0.98] shadow-lg shadow-violet-600/20"
          >
            {smoketestLoading ? (
              <span className="flex items-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating Showcase…
              </span>
            ) : "▶ Run Showcase Smoke Test"}
          </button>

          {showcase && (
            <button
              type="button"
              onClick={showcasePlaying ? stopShowcasePlay : startShowcasePlay}
              className={`rounded-xl border px-6 py-2.5 text-sm font-bold transition active:scale-[0.98] ${showcasePlaying
                  ? "bg-rose-900/40 text-rose-300 border-rose-700/50 hover:bg-rose-900/60"
                  : "bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-800"
                }`}
            >
              {showcasePlaying ? "■ Stop Preview" : "🔊 Play Showcase Preview"}
            </button>
          )}
        </div>

        {smoketestError && <p className="mt-3 text-sm text-rose-400">{smoketestError}</p>}

        {showcase && (
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-emerald-400">✓ Showcase generated successfully</span>
              {smoketestLatency !== null && (
                <span className="text-xs text-slate-500 tabular-nums">
                  latency: {(smoketestLatency / 1000).toFixed(1)}s
                </span>
              )}
            </div>

            {/* Showcase Visual Live Player Representation */}
            <div className="relative overflow-hidden rounded-2xl bg-slate-950 border border-slate-900 p-6 flex flex-col justify-between min-h-[300px]">
              {showcasePlaying && activeCueIndex >= 0 ? (
                <ShowcaseOverlay view={showcase} cueIndex={activeCueIndex} />
              ) : (
                <>
                  {/* background preview mockup */}
                  <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/20 via-slate-950/40 to-slate-950 pointer-events-none" />

                  <div className="relative z-10 flex justify-between items-start">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-[0.25em] text-amber-400">🎬 {showcase.themeLabel}</span>
                      <div className="text-xs text-slate-400 mt-0.5">{showcase.tagline}</div>
                    </div>
                  </div>

                  {/* Showcase active cue rendering */}
                  <div className="relative z-10 my-8 max-w-2xl mx-auto text-center">
                    <div className="text-slate-500 text-sm italic">
                      Click "Play Showcase Preview" to start narration and playback.
                    </div>
                  </div>
                </>
              )}

              {/* Progress bar dot counts */}
              <div className="relative z-35 flex justify-center gap-2 mt-4">
                {showcase.cues.map((_, i) => (
                  <span
                    key={i}
                    className={`h-2 w-2 rounded-full transition ${showcasePlaying && i <= activeCueIndex
                        ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                        : "bg-slate-800"
                      }`}
                  />
                ))}
              </div>
            </div>

            {/* Script list details */}
            <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 p-4">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Generated Showcase Script</div>
              <div className="space-y-3">
                {showcase.cues.map((cue, idx) => (
                  <div key={idx} className="flex flex-col gap-0.5 border-l-2 border-indigo-500/20 pl-3">
                    <div className="text-xs font-bold text-indigo-400">
                      Cue {idx + 1}: {cue.speakerLabel} ({cue.characterName ?? "fallback"}) — <span className="text-slate-500 font-normal">{(cue.durationMs / 1000).toFixed(1)}s</span>
                    </div>
                    <div className="text-sm text-slate-300">“{cue.text}”</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function HubAudioSmokeTestPanel() {
  const [songs, setSongs] = useState<any[]>([]);
  const [playingSong, setPlayingSong] = useState<any | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadSongs() {
    setLoading(true);
    try {
      const list = await fetchSongs({});
      setSongs(list);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  function handleUnlock() {
    unlockAudio();
    setUnlocked(true);
  }

  function playRandom() {
    if (songs.length === 0) return;
    const rand = songs[Math.floor(Math.random() * songs.length)]!;
    setPlayingSong(rand);
    const url = audioStreamUrl(rand.id);
    playSnippet(url, rand.snippetStartS ?? 10, rand.snippetLenS ?? 30);
  }

  function handleSkip() {
    stopSnippet(true);
    if (songs.length > 0) {
      playRandom();
    } else {
      setPlayingSong(null);
    }
  }

  function handleStop() {
    stopSnippet(true);
    setPlayingSong(null);
  }

  return (
    <section className="mt-8 border-t border-slate-900 pt-6">
      <h2 className="text-lg font-black text-slate-100">Hub Audio &amp; Skip Smoke Test</h2>
      <p className="text-xs text-slate-500 mt-0.5">
        Simulate hub audio unlocking, loading a random song, starting snippet playback, and skipping/stopping.
      </p>

      <div className="mt-4 flex flex-wrap gap-3 items-center">
        <button
          type="button"
          onClick={handleUnlock}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition active:scale-[0.98] cursor-pointer ${
            unlocked
              ? "bg-emerald-950 border border-emerald-900/50 text-emerald-400"
              : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/10"
          }`}
        >
          {unlocked ? "✓ Audio Unlocked" : "🔊 Tap to Enable/Unlock Audio"}
        </button>

        <button
          type="button"
          onClick={loadSongs}
          disabled={loading}
          className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 transition active:scale-[0.98] cursor-pointer"
        >
          {loading ? "Loading track pool…" : songs.length > 0 ? `Refresh Pool (${songs.length})` : "📥 Load Track Pool"}
        </button>

        {songs.length > 0 && (
          <button
            type="button"
            onClick={playRandom}
            className="rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold px-4 py-2 text-xs transition active:scale-[0.98] cursor-pointer"
          >
            🎵 Play Random Snippet
          </button>
        )}

        {playingSong && (
          <>
            <button
              type="button"
              onClick={handleSkip}
              className="rounded-xl border border-rose-900/40 bg-rose-950/20 text-rose-400 hover:bg-rose-900/30 hover:text-rose-200 px-4 py-2 text-xs font-bold uppercase tracking-wider transition duration-200 active:scale-[0.98] cursor-pointer shadow-md"
            >
              ⏭ Skip Song
            </button>
            <button
              type="button"
              onClick={handleStop}
              className="rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-400 px-4 py-2 text-xs font-bold uppercase transition active:scale-[0.98] cursor-pointer"
            >
              ⏹ Stop
            </button>
          </>
        )}
      </div>

      {playingSong && (
        <div className="mt-4 p-4 rounded-2xl bg-slate-900/40 border border-white/5 max-w-md animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Now Streaming Snippet</div>
          <div className="mt-1 font-bold text-sm text-slate-100 truncate">{playingSong.title}</div>
          <div className="text-xs text-slate-400 truncate">
            {playingSong.artist} ({playingSong.year})
          </div>
        </div>
      )}
    </section>
  );
}
