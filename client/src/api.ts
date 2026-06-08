import type {
  LibraryFacets,
  LibrarySong,
  LibraryStats,
  SongListQuery,
  SongUpdate,
  YearSuggestion,
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

export function fetchSongs(query: Partial<SongListQuery>): Promise<LibrarySong[]> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.flaggedOnly) params.set("flaggedOnly", "true");
  if (query.search) params.set("search", query.search);
  if (query.genre) params.set("genre", query.genre);
  if (query.tag) params.set("tag", query.tag);
  if (query.sort) params.set("sort", query.sort);
  return http<{ songs: LibrarySong[] }>(`/api/library/songs?${params.toString()}`).then((r) => r.songs);
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

export function requestPlexPin(): Promise<{ pinId: number; code: string }> {
  return http<{ pinId: number; code: string }>("/api/library/settings/plex/auth/pin", {
    method: "POST",
  });
}

export function checkPlexAuth(pinId: number): Promise<{ ok: boolean; connected: boolean }> {
  return http<{ ok: boolean; connected: boolean }>(`/api/library/settings/plex/auth/check/${pinId}`);
}
