CREATE TABLE IF NOT EXISTS song_plays (
  song_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played_at INTEGER NOT NULL
);
