import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const dataDir = path.resolve(import.meta.dirname, "../data");
const migrationsDir = path.resolve(import.meta.dirname, "../migrations");
const databasePath = path.join(dataDir, "songster.db");

function ensureDataDir(): void {
  fs.mkdirSync(dataDir, { recursive: true });
}

export function openDatabase(): Database.Database {
  ensureDataDir();
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((row) => row.id));

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of migrationFiles) {
    if (applied.has(fileName)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, fileName), "utf8");
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(fileName, Date.now());
    });

    applyMigration();
  }
}

export function initializeDatabase(): Database.Database {
  const db = openDatabase();
  runMigrations(db);
  return db;
}

export function getDatabasePath(): string {
  return databasePath;
}
