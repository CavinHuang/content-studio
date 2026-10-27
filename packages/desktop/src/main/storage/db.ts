import { DatabaseSync } from 'node:sqlite'

export const DB_VERSION = 2

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

// user_version 阶梯：每个历史版本一段 if，只升不降；新表只在这里建。
export function migrate(db: DatabaseSync): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  if (current < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema INTEGER NOT NULL,
        json TEXT NOT NULL,
        updated TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        projectId TEXT NOT NULL,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        at TEXT NOT NULL,
        updated TEXT NOT NULL,
        progress TEXT,
        error TEXT,
        payloadJson TEXT,
        resultJson TEXT,
        extraJson TEXT
      );
    `)
  }
  if (current < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        providerId TEXT NOT NULL,
        name TEXT,
        baseUrl TEXT NOT NULL,
        modelId TEXT NOT NULL,
        apiKeyEnc BLOB,
        plain INTEGER NOT NULL DEFAULT 0,
        updated TEXT NOT NULL
      );
    `)
  }
  db.exec(`PRAGMA user_version = ${DB_VERSION}`)
}
