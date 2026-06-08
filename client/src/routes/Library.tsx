import { useCallback, useEffect, useRef, useState } from "react";

import type {
  LibraryFacets,
  LibrarySong,
  LibraryStats,
  SongStatus,
  SongUpdate,
  YearSuggestion,
} from "@songster/shared/library";

import {
  artUrl,
  audioStreamUrl,
  fetchAiStatus,
  fetchFacets,
  fetchSongs,
  fetchStats,
  patchSong,
  rescanLibrary,
  suggestYear,
  uploadArt,
  type AiStatus,
} from "../api";

type StatusFilter = SongStatus | "all";
type SortKey = "flagged" | "title" | "artist" | "year";

export function Library() {
  const [songs, setSongs] = useState<LibrarySong[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("flagged");
  const [search, setSearch] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [facets, setFacets] = useState<LibraryFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimer = useRef<number | undefined>(undefined);
  const pendingStart = useRef(0);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const loadSongs = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchSongs({
        status,
        flaggedOnly,
        sort,
        search: search.trim() || undefined,
        genre: genreFilter || undefined,
        tag: tagFilter || undefined,
      });
      setSongs(list);
    } finally {
      setLoading(false);
    }
  }, [status, flaggedOnly, sort, search, genreFilter, tagFilter]);

  const refreshStats = useCallback(async () => {
    setStats(await fetchStats());
  }, []);

  const refreshFacets = useCallback(async () => {
    setFacets(await fetchFacets());
  }, []);

  useEffect(() => {
    void loadSongs();
  }, [loadSongs]);

  useEffect(() => {
    void refreshStats();
    void refreshFacets();
    fetchAiStatus().then(setAi).catch(() => setAi({ ok: false, model: "?", error: "unreachable" }));
  }, [refreshStats, refreshFacets]);

  const stopPreview = useCallback(() => {
    if (stopTimer.current !== undefined) window.clearTimeout(stopTimer.current);
    audioRef.current?.pause();
    setPreviewingId(null);
  }, []);

  const previewSong = useCallback(
    (song: LibrarySong) => {
      const audio = audioRef.current;
      if (audio === null) return;
      if (previewingId === song.id) {
        stopPreview();
        return;
      }
      if (stopTimer.current !== undefined) window.clearTimeout(stopTimer.current);
      pendingStart.current = song.snippetStartS ?? 0;
      audio.src = audioStreamUrl(song.id);
      audio.load();
      setPreviewingId(song.id);
      const lengthMs = (song.snippetLenS ?? 15) * 1000;
      audio.onloadedmetadata = () => {
        try {
          audio.currentTime = pendingStart.current;
        } catch {
          // seeking unsupported; play from start
        }
        void audio.play();
      };
      stopTimer.current = window.setTimeout(stopPreview, lengthMs + 800);
    },
    [previewingId, stopPreview],
  );

  const uploadArtFor = useCallback(async (id: string, file: File) => {
    const updated = await uploadArt(id, file);
    setSongs((prev) => prev.map((s) => (s.id === id ? updated : s)));
  }, []);

  const applyPatch = useCallback(
    async (id: string, update: SongUpdate) => {
      setBusy(id);
      try {
        const updated = await patchSong(id, update);
        setSongs((prev) => prev.map((s) => (s.id === id ? updated : s)));
        void refreshStats();
        void refreshFacets();
        return updated;
      } finally {
        setBusy(null);
      }
    },
    [refreshStats, refreshFacets],
  );

  return (
    <div className="relative min-h-dvh bg-slate-950 text-slate-100 overflow-x-hidden">
      {/* Ambient glassmorphic glowing backdrops */}
      <div className="absolute top-[-10%] left-[-10%] h-[50%] w-[50%] rounded-full bg-indigo-500/5 blur-[100px] pointer-events-none" />
      <div className="absolute top-[30%] right-[-10%] h-[50%] w-[50%] rounded-full bg-purple-600/5 blur-[100px] pointer-events-none" />

      <audio ref={audioRef} onEnded={stopPreview} className="hidden" />

      <header className="sticky top-0 z-10 border-b border-slate-900 bg-slate-950/80 backdrop-blur-md px-6 py-4 shadow-md">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <h1 className="text-2xl font-black tracking-tight font-heading text-transparent bg-clip-text bg-gradient-to-r from-indigo-200 to-indigo-400">🎵 Songster · Library</h1>
          {stats !== null && <StatBar stats={stats} />}
          <div className="ml-auto flex items-center gap-3">
            <AiPill ai={ai} />
            <button
              type="button"
              onClick={async () => {
                setBusy("scan");
                try {
                  await rescanLibrary();
                  await Promise.all([loadSongs(), refreshStats()]);
                } finally {
                  setBusy(null);
                }
              }}
              disabled={busy === "scan"}
              className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40 transition"
            >
              {busy === "scan" ? "Rescanning…" : "Rescan library"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <Segmented<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              ["all", "All"],
              ["unreviewed", "Unreviewed"],
              ["approved", "Approved"],
              ["excluded", "Excluded"],
            ]}
          />
          <label className="flex items-center gap-2 rounded-xl border border-white/5 bg-slate-900/60 px-3 py-2 cursor-pointer hover:border-slate-850 hover:bg-slate-900 transition">
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} className="rounded text-indigo-600 focus:ring-0" />
            <span className="font-semibold text-slate-350">Flagged only</span>
          </label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title / artist / album…"
            className="min-w-64 flex-1 rounded-xl border border-white/5 bg-slate-900/60 px-4 py-2 outline-none focus:border-indigo-500 focus:bg-slate-900 transition text-slate-100 shadow-inner"
          />
          <FacetSelect label="Genre" value={genreFilter} onChange={setGenreFilter} options={facets?.genres ?? []} />
          <FacetSelect label="Tag" value={tagFilter} onChange={setTagFilter} options={facets?.tags ?? []} />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-xl border border-white/5 bg-slate-900/60 px-3 py-2 font-semibold text-slate-300 outline-none focus:border-indigo-500 transition cursor-pointer"
          >
            <option value="flagged">Sort: needs review</option>
            <option value="title">Sort: title</option>
            <option value="artist">Sort: artist</option>
            <option value="year">Sort: year</option>
          </select>
          <span className="text-xs uppercase font-bold tracking-wider text-slate-500 pl-1">{loading ? "loading…" : `${songs.length} shown`}</span>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl divide-y divide-slate-900/50 px-4 pb-24">
        {songs.map((song) => (
          <SongRow
            key={song.id}
            song={song}
            busy={busy === song.id}
            previewing={previewingId === song.id}
            aiAvailable={ai?.ok === true && ai.modelAvailable === true}
            onPreview={() => previewSong(song)}
            onPatch={(update) => applyPatch(song.id, update)}
            onUploadArt={(file) => uploadArtFor(song.id, file)}
          />
        ))}
        {!loading && songs.length === 0 && (
          <p className="py-16 text-center text-slate-500">No songs match these filters.</p>
        )}
      </main>
    </div>
  );
}

function SongRow(props: {
  song: LibrarySong;
  busy: boolean;
  previewing: boolean;
  aiAvailable: boolean;
  onPreview: () => void;
  onPatch: (update: SongUpdate) => Promise<LibrarySong>;
  onUploadArt: (file: File) => Promise<void>;
}) {
  const { song, busy, previewing, aiAvailable, onPreview, onPatch, onUploadArt } = props;
  const [year, setYear] = useState<string>(song.year?.toString() ?? "");
  const [start, setStart] = useState<string>(song.snippetStartS?.toString() ?? "");
  const [title, setTitle] = useState(song.title ?? "");
  const [artist, setArtist] = useState(song.artist ?? "");
  const [album, setAlbum] = useState(song.album ?? "");
  const [suggestion, setSuggestion] = useState<YearSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artBust, setArtBust] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setYear(song.year?.toString() ?? "");
    setStart(song.snippetStartS?.toString() ?? "");
    setTitle(song.title ?? "");
    setArtist(song.artist ?? "");
    setAlbum(song.album ?? "");
  }, [song.year, song.snippetStartS, song.title, song.artist, song.album]);

  const commitText = (key: "title" | "artist" | "album", value: string, current: string | null) => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === (current ?? "")) return;
    const update: SongUpdate = {};
    update[key] = trimmed;
    void onPatch(update);
  };

  const commitYear = () => {
    const trimmed = year.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && !Number.isInteger(next)) return;
    if (next === song.year) return;
    void onPatch({ year: next });
  };
  const commitStart = () => {
    const trimmed = start.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next === song.snippetStartS) return;
    void onPatch({ snippetStartS: next });
  };

  const requestSuggestion = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const result = await suggestYear(song.id);
      setSuggestion(result);
      setYear(result.year.toString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "suggestion failed");
    } finally {
      setSuggesting(false);
    }
  };

  const statusTint =
    song.status === "approved"
      ? "border-l-emerald-500"
      : song.status === "excluded"
        ? "border-l-rose-600"
        : "border-l-slate-700";

  return (
    <div className={`grid grid-cols-[3rem_1fr_auto] gap-3 border-l-4 ${statusTint} py-3 pl-3 pr-1`}>
      <div className="relative h-12 w-12">
        <button
          type="button"
          onClick={onPreview}
          title="Preview snippet"
          className="relative h-full w-full overflow-hidden rounded bg-slate-800 text-lg"
        >
          {song.hasArt ? (
            <img src={`${artUrl(song.id)}?v=${artBust}`} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-slate-500">♪</span>
          )}
          <span className="absolute inset-0 flex items-center justify-center rounded bg-black/40 opacity-0 hover:opacity-100">
            {previewing ? "⏸" : "▶"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="Set cover image"
          className="absolute -bottom-1.5 -right-1.5 rounded-full border border-slate-600 bg-slate-900 px-1 text-[10px] leading-none hover:bg-indigo-600"
        >
          🖼
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void onUploadArt(file).then(() => setArtBust(Date.now()));
            e.target.value = "";
          }}
        />
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => commitText("title", title, song.title)}
            placeholder="title"
            className="min-w-0 flex-1 truncate rounded bg-transparent font-semibold text-slate-100 outline-none hover:bg-slate-800/50 focus:bg-slate-800 focus:px-1"
          />
          {song.status === "approved" && <span className="shrink-0 text-emerald-400">✓</span>}
        </div>
        <div className="flex items-center gap-1 text-sm text-slate-400">
          <input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            onBlur={() => commitText("artist", artist, song.artist)}
            placeholder="artist"
            className="w-32 min-w-24 flex-1 rounded bg-transparent outline-none hover:bg-slate-800/50 focus:bg-slate-800 focus:px-1"
          />
          <span className="shrink-0 text-slate-600">·</span>
          <input
            value={album}
            onChange={(e) => setAlbum(e.target.value)}
            onBlur={() => commitText("album", album, song.album)}
            placeholder="album"
            className="w-32 min-w-24 flex-1 rounded bg-transparent text-slate-500 outline-none hover:bg-slate-800/50 focus:bg-slate-800 focus:px-1"
          />
          {song.genre !== null && <span className="shrink-0 text-slate-600">· {song.genre}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {song.rawYear !== null && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">tag: {song.rawYear}</span>
          )}
          {song.suspiciousFlags.map((flag) => (
            <span key={flag} className="rounded bg-amber-900/40 px-1.5 py-0.5 text-xs text-amber-300">
              {flag}
            </span>
          ))}
          {suggestion !== null && (
            <span className="rounded bg-indigo-900/50 px-1.5 py-0.5 text-xs text-indigo-200">
              AI: {suggestion.year} ({suggestion.confidence}){suggestion.note ? ` — ${suggestion.note}` : ""}
            </span>
          )}
          {error !== null && <span className="text-xs text-rose-400">{error}</span>}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {song.genres.map((genre) => (
            <RemovableChip
              key={`g-${genre}`}
              label={genre}
              tone="genre"
              onRemove={() => onPatch({ genres: song.genres.filter((value) => value !== genre) })}
            />
          ))}
          {song.tags.map((tag) => (
            <RemovableChip
              key={`t-${tag}`}
              label={tag}
              tone="tag"
              onRemove={() => onPatch({ tags: song.tags.filter((value) => value !== tag) })}
            />
          ))}
          <TagAdder
            onAdd={(value) => {
              if (!song.tags.includes(value)) void onPatch({ tags: [...song.tags, value] });
            }}
          />
        </div>
      </div>

      <div className="flex items-start gap-2">
        <label className="flex flex-col items-center text-[10px] uppercase text-slate-500">
          Year
          <input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            onBlur={commitYear}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            inputMode="numeric"
            placeholder="—"
            className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-center text-sm text-slate-100 outline-none focus:border-indigo-500"
          />
        </label>
        <label className="flex flex-col items-center text-[10px] uppercase text-slate-500">
          Start s
          <input
            value={start}
            onChange={(e) => setStart(e.target.value)}
            onBlur={commitStart}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            inputMode="numeric"
            placeholder="—"
            className="w-14 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-center text-sm outline-none focus:border-indigo-500"
          />
        </label>
        <div className="flex flex-col gap-1 self-stretch">
          <button
            type="button"
            onClick={requestSuggestion}
            disabled={!aiAvailable || suggesting}
            title={aiAvailable ? "Ask the local LLM for the original year" : "Ollama unavailable"}
            className="rounded border border-indigo-700 px-2 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-900/40 disabled:opacity-40"
          >
            {suggesting ? "…" : "Suggest"}
          </button>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                const update: SongUpdate = { status: "approved" };
                const trimmedYear = year.trim();
                const nextYear = trimmedYear === "" ? null : Number(trimmedYear);
                if (nextYear !== song.year) {
                  update.year = nextYear;
                }
                const trimmedStart = start.trim();
                const nextStart = trimmedStart === "" ? null : Number(trimmedStart);
                if (nextStart !== song.snippetStartS) {
                  update.snippetStartS = nextStart;
                }
                void onPatch(update);
              }}
              disabled={busy}
              className="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold hover:bg-emerald-500 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => {
                const update: SongUpdate = { status: "excluded" };
                const trimmedYear = year.trim();
                const nextYear = trimmedYear === "" ? null : Number(trimmedYear);
                if (nextYear !== song.year) {
                  update.year = nextYear;
                }
                const trimmedStart = start.trim();
                const nextStart = trimmedStart === "" ? null : Number(trimmedStart);
                if (nextStart !== song.snippetStartS) {
                  update.snippetStartS = nextStart;
                }
                void onPatch(update);
              }}
              disabled={busy}
              className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-50"
            >
              Exclude
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBar({ stats }: { stats: LibraryStats }) {
  const decades = Object.entries(stats.decades).sort(([a], [b]) => Number(a) - Number(b));
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <Chip label="total" value={stats.total} />
      <Chip label="unreviewed" value={stats.unreviewed} tint="text-slate-300" />
      <Chip label="approved" value={stats.approved} tint="text-emerald-400" />
      <Chip label="excluded" value={stats.excluded} tint="text-rose-400" />
      <Chip label="flagged" value={stats.flagged} tint="text-amber-300" />
      <span className="ml-1 text-slate-500">
        decades: {decades.length === 0 ? "—" : decades.map(([d, c]) => `${d}s·${c}`).join("  ")}
      </span>
    </div>
  );
}

function Chip({ label, value, tint = "text-slate-200" }: { label: string; value: number; tint?: string }) {
  return (
    <span className="rounded bg-slate-800 px-2 py-0.5">
      <span className={`font-bold ${tint}`}>{value}</span> <span className="text-slate-500">{label}</span>
    </span>
  );
}

function AiPill({ ai }: { ai: AiStatus | null }) {
  if (ai === null) return <span className="text-xs text-slate-500">AI: …</span>;
  const ok = ai.ok && ai.modelAvailable !== false;
  return (
    <span
      title={ai.error ?? ai.models?.join(", ") ?? ""}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
        ok ? "border-emerald-800 text-emerald-300" : "border-slate-700 text-slate-400"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-slate-500"}`} />
      Ollama · {ai.model}
    </span>
  );
}

function Segmented<T extends string>(props: {
  value: T;
  onChange: (value: T) => void;
  options: Array<[T, string]>;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-slate-700">
      {props.options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => props.onChange(value)}
          className={`px-2.5 py-1.5 ${props.value === value ? "bg-indigo-600 text-white" : "hover:bg-slate-800"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function FacetSelect(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; count: number }>;
}) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className={`rounded-md border bg-slate-900 px-2 py-1.5 ${
        props.value ? "border-indigo-600 text-indigo-200" : "border-slate-700"
      }`}
    >
      <option value="">All {props.label.toLowerCase()}s</option>
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {props.label}: {option.value} ({option.count})
        </option>
      ))}
    </select>
  );
}

function RemovableChip(props: { label: string; tone: "genre" | "tag"; onRemove: () => void }) {
  const tone = props.tone === "genre" ? "bg-indigo-900/40 text-indigo-200" : "bg-teal-900/40 text-teal-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${tone}`}>
      {props.label}
      <button type="button" onClick={props.onRemove} title="remove" className="text-slate-400 hover:text-rose-300">
        ×
      </button>
    </span>
  );
}

function TagAdder(props: { onAdd: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const trimmed = value.trim();
          if (trimmed.length > 0) props.onAdd(trimmed);
          setValue("");
        }
      }}
      placeholder="+ tag"
      className="w-20 rounded border border-dashed border-slate-700 bg-transparent px-1.5 py-0.5 text-xs text-slate-300 outline-none focus:border-teal-500"
    />
  );
}
