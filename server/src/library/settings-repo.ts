import type DatabaseType from "better-sqlite3";

/** Get a setting value from the database, falling back to defaultValue. */
export function getSetting(db: DatabaseType.Database, key: string, defaultValue: string): string {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row !== undefined ? row.value : defaultValue;
  } catch {
    return defaultValue;
  }
}

/** Set or update a setting value in the database. */
export function setSetting(db: DatabaseType.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
