import type {
  LibraryFacets,
  LibrarySong,
  LibraryStats,
  SongListQuery,
  SongUpdate,
  YearSuggestion,
  SongStatus,
} from "@songster/shared/library";

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = ((await response.json()) as { error?: string }).error ?? "";
    } catch {
      // no JSON body
    }
    throw new Error(detail.length > 0 ? detail : `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export function fetchStats(): Promise<LibraryStats> {
  return http<LibraryStats>("/api/library/stats");
}

export function fetchSongs(query: Partial<SongListQuery> & { missingYear?: boolean }, signal?: AbortSignal): Promise<LibrarySong[]> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.flaggedOnly) params.set("flaggedOnly", "true");
  if (query.missingYear) params.set("missingYear", "true");
  if (query.search) params.set("search", query.search);
  if (query.searchTitle) params.set("searchTitle", query.searchTitle);
  if (query.searchArtist) params.set("searchArtist", query.searchArtist);
  if (query.searchAlbum) params.set("searchAlbum", query.searchAlbum);
  if (query.yearStart !== undefined) params.set("yearStart", String(query.yearStart));
  if (query.yearEnd !== undefined) params.set("yearEnd", String(query.yearEnd));
  if (query.genre) params.set("genre", query.genre);
  if (query.tag) params.set("tag", query.tag);
  if (query.sort) params.set("sort", query.sort);
  if (query.source) params.set("source", query.source);
  return http<{ songs: LibrarySong[] }>(`/api/library/songs?${params.toString()}`, { signal }).then((r) => r.songs);
}

export function fetchFacets(): Promise<LibraryFacets> {
  return http<LibraryFacets>("/api/library/facets");
}

export function patchSong(id: string, update: SongUpdate): Promise<LibrarySong> {
  return http<{ song: LibrarySong }>(`/api/library/songs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(update),
  }).then((r) => r.song);
}

export function suggestYear(id: string): Promise<YearSuggestion> {
  return http<{ suggestion: YearSuggestion }>(`/api/library/songs/${id}/suggest-year`, {
    method: "POST",
  }).then((r) => r.suggestion);
}

export interface AiStatus {
  ok: boolean;
  model: string;
  modelAvailable?: boolean;
  models?: string[];
  error?: string;
}

export function fetchAiStatus(): Promise<AiStatus> {
  return http<AiStatus>("/api/library/ai-status");
}

export interface ScanSummary {
  scanned: number;
  inserted: number;
  updated: number;
  flagged: number;
  errors: number;
  plexError?: string;
}

export function rescanLibrary(): Promise<ScanSummary> {
  return http<{ summary: ScanSummary }>("/api/library/scan", { method: "POST" }).then((r) => r.summary);
}

export async function uploadArt(id: string, file: File): Promise<LibrarySong> {
  const response = await fetch(`/api/library/songs/${id}/art`, {
    method: "POST",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status})`);
  }
  return ((await response.json()) as { song: LibrarySong }).song;
}

export function audioStreamUrl(id: string): string {
  return `/audio/${id}/stream`;
}

export function artUrl(id: string): string {
  return `/audio/${id}/art`;
}

export interface PlexSettings {
  url: string;
  libraryName: string;
  hasToken: boolean;
}

export function fetchPlexSettings(): Promise<PlexSettings> {
  return http<PlexSettings>("/api/library/settings/plex");
}

export function savePlexSettings(url: string, libraryName: string): Promise<{ ok: boolean }> {
  return http<{ ok: boolean }>("/api/library/settings/plex", {
    method: "POST",
    body: JSON.stringify({ url, libraryName }),
  });
}

export interface PlexTestResult {
  success: boolean;
  message?: string;
  error?: string;
}

export function testPlexSettings(url: string, libraryName: string): Promise<PlexTestResult> {
  return http<PlexTestResult>("/api/library/settings/plex/test", {
    method: "POST",
    body: JSON.stringify({ url, libraryName }),
  });
}

export function requestPlexPin(): Promise<{ pinId: number; code: string }> {
  return http<{ pinId: number; code: string }>("/api/library/settings/plex/auth/pin", {
    method: "POST",
  });
}

export function checkPlexAuth(pinId: number): Promise<{ ok: boolean; connected: boolean }> {
  return http<{ ok: boolean; connected: boolean }>(`/api/library/settings/plex/auth/check/${pinId}`);
}

export interface PlexSearchResult {
  totalSize: number;
  results: Array<{
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
  }>;
}

export interface PlexSearchQuery {
  search?: string;
  searchTitle?: string;
  searchArtist?: string;
  searchAlbum?: string;
  yearStart?: number;
  yearEnd?: number;
  missingYear?: boolean;
  sort?: string;
  start: number;
  size: number;
}

export function searchPlex(query: PlexSearchQuery, signal?: AbortSignal): Promise<PlexSearchResult> {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.searchTitle) params.set("searchTitle", query.searchTitle);
  if (query.searchArtist) params.set("searchArtist", query.searchArtist);
  if (query.searchAlbum) params.set("searchAlbum", query.searchAlbum);
  if (query.yearStart !== undefined) params.set("yearStart", String(query.yearStart));
  if (query.yearEnd !== undefined) params.set("yearEnd", String(query.yearEnd));
  if (query.missingYear) params.set("missingYear", "true");
  if (query.sort) params.set("sort", query.sort);
  params.set("start", String(query.start));
  params.set("size", String(query.size));
  return http<PlexSearchResult>(`/api/library/plex/search?${params.toString()}`, { signal });
}

export interface PlexImportOverrides {
  title?: string;
  artist?: string;
  album?: string;
  year?: number | null;
  genres?: string[];
  tags?: string[];
  artUrl?: string;
  snippetStartS?: number | null;
}

export function importPlex(
  ratingKey: string,
  status: "approved" | "unreviewed" | "excluded",
  overrides?: PlexImportOverrides
): Promise<{ success: boolean; songId: string; title: string; artist: string | null }> {
  return http<{ success: boolean; songId: string; title: string; artist: string | null }>("/api/library/plex/import", {
    method: "POST",
    body: JSON.stringify({ ratingKey, status, ...overrides }),
  });
}

export function deleteSong(id: string): Promise<{ success: boolean; id: string }> {
  return http<{ success: boolean; id: string }>(`/api/library/songs/${id}`, {
    method: "DELETE",
  });
}

export function plexArtUrl(thumb: string): string {
  return `/api/library/plex/art?thumb=${encodeURIComponent(thumb)}`;
}

export interface WebMetadataResult {
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  artUrl: string | null;
  genre: string | null;
}

export function lookupWeb(title: string, artist: string): Promise<WebMetadataResult[]> {
  const params = new URLSearchParams();
  params.set("title", title);
  params.set("artist", artist);
  return http<{ results: WebMetadataResult[] }>(`/api/library/lookup-web?${params.toString()}`).then((r) => r.results);
}

export function importWebArt(id: string, artUrl: string): Promise<LibrarySong> {
  return http<{ song: LibrarySong }>(`/api/library/songs/${id}/import-web-art`, {
    method: "POST",
    body: JSON.stringify({ artUrl }),
  }).then((r) => r.song);
}
