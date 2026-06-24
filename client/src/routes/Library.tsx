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
  lookupWeb,
  importWebArt,
  type AiStatus,
  type ScanSummary,
  type WebMetadataResult,
  type PlexSearchResult,
  type PlexImportOverrides,
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

  // Local library advanced search states
  const [localShowAdvanced, setLocalShowAdvanced] = useState(false);
  const [localSearchTitle, setLocalSearchTitle] = useState("");
  const [localSearchArtist, setLocalSearchArtist] = useState("");
  const [localSearchAlbum, setLocalSearchAlbum] = useState("");
  const [localYearStart, setLocalYearStart] = useState("");
  const [localYearEnd, setLocalYearEnd] = useState("");
  const [localMissingYearOnly, setLocalMissingYearOnly] = useState(false);

  // Plex browser advanced search states
  const [plexShowAdvanced, setPlexShowAdvanced] = useState(false);
  const [plexSearchTitle, setPlexSearchTitle] = useState("");
  const [plexSearchArtist, setPlexSearchArtist] = useState("");
  const [plexSearchAlbum, setPlexSearchAlbum] = useState("");
  const [plexYearStart, setPlexYearStart] = useState("");
  const [plexYearEnd, setPlexYearEnd] = useState("");
  const [plexMissingYearOnly, setPlexMissingYearOnly] = useState(false);

  const songsAbortControllerRef = useRef<AbortController | null>(null);
  const plexAbortControllerRef = useRef<AbortController | null>(null);

  // Web lookup modal state
  const [activeLookupSong, setActiveLookupSong] = useState<LibrarySong | null>(null);
  const [activeImportTrack, setActiveImportTrack] = useState<PlexSearchResult["results"][number] | null>(null);
  const [artBusts, setArtBusts] = useState<Record<string, number>>({});

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

  // Plex search refs to prevent typing trigger loops
  const plexSearchRef = useRef("");
  const plexSearchTitleRef = useRef("");
  const plexSearchArtistRef = useRef("");
  const plexSearchAlbumRef = useRef("");
  const plexYearStartRef = useRef("");
  const plexYearEndRef = useRef("");
  const plexSortRef = useRef("titleSort");
  const plexMissingYearOnlyRef = useRef(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimer = useRef<number | undefined>(undefined);
  const pendingStart = useRef(0);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewingPlexKey, setPreviewingPlexKey] = useState<string | null>(null);

  const loadPlexSongs = useCallback(async (startOffset: number) => {
    if (plexAbortControllerRef.current) {
      plexAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    plexAbortControllerRef.current = controller;

    setPlexLoading(true);
    try {
      const res = await searchPlex({
        search: plexSearchRef.current.trim() || undefined,
        searchTitle: plexSearchTitleRef.current.trim() || undefined,
        searchArtist: plexSearchArtistRef.current.trim() || undefined,
        searchAlbum: plexSearchAlbumRef.current.trim() || undefined,
        yearStart: plexYearStartRef.current ? Number(plexYearStartRef.current) : undefined,
        yearEnd: plexYearEndRef.current ? Number(plexYearEndRef.current) : undefined,
        missingYear: plexMissingYearOnlyRef.current || undefined,
        sort: plexSortRef.current,
        start: startOffset,
        size: plexPageSize,
      }, controller.signal);
      setPlexResults(res.results);
      setPlexTotalSize(res.totalSize);
      setPlexStart(startOffset);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error(err);
    } finally {
      if (plexAbortControllerRef.current === controller) {
        setPlexLoading(false);
      }
    }
  }, []);

  // Pivot linking handler – writes to the active tab's state only
  const pivotSearch = useCallback((field: "artist" | "album" | "year", value: string | number) => {
    if (activeTab === "library") {
      setLocalShowAdvanced(true);
      setSearch("");
      setLocalSearchTitle("");
      setLocalSearchArtist("");
      setLocalSearchAlbum("");
      setLocalYearStart("");
      setLocalYearEnd("");
      setLocalMissingYearOnly(false);
      if (field === "artist") setLocalSearchArtist(String(value));
      else if (field === "album") setLocalSearchAlbum(String(value));
      else if (field === "year") { setLocalYearStart(String(value)); setLocalYearEnd(String(value)); }
    } else {
      setPlexShowAdvanced(true);
      setPlexSearch("");
      plexSearchRef.current = "";
      setPlexSearchTitle("");
      plexSearchTitleRef.current = "";
      setPlexSearchArtist("");
      plexSearchArtistRef.current = "";
      setPlexSearchAlbum("");
      plexSearchAlbumRef.current = "";
      setPlexYearStart("");
      plexYearStartRef.current = "";
      setPlexYearEnd("");
      plexYearEndRef.current = "";
      
      const artistVal = field === "artist" ? String(value) : "";
      setPlexSearchArtist(artistVal);
      plexSearchArtistRef.current = artistVal;

      const albumVal = field === "album" ? String(value) : "";
      setPlexSearchAlbum(albumVal);
      plexSearchAlbumRef.current = albumVal;

      const yStart = field === "year" ? String(value) : "";
      setPlexYearStart(yStart);
      plexYearStartRef.current = yStart;

      const yEnd = field === "year" ? String(value) : "";
      setPlexYearEnd(yEnd);
      plexYearEndRef.current = yEnd;

      setPlexMissingYearOnly(false);
      plexMissingYearOnlyRef.current = false;

      setPlexStart(0);
      void loadPlexSongs(0);
    }
  }, [activeTab, loadPlexSongs]);

  const loadSongs = useCallback(async () => {
    if (songsAbortControllerRef.current) {
      songsAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    songsAbortControllerRef.current = controller;

    setLoading(true);
    try {
      const list = await fetchSongs({
        status,
        flaggedOnly,
        missingYear: localMissingYearOnly || undefined,
        sort,
        search: search.trim() || undefined,
        searchTitle: localSearchTitle.trim() || undefined,
        searchArtist: localSearchArtist.trim() || undefined,
        searchAlbum: localSearchAlbum.trim() || undefined,
        yearStart: localYearStart ? Number(localYearStart) : undefined,
        yearEnd: localYearEnd ? Number(localYearEnd) : undefined,
        genre: genreFilter || undefined,
        tag: tagFilter || undefined,
        source: sourceFilter,
      }, controller.signal);
      setSongs(list);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error(err);
    } finally {
      if (songsAbortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, [status, flaggedOnly, sort, search, localSearchTitle, localSearchArtist, localSearchAlbum, localYearStart, localYearEnd, genreFilter, tagFilter, sourceFilter, localMissingYearOnly]);

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
    if (activeTab === "plex" && plexResults.length === 0) {
      void loadPlexSongs(0);
    }
  }, [activeTab, loadPlexSongs, plexResults.length]);

  useEffect(() => {
    return () => {
      songsAbortControllerRef.current?.abort();
      plexAbortControllerRef.current?.abort();
    };
  }, []);

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
      const lengthMs = (song.snippetLenS ?? 30) * 1000;
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
    (track: { key: string }, startS?: number) => {
      const audio = audioRef.current;
      if (audio === null) return;
      if (previewingPlexKey === track.key) {
        stopPreview();
        return;
      }
      stopPreview();
      pendingStart.current = startS !== undefined ? startS : 30;
      audio.src = `/api/library/plex/preview?key=${encodeURIComponent(track.key)}`;
      audio.load();
      setPreviewingPlexKey(track.key);
      const lengthMs = 30 * 1000;
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
    setArtBusts((prev) => ({ ...prev, [id]: Date.now() }));
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

        {/* Game Library Filters */}
        <div className={activeTab === "library" ? "mt-4 flex flex-wrap items-center gap-2 text-sm" : "hidden"}>
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
            className="rounded-xl border border-white/5 bg-slate-900/60 px-3 py-2 font-semibold text-slate-400 outline-none focus:border-indigo-500 transition cursor-pointer"
          >
            <option value="all">All Sources</option>
            <option value="local">📁 Local Only</option>
            <option value="plex">🔌 Plex Only</option>
          </select>

          <label className="flex items-center gap-2 rounded-xl border border-white/5 bg-slate-900/60 px-3 py-2 cursor-pointer hover:border-slate-800 hover:bg-slate-900 transition">
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} className="rounded text-indigo-600 focus:ring-0" />
            <span className="font-semibold text-slate-400">Flagged only</span>
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
          <button
            type="button"
            onClick={() => setLocalShowAdvanced(!localShowAdvanced)}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              localShowAdvanced
                ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                : "border-white/10 bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            ⚙️ Advanced
          </button>
          <span className="text-xs uppercase font-bold tracking-wider text-slate-500 pl-1">{loading ? "loading…" : `${songs.length} shown`}</span>
        </div>

        {/* Plex Server Browser Search Form */}
        <form
          onSubmit={handlePlexSearchSubmit}
          className={activeTab === "plex" ? "mt-4 flex flex-wrap items-center gap-2 text-sm" : "hidden"}
        >
          <input
            value={plexSearch}
            onChange={(e) => {
              setPlexSearch(e.target.value);
              plexSearchRef.current = e.target.value;
            }}
            placeholder="Search Plex by title / artist / album…"
            className="min-w-64 flex-1 rounded-xl border border-white/5 bg-slate-900/60 px-4 py-2 outline-none focus:border-indigo-500 focus:bg-slate-900 transition text-slate-100 shadow-inner"
          />
          <button
            type="submit"
            className="rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-500 transition cursor-pointer"
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => setPlexShowAdvanced(!plexShowAdvanced)}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              plexShowAdvanced
                ? "border-amber-500 bg-amber-600/20 text-amber-300"
                : "border-white/10 bg-slate-900 text-slate-400 hover:bg-slate-800"
            }`}
          >
            ⚙️ Advanced
          </button>
          <select
            value={plexSort}
            onChange={(e) => {
              const val = e.target.value;
              setPlexSort(val);
              plexSortRef.current = val;
              void loadPlexSongs(0);
            }}
            className="rounded-xl border border-white/5 bg-slate-900/60 px-3 py-2 font-semibold text-slate-400 outline-none focus:border-indigo-500 transition cursor-pointer"
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

        {/* Local library advanced search panel */}
        <div
          className={
            activeTab === "library" && localShowAdvanced
              ? "mt-3 grid grid-cols-1 sm:grid-cols-6 gap-3 p-4 rounded-xl border border-white/5 bg-slate-900/40 backdrop-blur-sm"
              : "hidden"
          }
        >
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Title</label>
            <input
              value={localSearchTitle}
              onChange={(e) => setLocalSearchTitle(e.target.value)}
              placeholder="Partial title..."
              className="rounded-lg border border-white/5 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500 transition"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Artist</label>
            <input
              value={localSearchArtist}
              onChange={(e) => setLocalSearchArtist(e.target.value)}
              placeholder="Partial artist..."
              className="rounded-lg border border-white/5 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500 transition"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Album</label>
            <input
              value={localSearchAlbum}
              onChange={(e) => setLocalSearchAlbum(e.target.value)}
              placeholder="Partial album..."
              className="rounded-lg border border-white/5 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500 transition"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Year From</label>
            <input
              type="number"
              value={localYearStart}
              onChange={(e) => setLocalYearStart(e.target.value)}
              disabled={localMissingYearOnly}
              placeholder="e.g. 1990"
              className="rounded-lg border border-white/5 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500 transition disabled:opacity-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Year To</label>
            <input
              type="number"
              value={localYearEnd}
              onChange={(e) => setLocalYearEnd(e.target.value)}
              disabled={localMissingYearOnly}
              placeholder="e.g. 2000"
              className="rounded-lg border border-white/5 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500 transition disabled:opacity-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Options</label>
            <div className="flex gap-2 items-center h-full">
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-300">
                <input
                  type="checkbox"
                  checked={localMissingYearOnly}
                  onChange={(e) => setLocalMissingYearOnly(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0"
                />
                <span>No Year Only</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setLocalSearchTitle("");
                  setLocalSearchArtist("");
                  setLocalSearchAlbum("");
                  setLocalYearStart("");
                  setLocalYearEnd("");
                  setSearch("");
                  setLocalMissingYearOnly(false);
                }}
                className="ml-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-900 transition hover:text-white"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Plex browser advanced search panel */}
        <div
          className={
            activeTab === "plex" && plexShowAdvanced
              ? "mt-3 grid grid-cols-1 sm:grid-cols-6 gap-3 p-4 rounded-xl border border-amber-500/10 bg-slate-900/40 backdrop-blur-sm"
              : "hidden"
          }
        >
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Title</label>
            <input
              value={plexSearchTitle}
              onChange={(e) => {
                setPlexSearchTitle(e.target.value);
                plexSearchTitleRef.current = e.target.value;
                setPlexStart(0);
              }}
              placeholder="Partial title..."
              className="rounded-lg border border-white/5 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500 transition"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Artist</label>
            <input
              value={plexSearchArtist}
              onChange={(e) => {
                setPlexSearchArtist(e.target.value);
                plexSearchArtistRef.current = e.target.value;
                setPlexStart(0);
              }}
              placeholder="Partial artist..."
              className="rounded-lg border border-white/5 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500 transition"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Album</label>
            <input
              value={plexSearchAlbum}
              onChange={(e) => {
                setPlexSearchAlbum(e.target.value);
                plexSearchAlbumRef.current = e.target.value;
                setPlexStart(0);
              }}
              placeholder="Partial album..."
              className="rounded-lg border border-white/5 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500 transition"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Year From</label>
            <input
              type="number"
              value={plexYearStart}
              onChange={(e) => {
                setPlexYearStart(e.target.value);
                plexYearStartRef.current = e.target.value;
                setPlexStart(0);
              }}
              disabled={plexMissingYearOnly}
              placeholder="e.g. 1990"
              className="rounded-lg border border-white/5 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500 transition disabled:opacity-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Year To</label>
            <input
              type="number"
              value={plexYearEnd}
              onChange={(e) => {
                setPlexYearEnd(e.target.value);
                plexYearEndRef.current = e.target.value;
                setPlexStart(0);
              }}
              disabled={plexMissingYearOnly}
              placeholder="e.g. 2000"
              className="rounded-lg border border-white/5 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-amber-500 transition disabled:opacity-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Options</label>
            <div className="flex gap-2 items-center h-full">
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-300">
                <input
                  type="checkbox"
                  checked={plexMissingYearOnly}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setPlexMissingYearOnly(checked);
                    plexMissingYearOnlyRef.current = checked;
                    setPlexStart(0);
                    void loadPlexSongs(0);
                  }}
                  className="rounded text-amber-600 focus:ring-0"
                />
                <span>No Year Only</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setPlexSearchTitle("");
                  plexSearchTitleRef.current = "";
                  setPlexSearchArtist("");
                  plexSearchArtistRef.current = "";
                  setPlexSearchAlbum("");
                  plexSearchAlbumRef.current = "";
                  setPlexYearStart("");
                  plexYearStartRef.current = "";
                  setPlexYearEnd("");
                  plexYearEndRef.current = "";
                  setPlexSearch("");
                  plexSearchRef.current = "";
                  setPlexMissingYearOnly(false);
                  plexMissingYearOnlyRef.current = false;
                  setPlexStart(0);
                  void loadPlexSongs(0);
                }}
                className="ml-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-900 transition hover:text-white"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
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

      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-24">
        {/* Game Library tab content */}
        <div className={activeTab === "library" ? "divide-y divide-slate-900/50" : "hidden"}>
          {songs.map((song) => (
            <SongRow
              key={song.id}
              song={song}
              busy={busy === song.id}
              previewing={previewingId === song.id}
              aiAvailable={ai?.ok === true && ai.modelAvailable === true}
              artBust={artBusts[song.id] || 0}
              onPreview={() => previewSong(song)}
              onPatch={(update) => applyPatch(song.id, update)}
              onUploadArt={(file) => uploadArtFor(song.id, file)}
              onDelete={() => deleteSongFor(song.id)}
              onPivot={pivotSearch}
              onWebLookup={() => setActiveLookupSong(song)}
            />
          ))}
          {!loading && songs.length === 0 && (
            <p className="py-16 text-center text-slate-500">No songs match these filters.</p>
          )}
        </div>

        {/* Plex Server Browser tab content */}
        <div className={activeTab === "plex" ? "divide-y divide-slate-900/50" : "hidden"}>
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
                  onImport={() => setActiveImportTrack(track)}
                  onPivot={pivotSearch}
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
      </main>

      {activeLookupSong && (
        <WebLookupModal
          song={activeLookupSong}
          onClose={() => setActiveLookupSong(null)}
          onSongUpdated={(updatedSong) => {
            setSongs((prev) => prev.map((s) => (s.id === updatedSong.id ? updatedSong : s)));
            if (updatedSong.hasArt) {
              setArtBusts((prev) => ({ ...prev, [updatedSong.id]: Date.now() }));
            }
            setActiveLookupSong(updatedSong);
            void refreshStats();
            void refreshFacets();
          }}
        />
      )}

      {activeImportTrack && (
        <PlexImportModal
          track={activeImportTrack}
          previewing={previewingPlexKey === activeImportTrack.key}
          onPreview={(startS) => previewPlexTrack(activeImportTrack, startS)}
          onClose={() => setActiveImportTrack(null)}
          onImport={async (overrides, status) => {
            setBusy(activeImportTrack.ratingKey);
            try {
              const res = await importPlex(activeImportTrack.ratingKey, status, overrides);
              setPlexResults((prev) =>
                prev.map((t) =>
                  t.ratingKey === activeImportTrack.ratingKey
                    ? { ...t, isImported: true, songId: res.songId, status }
                    : t
                )
              );
              if (overrides.artUrl) {
                setArtBusts((prev) => ({ ...prev, [res.songId]: Date.now() }));
              }
              void loadSongs();
              void refreshStats();
              void refreshFacets();
            } catch (err) {
              alert(err instanceof Error ? err.message : "Import failed");
              throw err;
            } finally {
              setBusy(null);
            }
          }}
        />
      )}
    </div>
  );
}

function SongRow(props: {
  song: LibrarySong;
  busy: boolean;
  previewing: boolean;
  aiAvailable: boolean;
  artBust: number;
  onPreview: () => void;
  onPatch: (update: SongUpdate) => Promise<LibrarySong>;
  onUploadArt: (file: File) => Promise<void>;
  onDelete: () => void;
  onPivot: (field: "artist" | "album" | "year", value: string | number) => void;
  onWebLookup: () => void;
}) {
  const { song, busy, previewing, aiAvailable, artBust, onPreview, onPatch, onUploadArt, onDelete, onPivot, onWebLookup } = props;
  const [year, setYear] = useState<string>(song.year?.toString() ?? "");
  const [start, setStart] = useState<string>(song.snippetStartS?.toString() ?? "");
  const [title, setTitle] = useState(song.title ?? "");
  const [artist, setArtist] = useState(song.artist ?? "");
  const [album, setAlbum] = useState(song.album ?? "");
  const [suggestion, setSuggestion] = useState<YearSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    <div className={`group grid grid-cols-[3rem_1fr_auto] gap-3 border-l-4 ${statusTint} py-3 pl-3 pr-1`}>
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
            if (file !== undefined) void onUploadArt(file);
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
          <div className="flex items-center flex-1 min-w-0">
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              onBlur={() => commitText("artist", artist, song.artist)}
              placeholder="artist"
              className="min-w-0 flex-1 rounded bg-transparent outline-none hover:bg-slate-800/50 focus:bg-slate-800 focus:px-1"
            />
            {song.artist && (
              <button
                type="button"
                onClick={() => onPivot("artist", song.artist!)}
                title={`Find other tracks by ${song.artist}`}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 ml-1 text-slate-500 hover:text-indigo-400 p-0.5 transition cursor-pointer"
              >
                🔍
              </button>
            )}
          </div>
          <span className="shrink-0 text-slate-600">·</span>
          <div className="flex items-center flex-1 min-w-0">
            <input
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              onBlur={() => commitText("album", album, song.album)}
              placeholder="album"
              className="min-w-0 flex-1 rounded bg-transparent text-slate-500 outline-none hover:bg-slate-800/50 focus:bg-slate-800 focus:px-1"
            />
            {song.album && (
              <button
                type="button"
                onClick={() => onPivot("album", song.album!)}
                title={`Find other tracks from album ${song.album}`}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 ml-1 text-slate-500 hover:text-indigo-400 p-0.5 transition cursor-pointer"
              >
                🔍
              </button>
            )}
          </div>
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
          <div className="flex items-center gap-1">
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
            {song.year && (
              <button
                type="button"
                onClick={() => onPivot("year", song.year!)}
                title={`Find other tracks from ${song.year}`}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-500 hover:text-indigo-400 p-0.5 transition cursor-pointer"
              >
                🔍
              </button>
            )}
          </div>
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
          <div className="flex gap-1">
            <button
              type="button"
              onClick={requestSuggestion}
              disabled={!aiAvailable || suggesting}
              title={aiAvailable ? "Ask the local LLM for the original year" : "Ollama unavailable"}
              className="flex-1 rounded border border-indigo-700 px-2 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-900/40 disabled:opacity-40"
            >
              {suggesting ? "…" : "Suggest"}
            </button>
            <button
              type="button"
              onClick={onWebLookup}
              title="Search public web resources (iTunes) for year and artwork"
              className="flex-1 rounded border border-indigo-700/80 bg-slate-900 px-2 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-900/40 cursor-pointer"
            >
              🌐 Lookup
            </button>
          </div>
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
  onImport: () => void;
  onPivot: (field: "artist" | "album" | "year", value: string | number) => void;
}) {
  const { track, previewing, busy, onPreview, onImport, onPivot } = props;

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
          {track.artist ? (
            <button
              type="button"
              onClick={() => onPivot("artist", track.artist!)}
              className="hover:underline text-indigo-400 hover:text-indigo-300 font-medium transition cursor-pointer text-left truncate bg-transparent border-0 p-0"
            >
              {track.artist}
            </button>
          ) : (
            <span className="truncate text-slate-500">Unknown Artist</span>
          )}
          <span className="text-slate-600">·</span>
          {track.album ? (
            <button
              type="button"
              onClick={() => onPivot("album", track.album!)}
              className="hover:underline text-indigo-400/90 hover:text-indigo-400 font-medium transition cursor-pointer text-left truncate bg-transparent border-0 p-0"
            >
              {track.album}
            </button>
          ) : (
            <span className="truncate text-slate-500">Unknown Album</span>
          )}
          {track.year && (
            <>
              <span className="text-slate-600">·</span>
              <button
                type="button"
                onClick={() => onPivot("year", track.year!)}
                className="rounded bg-slate-900/50 px-1.5 py-0.5 text-xs text-slate-400 border border-white/5 hover:border-indigo-500 hover:text-indigo-300 transition cursor-pointer"
              >
                {track.year}
              </button>
            </>
          )}
          {track.durationS && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-slate-500 text-xs">{durationStr}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {track.isImported && (
          <span className="text-xs text-slate-500 italic pr-1 font-medium">✓ In game</span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (track.isImported) {
              if (!window.confirm(`"${track.title}" has already been imported. Are you sure you want to re-import it?`)) return;
            }
            onImport();
          }}
          className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition disabled:opacity-50 cursor-pointer ${
            track.isImported
              ? "border border-indigo-700/50 bg-indigo-900/30 hover:bg-indigo-800/40 text-indigo-300"
              : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/10"
          }`}
        >
          {track.isImported ? "Curation & Re-import" : "Curation & Import"}
        </button>
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

interface WebLookupModalProps {
  song: LibrarySong;
  onClose: () => void;
  onSongUpdated: (updatedSong: LibrarySong) => void;
}

type LookupField = "title" | "artist" | "album" | "year" | "genre" | "art";

export function WebLookupModal({ song, onClose, onSongUpdated }: WebLookupModalProps) {
  const [title, setTitle] = useState(song.title ?? "");
  const [artist, setArtist] = useState(
    song.artist && song.artist.toLowerCase() !== "various artists" ? song.artist : ""
  );
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<WebMetadataResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<number | null>(null);
  // Per-row checkbox selections: Map<rowIdx, Set<field>>
  const [selections, setSelections] = useState<Map<number, Set<LookupField>>>(new Map());

  const executeLookup = useCallback(async (searchTitle: string, searchArtist: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await lookupWeb(searchTitle, searchArtist);
      setResults(data);
      // Auto-check missing fields for each result
      const initSelections = new Map<number, Set<LookupField>>();
      data.forEach((result, idx) => {
        const checked = new Set<LookupField>();
        // Auto-check fields the song is missing
        if (!song.artist && result.artist) checked.add("artist");
        if (!song.album && result.album) checked.add("album");
        if (song.year === null && result.year !== null) checked.add("year");
        if (!song.hasArt && result.artUrl) checked.add("art");
        // Auto-check genre if song has no tags and result has genre
        if (song.tags.length === 0 && result.genre) checked.add("genre");
        // Title is never auto-checked (opt-in override only)
        initSelections.set(idx, checked);
      });
      setSelections(initSelections);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [song.artist, song.album, song.year, song.hasArt, song.tags.length]);

  useEffect(() => {
    void executeLookup(title, artist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void executeLookup(title, artist);
  };

  const toggleField = (idx: number, field: LookupField) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(idx) ?? []);
      if (set.has(field)) set.delete(field);
      else set.add(field);
      next.set(idx, set);
      return next;
    });
  };

  const toggleSelectAll = (idx: number, importableFields: LookupField[]) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = prev.get(idx) ?? new Set();
      const allSelected = importableFields.every((f) => current.has(f));
      if (allSelected) {
        next.set(idx, new Set());
      } else {
        next.set(idx, new Set(importableFields));
      }
      return next;
    });
  };

  const handleApplySelected = async (idx: number) => {
    const checked = selections.get(idx);
    if (!checked || checked.size === 0) return;
    const result = results[idx];
    if (!result) return;
    setBusyRow(idx);
    try {
      let updated = song;
      // Build a single patch for text fields
      const patch: Record<string, any> = {};
      if (checked.has("title") && result.title) patch.title = result.title;
      if (checked.has("artist") && result.artist) patch.artist = result.artist;
      if (checked.has("album") && result.album) patch.album = result.album;
      if (checked.has("year") && result.year !== null) patch.year = result.year;
      if (checked.has("genre")) {
        const genreTags = result.genres && result.genres.length > 0 ? result.genres : (result.genre ? [result.genre] : []);
        const existingTags = updated.tags || [];
        const newTags = [...existingTags];
        for (const g of genreTags) {
          if (!newTags.includes(g)) {
            newTags.push(g);
          }
        }
        if (newTags.length > existingTags.length) {
          patch.tags = newTags;
        }
      }
      if (Object.keys(patch).length > 0) {
        updated = await patchSong(song.id, patch);
      }
      if (checked.has("art") && result.artUrl) {
        updated = await importWebArt(song.id, result.artUrl);
      }
      onSongUpdated(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to apply metadata");
    } finally {
      setBusyRow(null);
    }
  };

  const handleUseAll = async (idx: number, importableFields: LookupField[]) => {
    setSelections((prev) => {
      const next = new Map(prev);
      next.set(idx, new Set(importableFields));
      return next;
    });
    const result = results[idx];
    if (!result) return;
    setBusyRow(idx);
    try {
      let updated = song;
      const patch: Record<string, any> = {};
      if (result.title) patch.title = result.title;
      if (result.artist) patch.artist = result.artist;
      if (result.album) patch.album = result.album;
      if (result.year !== null) patch.year = result.year;
      const genreTags = result.genres && result.genres.length > 0 ? result.genres : (result.genre ? [result.genre] : []);
      const existingTags = updated.tags || [];
      const newTags = [...existingTags];
      for (const g of genreTags) {
        if (!newTags.includes(g)) {
          newTags.push(g);
        }
      }
      if (newTags.length > existingTags.length) {
        patch.tags = newTags;
      }
      if (Object.keys(patch).length > 0) {
        updated = await patchSong(song.id, patch);
      }
      if (result.artUrl) {
        updated = await importWebArt(song.id, result.artUrl);
      }
      onSongUpdated(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to apply metadata");
    } finally {
      setBusyRow(null);
    }
  };

  const fieldLabel = (field: LookupField, result: WebMetadataResult): string => {
    switch (field) {
      case "title": return result.title ?? "—";
      case "artist": return result.artist ?? "—";
      case "album": return result.album ?? "—";
      case "year": return result.year?.toString() ?? "—";
      case "genre": return result.genres && result.genres.length > 0 ? result.genres.join(", ") : (result.genre ?? "—");
      case "art": return "Cover art";
    }
  };

  const fieldMissing = (field: LookupField): boolean => {
    switch (field) {
      case "title": return !song.title;
      case "artist": return !song.artist;
      case "album": return !song.album;
      case "year": return song.year === null;
      case "genre": return song.tags.length === 0;
      case "art": return !song.hasArt;
    }
  };

  const fieldDiffers = (field: LookupField, result: WebMetadataResult): boolean => {
    switch (field) {
      case "title": return !!result.title && result.title !== song.title;
      case "artist": return !!result.artist && result.artist !== song.artist;
      case "album": return !!result.album && result.album !== song.album;
      case "year": return result.year !== null && result.year !== song.year;
      case "genre":
        if (result.genres && result.genres.length > 0) {
          return result.genres.some((g) => !song.tags.includes(g));
        }
        return !!result.genre && !song.tags.includes(result.genre);
      case "art": return !!result.artUrl;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <span>🌐 Web Metadata Lookup</span>
            </h2>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              Curation for: <span className="font-semibold text-indigo-300">{song.title}</span> by <span className="font-semibold text-indigo-300">{song.artist}</span>
            </p>
            {/* Missing field indicators */}
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {(["title", "artist", "album", "year", "art"] as LookupField[]).map((f) =>
                fieldMissing(f) ? (
                  <span key={f} className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                    missing {f}
                  </span>
                ) : null
              )}
              {song.tags.length === 0 && (
                <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                  no tags
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white transition text-lg p-1.5 hover:bg-slate-800 rounded-xl"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSearch} className="p-4 bg-slate-900/60 border-b border-slate-800 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px] flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Title Query</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Song title"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500 transition"
            />
          </div>
          <div className="flex-1 min-w-[200px] flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Artist Query</label>
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Artist"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500 transition"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 px-4 py-1.5 text-sm font-semibold text-white transition h-[38px] cursor-pointer"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        <div className="flex-1 overflow-y-auto p-4 divide-y divide-slate-800/60">
          {loading && results.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <span className="inline-block animate-spin mr-2">⏳</span> Querying iTunes API...
            </div>
          ) : error ? (
            <div className="py-8 text-center text-rose-400 text-sm font-medium">{error}</div>
          ) : results.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">No web matches found. Check spelling or try refining queries.</div>
          ) : (
            results.map((result, idx) => {
              const isBusy = busyRow === idx;
              const checked = selections.get(idx) ?? new Set<LookupField>();
              // Build list of importable fields for this result
              const importableFields: Array<{ field: LookupField; label: string; value: string; isMissing: boolean; differs: boolean }> = [];
              
              if (result.title && fieldDiffers("title", result)) {
                importableFields.push({
                  field: "title",
                  label: "Title",
                  value: result.title,
                  isMissing: fieldMissing("title"),
                  differs: true,
                });
              }
              if (result.artist && fieldDiffers("artist", result)) {
                importableFields.push({
                  field: "artist",
                  label: "Artist",
                  value: result.artist,
                  isMissing: fieldMissing("artist"),
                  differs: true,
                });
              }
              if (result.album && fieldDiffers("album", result)) {
                importableFields.push({
                  field: "album",
                  label: "Album",
                  value: result.album,
                  isMissing: fieldMissing("album"),
                  differs: true,
                });
              }
              if (result.year !== null && fieldDiffers("year", result)) {
                importableFields.push({
                  field: "year",
                  label: "Year",
                  value: String(result.year),
                  isMissing: fieldMissing("year"),
                  differs: true,
                });
              }
              if (result.genre && fieldDiffers("genre", result)) {
                importableFields.push({
                  field: "genre",
                  label: "Tag",
                  value: result.genre,
                  isMissing: song.tags.length === 0,
                  differs: true,
                });
              }
              if (result.artUrl) {
                importableFields.push({
                  field: "art",
                  label: "Art",
                  value: "Cover image",
                  isMissing: fieldMissing("art"),
                  differs: true,
                });
              }

              return (
                <div key={idx} className="flex gap-4 py-4 first:pt-0 last:pb-0 items-start">
                  <div className="relative h-16 w-16 shrink-0 bg-slate-950 rounded-lg overflow-hidden border border-white/5">
                    {result.artUrl ? (
                      <img src={result.artUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-slate-500 text-lg">♪</span>
                    )}
                  </div>
                  
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-100 truncate text-sm">{result.title}</div>
                    <div className="text-xs text-slate-400 truncate mt-0.5">{result.artist}</div>
                    <div className="text-xs text-slate-500 truncate">{result.album || "—"}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {result.year && (
                        <span className="rounded bg-slate-800/80 border border-slate-700/50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300">
                          {result.year}
                        </span>
                      )}
                      {result.genres && result.genres.length > 0 ? (
                        result.genres.map((g) => (
                          <span key={g} className="rounded bg-teal-900/40 border border-teal-700/30 px-1.5 py-0.5 text-[10px] font-bold text-teal-300">
                            {g}
                          </span>
                        ))
                      ) : result.genre ? (
                        <span className="rounded bg-teal-900/40 border border-teal-700/30 px-1.5 py-0.5 text-[10px] font-bold text-teal-300">
                          {result.genre}
                        </span>
                      ) : null}
                    </div>

                    {/* Per-field checkboxes */}
                    {importableFields.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 items-center">
                        <button
                          type="button"
                          onClick={() => toggleSelectAll(idx, importableFields.map(f => f.field))}
                          className="rounded border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300 transition cursor-pointer"
                        >
                          {importableFields.every(f => checked.has(f.field)) ? "Deselect All" : "Select All"}
                        </button>
                        {importableFields.map(({ field, label, value, isMissing }) => (
                          <label
                            key={field}
                            className={`flex items-center gap-1.5 text-[11px] cursor-pointer rounded px-1.5 py-0.5 transition ${
                              checked.has(field)
                                ? isMissing
                                  ? "bg-amber-600/20 text-amber-200"
                                  : "bg-indigo-600/20 text-indigo-200"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked.has(field)}
                              onChange={() => toggleField(idx, field)}
                              className="rounded text-indigo-600 focus:ring-0 h-3 w-3"
                            />
                            <span className="font-semibold">{label}:</span>
                            <span className="truncate max-w-[140px]">{value}</span>
                            {isMissing && (
                              <span className="text-[9px] font-bold text-amber-400 uppercase">fill</span>
                            )}
                            {!isMissing && field !== "art" && field !== "genre" && (
                              <span className="text-[9px] font-bold text-slate-500 uppercase">override</span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0 items-end">
                    <button
                      type="button"
                      disabled={isBusy || checked.size === 0}
                      onClick={() => handleApplySelected(idx)}
                      className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-semibold text-white transition cursor-pointer whitespace-nowrap"
                    >
                      {isBusy ? "Applying..." : `Apply ${checked.size} field${checked.size !== 1 ? "s" : ""}`}
                    </button>
                    {importableFields.length > 0 && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleUseAll(idx, importableFields.map(f => f.field))}
                        className="rounded-lg border border-indigo-700/50 bg-indigo-900/30 hover:bg-indigo-800/40 disabled:opacity-40 px-3 py-1 text-[10px] font-semibold text-indigo-300 transition cursor-pointer whitespace-nowrap"
                      >
                        Use All
                      </button>
                    )}
                    {importableFields.length === 0 && (
                      <span className="text-[10px] text-slate-500 italic">All fields match</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

interface PlexImportModalProps {
  track: PlexSearchResult["results"][number];
  previewing: boolean;
  onPreview: (startS: number) => void;
  onClose: () => void;
  onImport: (overrides: PlexImportOverrides, status: SongStatus) => Promise<void>;
}

export function PlexImportModal({ track, previewing, onPreview, onClose, onImport }: PlexImportModalProps) {
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist ?? "");
  const [album, setAlbum] = useState(track.album ?? "");
  const [year, setYear] = useState(track.year ? String(track.year) : "");
  const [startS, setStartS] = useState("30");
  const [tags, setTags] = useState<string[]>([]);
  const [selectedArtUrl, setSelectedArtUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Search lookup state
  const [searchTitle, setSearchTitle] = useState(track.title);
  const [searchArtist, setSearchArtist] = useState(
    track.artist && track.artist.toLowerCase() !== "various artists" ? track.artist : ""
  );
  const [lookupResults, setLookupResults] = useState<WebMetadataResult[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Map<number, Set<LookupField>>>(new Map());

  const artistRef = useRef(artist);
  artistRef.current = artist;
  const albumRef = useRef(album);
  albumRef.current = album;
  const yearRef = useRef(year);
  yearRef.current = year;
  const selectedArtUrlRef = useRef(selectedArtUrl);
  selectedArtUrlRef.current = selectedArtUrl;
  const tagsRef = useRef(tags);
  tagsRef.current = tags;

  const executeLookup = useCallback(async (qTitle: string, qArtist: string) => {
    setLookupLoading(true);
    setLookupError(null);
    try {
      const data = await lookupWeb(qTitle, qArtist);
      setLookupResults(data);
      // Auto-check missing fields
      const initSelections = new Map<number, Set<LookupField>>();
      data.forEach((result, idx) => {
        const checked = new Set<LookupField>();
        if (!artistRef.current && result.artist) checked.add("artist");
        if (!albumRef.current && result.album) checked.add("album");
        if (!yearRef.current && result.year !== null) checked.add("year");
        if (!track.thumb && !selectedArtUrlRef.current && result.artUrl) checked.add("art");
        if (tagsRef.current.length === 0 && result.genre) checked.add("genre");
        initSelections.set(idx, checked);
      });
      setSelections(initSelections);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLookupLoading(false);
    }
  }, [track.thumb]);

  useEffect(() => {
    void executeLookup(searchTitle, searchArtist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeLookup(searchTitle, searchArtist);
  };

  const toggleField = (idx: number, field: LookupField) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(idx) ?? []);
      if (set.has(field)) set.delete(field);
      else set.add(field);
      next.set(idx, set);
      return next;
    });
  };

  const toggleSelectAll = (idx: number, importableFields: LookupField[]) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = prev.get(idx) ?? new Set();
      const allSelected = importableFields.every((f) => current.has(f));
      if (allSelected) {
        next.set(idx, new Set());
      } else {
        next.set(idx, new Set(importableFields));
      }
      return next;
    });
  };

  const handleUseMatch = (idx: number) => {
    const checked = selections.get(idx);
    if (!checked || checked.size === 0) return;
    const result = lookupResults[idx];
    if (!result) return;

    if (checked.has("title") && result.title) setTitle(result.title);
    if (checked.has("artist") && result.artist) setArtist(result.artist);
    if (checked.has("album") && result.album) setAlbum(result.album);
    if (checked.has("year") && result.year !== null) setYear(String(result.year));
    if (checked.has("genre")) {
      const genreTags = result.genres && result.genres.length > 0 ? result.genres : (result.genre ? [result.genre] : []);
      setTags((prev) => {
        const next = [...prev];
        for (const g of genreTags) {
          if (!next.includes(g)) {
            next.push(g);
          }
        }
        return next;
      });
    }
    if (checked.has("art") && result.artUrl) {
      setSelectedArtUrl(result.artUrl);
    }
  };

  const handleUseAll = (idx: number, importableFields: LookupField[]) => {
    setSelections((prev) => {
      const next = new Map(prev);
      next.set(idx, new Set(importableFields));
      return next;
    });
    const result = lookupResults[idx];
    if (!result) return;
    if (result.title) setTitle(result.title);
    if (result.artist) setArtist(result.artist);
    if (result.album) setAlbum(result.album);
    if (result.year !== null) setYear(String(result.year));
    const genreTags = result.genres && result.genres.length > 0 ? result.genres : (result.genre ? [result.genre] : []);
    setTags((prev) => {
      const next = [...prev];
      for (const g of genreTags) {
        if (!next.includes(g)) {
          next.push(g);
        }
      }
      return next;
    });
    if (result.artUrl) {
      setSelectedArtUrl(result.artUrl);
    }
  };

  const handleImportClick = async (status: SongStatus) => {
    setBusy(true);
    try {
      const numYear = year.trim() === "" ? null : Number(year);
      if (numYear !== null && (isNaN(numYear) || !Number.isInteger(numYear))) {
        alert("Year must be a valid integer");
        return;
      }
      const numStart = startS.trim() === "" ? 30 : Number(startS);
      if (isNaN(numStart) || numStart < 0) {
        alert("Start seconds must be a positive number");
        return;
      }
      const overrides: PlexImportOverrides = {
        title: title.trim(),
        artist: artist.trim() || undefined,
        album: album.trim() || undefined,
        year: numYear,
        tags,
        artUrl: selectedArtUrl || undefined,
        snippetStartS: numStart,
      };
      await onImport(overrides, status);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  // Helper values for dynamic badges
  const isMissingTitle = !title.trim();
  const isMissingArtist = !artist.trim();
  const isMissingAlbum = !album.trim();
  const isMissingYear = !year.trim();
  const isMissingArt = !track.thumb && !selectedArtUrl;

  const durationStr = track.durationS
    ? `${Math.floor(track.durationS / 60)}:${String(track.durationS % 60).padStart(2, "0")}`
    : "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <span>🔌 Curate & Import Plex Track</span>
            </h2>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {isMissingTitle && (
                <span className="rounded bg-rose-950/40 border border-rose-800/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-400">
                  missing title
                </span>
              )}
              {isMissingArtist && (
                <span className="rounded bg-amber-950/40 border border-amber-800/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                  missing artist
                </span>
              )}
              {isMissingAlbum && (
                <span className="rounded bg-amber-950/40 border border-amber-800/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                  missing album
                </span>
              )}
              {isMissingYear && (
                <span className="rounded bg-amber-950/40 border border-amber-800/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                  missing year
                </span>
              )}
              {isMissingArt && (
                <span className="rounded bg-amber-950/40 border border-amber-800/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                  missing art
                </span>
              )}
              {tags.length === 0 && (
                <span className="rounded bg-amber-950/40 border border-amber-800/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-450">
                  no tags
                </span>
              )}
              {!isMissingTitle && !isMissingArtist && !isMissingAlbum && !isMissingYear && !isMissingArt && (
                <span className="rounded bg-emerald-950/40 border border-emerald-800/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                  ✓ ready to import
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white transition text-lg p-1.5 hover:bg-slate-800 rounded-xl"
          >
            ✕
          </button>
        </div>

        {/* Content Columns */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-800 overflow-y-auto min-h-0">
          
          {/* Left Column: Edit Form */}
          <div className="p-6 flex flex-col gap-5 overflow-y-auto">
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">1. Edit Metadata</h3>
            
            <div className="flex gap-4 items-start">
              {/* Cover Artwork Preview */}
              <div className="relative h-28 w-28 shrink-0 bg-slate-950 rounded-xl overflow-hidden border border-white/5 shadow-inner">
                {selectedArtUrl ? (
                  <img src={selectedArtUrl} alt="iTunes Cover" className="h-full w-full object-cover animate-in fade-in duration-300" />
                ) : track.thumb ? (
                  <img src={plexArtUrl(track.thumb)} alt="Plex Cover" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-slate-500 text-2xl">♪</span>
                )}
                
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-bold text-white uppercase">
                  {selectedArtUrl ? "web art" : "plex art"}
                </span>
              </div>
              
              <div className="flex-1 flex flex-col gap-2 justify-center h-28">
                <div className="text-xs text-slate-400 font-semibold truncate">
                  Plex Track Key: <span className="text-slate-300 font-mono text-[11px] block truncate mt-0.5">{track.key}</span>
                </div>
                <div className="flex gap-2 items-center">
                  <button
                    type="button"
                    onClick={() => onPreview(Number(startS) || 30)}
                    className="rounded-lg border border-slate-700 hover:border-indigo-500 bg-slate-800 hover:bg-indigo-900/30 px-3 py-1.5 text-xs font-semibold text-slate-200 transition cursor-pointer"
                  >
                    {previewing ? "⏸ Pause Snippet" : "▶ Play Preview"}
                  </button>
                  <span className="text-xs text-slate-500">Duration: {durationStr}</span>
                </div>
              </div>
            </div>

            {/* Input Form Fields */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Song Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Yesterday"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Artist</label>
                <input
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="e.g. The Beatles"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Album</label>
                <input
                  value={album}
                  onChange={(e) => setAlbum(e.target.value)}
                  placeholder="e.g. Help!"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Year</label>
                  <input
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    placeholder="e.g. 1965"
                    inputMode="numeric"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-center text-slate-100 outline-none focus:border-indigo-500 transition"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Start Seconds</label>
                  <input
                    value={startS}
                    onChange={(e) => setStartS(e.target.value)}
                    placeholder="e.g. 30"
                    inputMode="numeric"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-center text-slate-100 outline-none focus:border-indigo-500 transition"
                  />
                </div>
              </div>

              {/* Tags Section */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Curation Tags</label>
                <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-slate-800 bg-slate-950 min-h-[40px] items-center">
                  {tags.map((tag) => (
                    <RemovableChip
                      key={tag}
                      label={tag}
                      tone="tag"
                      onRemove={() => setTags((prev) => prev.filter((t) => t !== tag))}
                    />
                  ))}
                  <TagAdder
                    onAdd={(value) => {
                      if (!tags.includes(value)) setTags((prev) => [...prev, value]);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Web Lookup */}
          <div className="p-6 flex flex-col overflow-y-auto">
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3">2. Search Web Metadata</h3>
            
            <form onSubmit={handleSearchSubmit} className="flex gap-2 items-end mb-4 bg-slate-950/40 p-3 border border-slate-800 rounded-xl">
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <label className="text-[9px] uppercase font-bold tracking-wider text-slate-500">Title Query</label>
                <input
                  value={searchTitle}
                  onChange={(e) => setSearchTitle(e.target.value)}
                  placeholder="Title query"
                  className="w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500 transition"
                />
              </div>
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <label className="text-[9px] uppercase font-bold tracking-wider text-slate-500">Artist Query</label>
                <input
                  value={searchArtist}
                  onChange={(e) => setSearchArtist(e.target.value)}
                  placeholder="Artist query"
                  className="w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500 transition"
                />
              </div>
              <button
                type="submit"
                disabled={lookupLoading}
                className="rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 px-3 py-1.5 text-xs font-semibold text-white transition h-[26px] flex items-center justify-center cursor-pointer whitespace-nowrap"
              >
                {lookupLoading ? "..." : "Search"}
              </button>
            </form>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 min-h-0 pr-1">
              {lookupLoading && lookupResults.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  <span className="inline-block animate-spin mr-2">⏳</span> Querying iTunes API...
                </div>
              ) : lookupError ? (
                <div className="py-8 text-center text-rose-400 text-xs font-medium">{lookupError}</div>
              ) : lookupResults.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">No web matches found. Clear artist/title or try another search query.</div>
              ) : (
                lookupResults.map((result, idx) => {
                  const checked = selections.get(idx) ?? new Set<LookupField>();
                  
                  // Compute difference compared to current modal form state
                  const diffFields: Array<{ field: LookupField; label: string; value: string; isMissing: boolean }> = [];
                  if (result.title && result.title.trim() !== title.trim()) {
                    diffFields.push({ field: "title", label: "Title", value: result.title, isMissing: !title.trim() });
                  }
                  if (result.artist && result.artist.trim() !== artist.trim()) {
                    diffFields.push({ field: "artist", label: "Artist", value: result.artist, isMissing: !artist.trim() });
                  }
                  if (result.album && result.album.trim() !== album.trim()) {
                    diffFields.push({ field: "album", label: "Album", value: result.album, isMissing: !album.trim() });
                  }
                  if (result.year !== null && String(result.year) !== year.trim()) {
                    diffFields.push({ field: "year", label: "Year", value: String(result.year), isMissing: !year.trim() });
                  }
                  if (result.genres && result.genres.length > 0) {
                    const missingGenres = result.genres.filter(g => !tags.includes(g));
                    if (missingGenres.length > 0) {
                      diffFields.push({ field: "genre", label: "Tag", value: result.genres.join(", "), isMissing: tags.length === 0 });
                    }
                  } else if (result.genre && !tags.includes(result.genre)) {
                    diffFields.push({ field: "genre", label: "Tag", value: result.genre, isMissing: tags.length === 0 });
                  }
                  if (result.artUrl && result.artUrl !== selectedArtUrl) {
                    diffFields.push({ field: "art", label: "Art", value: "Cover image", isMissing: isMissingArt });
                  }

                  return (
                    <div key={idx} className="flex gap-3 py-3 first:pt-0 last:pb-0 items-start">
                      <div className="relative h-12 w-12 shrink-0 bg-slate-950 rounded-lg overflow-hidden border border-white/5">
                        {result.artUrl ? (
                          <img src={result.artUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-slate-500">♪</span>
                        )}
                      </div>
                      
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-100 truncate text-xs">{result.title}</div>
                        <div className="text-[11px] text-slate-400 truncate">{result.artist}</div>
                        <div className="text-[10px] text-slate-500 truncate">{result.album || "—"}</div>
                        
                        <div className="flex gap-1 mt-0.5">
                          {result.year && (
                            <span className="rounded bg-slate-800 px-1 py-0.25 text-[9px] font-bold text-indigo-300">{result.year}</span>
                          )}
                          {result.genres && result.genres.length > 0 ? (
                            result.genres.map((g) => (
                              <span key={g} className="rounded bg-teal-900/40 px-1 py-0.25 text-[9px] font-bold text-teal-300">{g}</span>
                            ))
                          ) : result.genre ? (
                            <span className="rounded bg-teal-900/40 px-1 py-0.25 text-[9px] font-bold text-teal-300">{result.genre}</span>
                          ) : null}
                        </div>

                        {/* Checkboxes */}
                        {diffFields.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1 items-center">
                            <button
                              type="button"
                              onClick={() => toggleSelectAll(idx, diffFields.map(f => f.field))}
                              className="rounded border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 px-1 py-0.25 text-[9px] font-bold text-indigo-300 transition cursor-pointer"
                            >
                              {diffFields.every(f => checked.has(f.field)) ? "Deselect All" : "Select All"}
                            </button>
                            {diffFields.map(({ field, label, value, isMissing }) => (
                              <label
                                key={field}
                                className={`flex items-center gap-1 text-[10px] cursor-pointer rounded px-1 py-0.25 transition ${
                                  checked.has(field)
                                    ? isMissing
                                      ? "bg-amber-600/20 text-amber-200"
                                      : "bg-indigo-600/20 text-indigo-200"
                                    : "text-slate-400 hover:text-slate-200"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked.has(field)}
                                  onChange={() => toggleField(idx, field)}
                                  className="rounded text-indigo-600 focus:ring-0 h-2.5 w-2.5"
                                />
                                <span className="font-semibold">{label}:</span>
                                <span className="truncate max-w-[100px]">{value}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 flex flex-col gap-1.5 justify-center h-12">
                        <button
                          type="button"
                          disabled={checked.size === 0}
                          onClick={() => handleUseMatch(idx)}
                          className="rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-2 py-1 text-[10px] font-bold text-white transition cursor-pointer whitespace-nowrap"
                        >
                          Use Match
                        </button>
                        {diffFields.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handleUseAll(idx, diffFields.map(f => f.field))}
                            className="rounded border border-indigo-700/50 bg-indigo-900/30 hover:bg-indigo-800/40 px-2 py-0.5 text-[9px] font-bold text-indigo-300 transition cursor-pointer whitespace-nowrap"
                          >
                            Use All
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 hover:bg-slate-800 hover:text-white px-4 py-2 text-sm font-semibold text-slate-400 transition cursor-pointer"
          >
            Cancel
          </button>
          
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleImportClick("unreviewed")}
              className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition cursor-pointer"
            >
              Import (Review later)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleImportClick("approved")}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2 text-sm font-semibold text-white transition cursor-pointer shadow-lg shadow-indigo-600/20"
            >
              {busy ? "Importing..." : "Import & Approve"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

