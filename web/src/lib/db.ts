/**
 * SQLite database layer. Single shared connection per process.
 * Tables:
 *  - users          (id, phone, created_at)
 *  - sessions       (token, user_id, expires_at)
 *  - verify_codes   (phone, code, expires_at)
 *  - search_history (id, user_id, topic, created_at)
 *  - topic_stats    (topic, count, last_searched_at)
 *  - briefing_cache (topic, payload, expires_at)
 *  - expert_cache   (key, payload, expires_at)
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "app.db");

// Use a global singleton to survive Next.js dev hot reloads
declare global {
  // eslint-disable-next-line no-var
  var __ca_db: Database.Database | undefined;
}

export const db: Database.Database =
  global.__ca_db ??
  (() => {
    const instance = new Database(DB_PATH);
    instance.pragma("journal_mode = WAL");
    instance.pragma("foreign_keys = ON");
    initSchema(instance);
    return instance;
  })();

if (process.env.NODE_ENV !== "production") global.__ca_db = db;

function initSchema(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS verify_codes (
      phone TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_history_user_time ON search_history(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_user_topic ON search_history(user_id, topic);

    CREATE TABLE IF NOT EXISTS topic_stats (
      topic TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      last_searched_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_topic_stats_count ON topic_stats(count DESC);

    CREATE TABLE IF NOT EXISTS briefing_cache (
      topic TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expert_cache (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
}

/** Normalize a topic string (trim, lowercase-ish for case-insensitive comparison of Latin parts). */
export function normalizeTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, " ");
}

// ---------- Cache helpers ----------

export function getCachedBriefing(topic: string): unknown | null {
  const row = db
    .prepare(
      "SELECT payload, expires_at FROM briefing_cache WHERE topic = ?"
    )
    .get(normalizeTopic(topic)) as { payload: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM briefing_cache WHERE topic = ?").run(normalizeTopic(topic));
    return null;
  }
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

export function setCachedBriefing(
  topic: string,
  payload: unknown,
  ttlMs = 24 * 60 * 60 * 1000 // default 1 day (topic briefings track latest trends)
) {
  db.prepare(
    "INSERT OR REPLACE INTO briefing_cache (topic, payload, expires_at) VALUES (?, ?, ?)"
  ).run(normalizeTopic(topic), JSON.stringify(payload), Date.now() + ttlMs);
}

export function getCachedExpert(name: string, topic: string): unknown | null {
  const key = `${name.trim()}::${normalizeTopic(topic)}`;
  const row = db
    .prepare("SELECT payload, expires_at FROM expert_cache WHERE key = ?")
    .get(key) as { payload: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM expert_cache WHERE key = ?").run(key);
    return null;
  }
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

export function setCachedExpert(
  name: string,
  topic: string,
  payload: unknown,
  ttlMs = 7 * 24 * 60 * 60 * 1000 // default 7 days (experts' backgrounds change slowly)
) {
  const key = `${name.trim()}::${normalizeTopic(topic)}`;
  db.prepare(
    "INSERT OR REPLACE INTO expert_cache (key, payload, expires_at) VALUES (?, ?, ?)"
  ).run(key, JSON.stringify(payload), Date.now() + ttlMs);
}

// ---------- History + Trending ----------

export function recordSearch(userId: string | null, topic: string) {
  const norm = normalizeTopic(topic);
  const now = Date.now();

  // Update global topic_stats
  db.prepare(
    `INSERT INTO topic_stats (topic, count, last_searched_at) VALUES (?, 1, ?)
     ON CONFLICT(topic) DO UPDATE SET count = count + 1, last_searched_at = excluded.last_searched_at`
  ).run(norm, now);

  if (userId) {
    // Dedupe: if this user has this topic, update the timestamp instead of inserting a new row
    const existing = db
      .prepare(
        "SELECT id FROM search_history WHERE user_id = ? AND topic = ? ORDER BY created_at DESC LIMIT 1"
      )
      .get(userId, norm) as { id: number } | undefined;

    if (existing) {
      db.prepare("UPDATE search_history SET created_at = ? WHERE id = ?").run(now, existing.id);
    } else {
      db.prepare(
        "INSERT INTO search_history (user_id, topic, created_at) VALUES (?, ?, ?)"
      ).run(userId, norm, now);
    }
  }
}

export interface HistoryItem {
  topic: string;
  created_at: number;
}

export function getUserHistory(userId: string, limit = 50): HistoryItem[] {
  return db
    .prepare(
      "SELECT topic, created_at FROM search_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(userId, limit) as HistoryItem[];
}

export interface TrendingItem {
  topic: string;
  count: number;
}

export function getTrendingTopics(limit = 10, sinceMs = 7 * 24 * 60 * 60 * 1000): TrendingItem[] {
  const cutoff = Date.now() - sinceMs;
  return db
    .prepare(
      "SELECT topic, count FROM topic_stats WHERE last_searched_at > ? ORDER BY count DESC, last_searched_at DESC LIMIT ?"
    )
    .all(cutoff, limit) as TrendingItem[];
}
