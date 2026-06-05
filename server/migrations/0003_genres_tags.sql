-- Music database enrichment: genre becomes one-to-many, plus free-form meta tags.
-- This decouples the playable library from raw ID3: the scanner seeds genres from
-- the folder name + ID3, and the curator can add/remove genres and tags freely.
-- These power dynamic deck generation (filter a game by genre / tag / decade).

CREATE TABLE IF NOT EXISTS song_genres (
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  genre   TEXT NOT NULL,
  PRIMARY KEY (song_id, genre)
);
CREATE INDEX IF NOT EXISTS idx_song_genres_genre ON song_genres(genre);

CREATE TABLE IF NOT EXISTS song_tags (
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (song_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_song_tags_tag ON song_tags(tag);

-- Backfill genres from the folder-derived genre and the ID3 genre already on songs.
INSERT OR IGNORE INTO song_genres (song_id, genre)
  SELECT id, genre FROM songs WHERE genre IS NOT NULL AND TRIM(genre) != '';
INSERT OR IGNORE INTO song_genres (song_id, genre)
  SELECT id, tag_genre FROM songs WHERE tag_genre IS NOT NULL AND TRIM(tag_genre) != '';
