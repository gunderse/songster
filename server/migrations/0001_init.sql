-- M0: core room + player tables. Library/game tables arrive in later migrations.

CREATE TABLE IF NOT EXISTS rooms (
  code            TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'lobby',
  config_json     TEXT NOT NULL DEFAULT '{}',
  game_state_json TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id               TEXT PRIMARY KEY,
  room_code        TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  team_id          TEXT,
  tokens_remaining INTEGER NOT NULL DEFAULT 2,
  connected        INTEGER NOT NULL DEFAULT 1,
  socket_id        TEXT,
  joined_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_code);
