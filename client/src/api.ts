import type {
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
  if (query.sort) params.set("sort", query.sort);
  return http<{ songs: LibrarySong[] }>(`/api/library/songs?${params.toString()}`).then((r) => r.songs);
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

export function audioStreamUrl(id: string): string {
  return `/audio/${id}/stream`;
}

export function artUrl(id: string): string {
  return `/audio/${id}/art`;
}
