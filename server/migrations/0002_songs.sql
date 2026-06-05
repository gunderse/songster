-- M1: the curated song library.
--
-- The scanner inserts rows as 'unreviewed' with year = raw_year (the tag year,
-- which is often a reissue/compilation year). The curation UI (M2) confirms the
-- original release year and flips status to 'approved' so the song can be played.
-- Re-scans refresh tag-derived fields but never clobber curation outputs
-- (year, status, snippet_start_s).

CREATE TABLE IF NOT EXISTS songs (
  id               TEXT PRIMARY KEY,                     -- opaque id (hash of relative path); used for spoiler-safe streaming
  file_path        TEXT NOT NULL UNIQUE,                 -- path relative to SONGSTER_MUSIC_DIR
  title            TEXT,
  artist           TEXT,
  album            TEXT,
  genre            TEXT,                                 -- from the genre subfolder name
  tag_genre        TEXT,                                 -- ID3 genre, if present
  raw_year         INTEGER,                              -- year as read from tags (may be wrong)
  year             INTEGER,                              -- curated original release year (authoritative for play)
  snippet_start_s  REAL,                                 -- where the snippet begins (curator can scrub)
  snippet_len_s    REAL,                                 -- per-song override; NULL = use global default
  duration_s       REAL,
  art_path         TEXT,                                 -- relative to server/data, e.g. art/<id>.jpg
  status           TEXT NOT NULL DEFAULT 'unreviewed',   -- unreviewed | approved | excluded
  suspicious_flags TEXT NOT NULL DEFAULT '[]',           -- JSON array of flag strings
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_songs_status ON songs(status);
CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs(genre);
CREATE INDEX IF NOT EXISTS idx_songs_year ON songs(year);
