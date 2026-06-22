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
  searchPlex,
  importPlex,
  deleteSong,
  plexArtUrl,
  type AiStatus,
  type ScanSummary,
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
  const [scanResult, setScanResult] = useState<ScanSummary | null>(null);

  // Source filter + Tab selection
  const [sourceFilter, setSourceFilter] = useState<"all" | "local" | "plex">("all");
  const [activeTab, setActiveTab] = useState<"library" | "plex">("library");

  // Plex Browser state
  const [plexSearch, setPlexSearch] = useState("");
  const [plexSort, setPlexSort] = useState("titleSort");
  const [plexStart, setPlexStart] = useState(0);
  const [plexResults, setPlexResults] = useState<any[]>([]);
  const [plexTotalSize, setPlexTotalSize] = useState(0);
  const [plexLoading, setPlexLoading] = useState(false);
  const plexPageSize = 50;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimer = useRef<number | undefined>(undefined);
  const pendingStart = useRef(0);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewingPlexKey, setPreviewingPlexKey] = useState<string | null>(null);

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
        source: sourceFilter,
      });
      setSongs(list);
    } finally {
      setLoading(false);
    }
  }, [status, flaggedOnly, sort, search, genreFilter, tagFilter, sourceFilter]);

  const loadPlexSongs = useCallback(async (startOffset = plexStart) => {
    setPlexLoading(true);
    try {
      const res = await searchPlex(plexSearch.trim(), plexSort, startOffset, plexPageSize);
      setPlexResults(res.results);
      setPlexTotalSize(res.totalSize);
      setPlexStart(startOffset);
    } catch (err) {
      console.error(err);
    } finally {
      setPlexLoading(false);
    }
  }, [plexSearch, plexSort, plexStart]);

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

  useEffect(() => {
    if (activeTab === "plex") {
      void loadPlexSongs(0);
    }
  }, [activeTab, plexSort, loadPlexSongs]);

  const handlePlexSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadPlexSongs(0);
  };

  const stopPreview = useCallback(() => {
    if (stopTimer.current !== undefined) window.clearTimeout(stopTimer.current);
    audioRef.current?.pause();
    setPreviewingId(null);
    setPreviewingPlexKey(null);
  }, []);

  const previewSong = useCallback(
    (song: LibrarySong) => {
      const audio = audioRef.current;
      if (audio === null) return;
      if (previewingId === song.id) {
        stopPreview();
        return;
      }
      stopPreview();
      pendingStart.current = song.snippetStartS ?? 30;
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

  const previewPlexTrack = useCallback(
    (track: { key: string }) => {
      const audio = audioRef.current;
      if (audio === null) return;
      if (previewingPlexKey === track.key) {
        stopPreview();
        return;
      }
      stopPreview();
      pendingStart.current = 30;
      audio.src = `/api/library/plex/preview?key=${encodeURIComponent(track.key)}`;
      audio.load();
      setPreviewingPlexKey(track.key);
      const lengthMs = 15 * 1000;
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
    [previewingPlexKey, stopPreview],
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

  const deleteSongFor = useCallback(async (id: string) => {
    setBusy(id);
    try {
      await deleteSong(id);
      setSongs((prev) => prev.filter((s) => s.id !== id));
      void refreshStats();
      void refreshFacets();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete song");
    } finally {
      setBusy(null);
    }
  }, [refreshStats, refreshFacets]);

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
                setScanResult(null);
                try {
                  const summary = await rescanLibrary();
                  setScanResult(summary);
                  await Promise.all([loadSongs(), refreshStats()]);
                } catch (err) {
                  setScanResult({
                    scanned: 0,
                    inserted: 0,
                    updated: 0,
                    flagged: 0,
                    errors: 1,
                    plexError: err instanceof Error ? err.message : "Library scan failed"
                  });
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

        {/* Tabs */}
        <div className="mt-4 flex gap-4 border-b border-slate-900 pb-0.5">
          <button
            type="button"
            onClick={() => {
              setActiveTab("library");
              stopPreview();
            }}
            className={`pb-2 text-sm font-bold border-b-2 transition ${
              activeTab === "library"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Game Library ({songs.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("plex");
              stopPreview();
            }}
            className={`pb-2 text-sm font-bold border-b-2 transition ${
              activeTab === "plex"
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            Plex Server Browser
          </button>
        </div>

        {activeTab === "library" ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <Segmented<StatusFilter>
              value={status}
              onChange={setStatus}
              options={[
                ["all", "All Statuses"],
                ["unreviewed", "Unreviewed"],
                ["approved", "Approved"],
                ["excluded", "Excluded"],
              ]}
            />
            
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as any)}
              className="rounded-xl border border-white/5 bg-slate-900/60 px-3 py-2 font-semibold text-slate-350 outline-none focus:border-indigo-500 transition cursor-pointer"
            >
              <option value="all">All Sources</option>
              <option value="local">📁 Local Only</option>
              <option value="plex">🔌 Plex Only</option>
            </select>

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
        ) : (
          <form onSubmit={handlePlexSearchSubmit} className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <input
              value={plexSearch}
              onChange={(e) => setPlexSearch(e.target.value)}
              placeholder="Search Plex by title / artist / album…"
              className="min-w-64 flex-1 rounded-xl border border-white/5 bg-slate-900/60 px-4 py-2 outline-none focus:border-indigo-500 focus:bg-slate-900 transition text-slate-100 shadow-inner"
            />
            <button
              type="submit"
              className="rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-500 transition"
            >
              Search
            </button>
            <select
              value={plexSort}
              onChange={(e) => setPlexSort(e.target.value)}
              className="rounded-xl border border-white/5 bg-slate-900/60 px-3 py-2 font-semibold text-slate-350 outline-none focus:border-indigo-500 transition cursor-pointer"
            >
              <option value="titleSort">Sort: Title (A-Z)</option>
              <option value="artist.titleSort,album.titleSort,track.index">Sort: Artist (A-Z)</option>
              <option value="album.titleSort,track.index">Sort: Album (A-Z)</option>
              <option value="year:desc">Sort: Year (Newest)</option>
              <option value="year">Sort: Year (Oldest)</option>
              <option value="addedAt:desc">Sort: Date Added</option>
            </select>

            {/* Pagination Controls */}
            {plexTotalSize > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  disabled={plexStart === 0 || plexLoading}
                  onClick={() => loadPlexSongs(Math.max(0, plexStart - plexPageSize))}
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                >
                  ◀ Prev
                </button>
                <span className="text-xs text-slate-400 font-semibold">
                  {plexStart + 1} - {Math.min(plexStart + plexPageSize, plexTotalSize)} of {plexTotalSize}
                </span>
                <button
                  type="button"
                  disabled={plexStart + plexPageSize >= plexTotalSize || plexLoading}
                  onClick={() => loadPlexSongs(plexStart + plexPageSize)}
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                >
                  Next ▶
                </button>
              </div>
            )}
          </form>
        )}
      </header>

      {scanResult && (
        <div className="mx-auto max-w-5xl px-4 pt-4">
          <div className={`p-4 rounded-2xl border text-sm relative ${
            scanResult.plexError 
              ? "border-rose-500/25 bg-rose-500/5 text-rose-200" 
              : "border-emerald-500/25 bg-emerald-500/5 text-emerald-200"
          }`}>
            <button 
              type="button" 
              onClick={() => setScanResult(null)}
              className="absolute top-3 right-3 text-slate-400 hover:text-white text-base"
              title="Dismiss"
            >
              ✕
            </button>
            <div className="font-bold flex items-center gap-1.5 text-base">
              {scanResult.plexError ? "⚠ Library Scan Completed with Issues" : "✨ Library Scan Completed"}
            </div>
            
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-semibold text-slate-300">
              <div className="bg-slate-900/50 p-2 rounded-xl border border-white/5">
                <div className="text-slate-500 uppercase text-[9px] tracking-wider">Scanned</div>
                <div className="text-sm font-bold text-white">{scanResult.scanned}</div>
              </div>
              <div className="bg-slate-900/50 p-2 rounded-xl border border-white/5">
                <div className="text-slate-500 uppercase text-[9px] tracking-wider">Newly Inserted</div>
                <div className="text-sm font-bold text-white">{scanResult.inserted}</div>
              </div>
              <div className="bg-slate-900/50 p-2 rounded-xl border border-white/5">
                <div className="text-slate-500 uppercase text-[9px] tracking-wider">Updated</div>
                <div className="text-sm font-bold text-white">{scanResult.updated}</div>
              </div>
              <div className="bg-slate-950 p-2 rounded-xl border border-white/5">
                <div className="text-slate-500 uppercase text-[9px] tracking-wider">Flagged Outliers</div>
                <div className="text-sm font-bold text-amber-400">{scanResult.flagged}</div>
              </div>
              <div className="bg-slate-950 p-2 rounded-xl border border-white/5">
                <div className="text-slate-500 uppercase text-[9px] tracking-wider">Errors</div>
                <div className="text-sm font-bold text-rose-400">{scanResult.errors}</div>
              </div>
            </div>

            {scanResult.plexError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 leading-relaxed whitespace-pre-line">
                <span className="font-bold block mb-0.5">Plex Scanning Issue:</span>
                {scanResult.plexError}
              </div>
            )}
          </div>
        </div>
      )}

      <main className="relative z-10 mx-auto max-w-5xl divide-y divide-slate-900/50 px-4 pb-24">
        {activeTab === "library" ? (
          <>
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
                onDelete={() => deleteSongFor(song.id)}
              />
            ))}
            {!loading && songs.length === 0 && (
              <p className="py-16 text-center text-slate-500">No songs match these filters.</p>
            )}
          </>
        ) : (
          <div className="divide-y divide-slate-900/50">
            {plexLoading ? (
              <p className="py-16 text-center text-slate-400">Loading Plex library tracks...</p>
            ) : (
              <>
                {plexResults.map((track) => (
                  <PlexTrackRow
                    key={track.ratingKey}
                    track={track}
                    previewing={previewingPlexKey === track.key}
                    onPreview={() => previewPlexTrack(track)}
                    onImport={async (status) => {
                      setBusy(track.ratingKey);
                      try {
                        const res = await importPlex(track.ratingKey, status);
                        setPlexResults((prev) =>
                          prev.map((t) =>
                            t.ratingKey === track.ratingKey
                              ? { ...t, isImported: true, songId: res.songId, status }
                              : t
                          )
                        );
                        void loadSongs();
                        void refreshStats();
                        void refreshFacets();
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "Import failed");
                      } finally {
                        setBusy(null);
                      }
                    }}
                    busy={busy === track.ratingKey}
                  />
                ))}
                {plexResults.length === 0 && (
                  <p className="py-16 text-center text-slate-500">
                    No Plex tracks found. Try searching or adjusting your query.
                  </p>
                )}
              </>
            )}
          </div>
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
  onDelete: () => void;
}) {
  const { song, busy, previewing, aiAvailable, onPreview, onPatch, onUploadArt, onDelete } = props;
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
      <div className="relative h-12 w-12 shrink-0">
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
          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold ${
            song.source === "plex" 
              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" 
              : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
          }`}>
            {song.source === "plex" ? "🔌 Plex" : "📁 Local"}
          </span>
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
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Are you sure you want to permanently delete "${song.title}" from the database?`)) {
                  onDelete();
                }
              }}
              disabled={busy}
              className="rounded bg-rose-700 hover:bg-rose-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlexTrackRow(props: {
  track: {
    ratingKey: string;
    key: string;
    title: string;
    artist: string | null;
    album: string | null;
    year: number | null;
    durationS: number | null;
    thumb: string | null;
    isImported: boolean;
    songId: string | null;
    status: SongStatus | null;
  };
  previewing: boolean;
  busy: boolean;
  onPreview: () => void;
  onImport: (status: "approved" | "unreviewed" | "excluded") => void;
}) {
  const { track, previewing, busy, onPreview, onImport } = props;

  const durationStr = track.durationS
    ? `${Math.floor(track.durationS / 60)}:${String(track.durationS % 60).padStart(2, "0")}`
    : "—";

  return (
    <div className="grid grid-cols-[3rem_1fr_auto] gap-3 py-4 pl-3 pr-1 border-l-4 border-l-slate-800">
      <div className="relative h-12 w-12 shrink-0">
        <button
          type="button"
          onClick={onPreview}
          title="Preview track (defaults to 30s)"
          className="relative h-full w-full overflow-hidden rounded bg-slate-900 text-lg border border-white/5"
        >
          {track.thumb ? (
            <img src={plexArtUrl(track.thumb)} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-slate-500">♪</span>
          )}
          <span className="absolute inset-0 flex items-center justify-center rounded bg-black/40 opacity-0 hover:opacity-100">
            {previewing ? "⏸" : "▶"}
          </span>
        </button>
      </div>

      <div className="min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-100 truncate">{track.title || "Unknown Track"}</span>
          {track.isImported && (
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
              track.status === "approved"
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                : track.status === "excluded"
                  ? "bg-rose-500/15 text-rose-400 border border-rose-500/20"
                  : "bg-slate-700/30 text-slate-400 border border-slate-700/50"
            }`}>
              Imported ({track.status || "unreviewed"})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-sm text-slate-400 truncate mt-0.5">
          <span className="truncate">{track.artist || "Unknown Artist"}</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-500 truncate">{track.album || "Unknown Album"}</span>
          {track.year && (
            <>
              <span className="text-slate-650">·</span>
              <span className="rounded bg-slate-900/50 px-1 py-0.2 text-xs text-slate-500 border border-white/5">{track.year}</span>
            </>
          )}
          {track.durationS && (
            <>
              <span className="text-slate-650">·</span>
              <span className="text-slate-500 text-xs">{durationStr}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {track.isImported ? (
          <span className="text-xs text-slate-500 italic pr-2 font-medium">Ready in game</span>
        ) : (
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => onImport("approved")}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50"
            >
              Import & Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onImport("unreviewed")}
              className="rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-350 transition disabled:opacity-50"
            >
              Import (Review later)
            </button>
          </div>
        )}
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
