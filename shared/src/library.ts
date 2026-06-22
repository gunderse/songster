import { z } from "zod";

/** Shared DTOs + schemas for the library/curation REST API (M2). */

export const songStatusSchema = z.enum(["unreviewed", "approved", "excluded"]);
export type SongStatus = z.infer<typeof songStatusSchema>;

export interface LibrarySong {
  id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  /** Primary genre (folder-derived); the full set lives in `genres`. */
  genre: string | null;
  genres: string[];
  tags: string[];
  rawYear: number | null;
  year: number | null;
  snippetStartS: number | null;
  snippetLenS: number | null;
  durationS: number | null;
  hasArt: boolean;
  status: SongStatus;
  suspiciousFlags: string[];
  source: "local" | "plex";
}

export interface FacetCount {
  value: string;
  count: number;
}

export interface LibraryFacets {
  genres: FacetCount[];
  tags: FacetCount[];
}

export interface LibraryStats {
  total: number;
  unreviewed: number;
  approved: number;
  excluded: number;
  flagged: number;
  /** Count of approved songs per decade (e.g. "1980": 4), keyed by curated year. */
  decades: Record<string, number>;
}

export const songListQuerySchema = z.object({
  status: z.union([songStatusSchema, z.literal("all")]).default("all"),
  flaggedOnly: z.coerce.boolean().default(false),
  search: z.string().trim().max(120).optional(),
  genre: z.string().trim().max(40).optional(),
  tag: z.string().trim().max(40).optional(),
  sort: z.enum(["title", "artist", "year", "flagged"]).default("flagged"),
  source: z.enum(["all", "local", "plex"]).default("all"),
});
export type SongListQuery = z.infer<typeof songListQuerySchema>;

const tagValue = z.string().trim().min(1).max(40);

export const songUpdateSchema = z
  .object({
    year: z.number().int().min(1850).max(2100).nullable(),
    snippetStartS: z.number().min(0).max(3600).nullable(),
    snippetLenS: z.number().min(1).max(60).nullable(),
    title: z.string().trim().min(1).max(200),
    artist: z.string().trim().min(1).max(200),
    album: z.string().trim().min(1).max(200),
    status: songStatusSchema,
    genres: z.array(tagValue).max(30),
    tags: z.array(tagValue).max(30),
  })
  .partial();
export type SongUpdate = z.infer<typeof songUpdateSchema>;

export const yearSuggestionSchema = z.object({
  year: z.number().int().min(1850).max(2100),
  confidence: z.enum(["high", "medium", "low"]),
  note: z.string().max(240).optional(),
});
export type YearSuggestion = z.infer<typeof yearSuggestionSchema>;
