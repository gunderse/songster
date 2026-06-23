-- M9: Persistent settings/configuration key-value table.
-- Used to store LAN Plex credentials and settings.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
