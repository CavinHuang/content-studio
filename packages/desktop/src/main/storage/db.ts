import { DatabaseSync } from 'node:sqlite'

export const DB_VERSION = 6

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
  if (current < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS discovery_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        updated TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        builtin INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS discovery_articles (
        id TEXT PRIMARY KEY,
        urlKey TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        bodyState TEXT NOT NULL DEFAULT 'link-only',
        published TEXT NOT NULL DEFAULT '',
        collectedAt TEXT NOT NULL,
        collectedDisplay TEXT NOT NULL DEFAULT '',
        metricsJson TEXT NOT NULL DEFAULT '[]',
        sourceIdsJson TEXT NOT NULL DEFAULT '[]',
        sortIndex INTEGER NOT NULL DEFAULT 0,
        groupJson TEXT,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_discovery_articles_collected ON discovery_articles (collectedAt DESC);
    `)
  }
  if (current < 4) {
    // executor 落库：主进程执行器任务（P2 生成 / P3 来源刷新）经事件重读后必须携带
    // executor，否则渲染端兜底会把它伪结算成「演示任务已完成」。
    // refreshMinutes：P3 可配置定时刷新（0 = 仅手动）。
    db.exec(`
      ALTER TABLE tasks ADD COLUMN executor TEXT;
      ALTER TABLE discovery_sources ADD COLUMN refreshMinutes INTEGER NOT NULL DEFAULT 0;
    `)
  }
  if (current < 5) {
    // P4 公众号凭证：照 ai_config 模式，secret 经 safeStorage 加密存 BLOB，
    // plain=1 表示 safeStorage 不可用时的明文降级（视图层警示）。
    db.exec(`
      CREATE TABLE IF NOT EXISTS wechat_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        appId TEXT NOT NULL,
        secretEnc BLOB,
        plain INTEGER NOT NULL DEFAULT 0,
        updated TEXT NOT NULL
      );
    `)
  }
  if (current < 6) {
    // P5 语音服务配置：照 ai_config/wechat_config 模式，key 经 safeStorage 加密存 BLOB。
    db.exec(`
      CREATE TABLE IF NOT EXISTS tts_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        baseUrl TEXT NOT NULL,
        modelId TEXT NOT NULL,
        voice TEXT NOT NULL,
        apiKeyEnc BLOB,
        plain INTEGER NOT NULL DEFAULT 0,
        updated TEXT NOT NULL
      );
    `)
  }
  db.exec(`PRAGMA user_version = ${DB_VERSION}`)
}
