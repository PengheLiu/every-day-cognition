/**
 * SQLite database layer. Single shared connection per process.
 * Uses Node 22+ built-in `node:sqlite` (no native compile — works on any
 * GLIBC version). Node 22.x still requires --experimental-sqlite; start.sh
 * injects it via NODE_OPTIONS.
 *
 * Tables:
 *  - users          (id, phone, created_at)
 *  - sessions       (token, user_id, expires_at)
 *  - verify_codes   (phone, code, expires_at)
 *  - search_history (id, user_id, topic, created_at)
 *  - topic_stats    (topic, count, last_searched_at)
 *  - briefing_cache (topic, payload, expires_at)
 *  - expert_cache   (key, payload, expires_at)
 *  - image_cache    (key, url, expires_at)
 *  - domain_search_cache (topic, results, expires_at)
 *  - generation_jobs (id, user_id, topic, status, progress_message, events, ...)
 */
import path from "path";
import fs from "fs";

// Turbopack and Webpack both try to resolve `node:sqlite` at build time and
// fail ("Unsupported external type Url for commonjs reference"). We bypass
// static analysis completely by doing the require through an indirect eval.
// This resolves at runtime on the server only (never reaches the client).
//
// Minimal ambient typing for what we use; `@types/node` 22+ has real types
// under `node:sqlite`, but importing them would re-trigger bundler scanning.
interface SqliteStatement {
  run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface SqliteModule {
  DatabaseSync: new (filename: string) => SqliteDatabase;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire: (m: string) => any = eval("require");
const { DatabaseSync } = nodeRequire("node:sqlite") as SqliteModule;
type DatabaseSyncType = SqliteDatabase;

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "app.db");

// Use a global singleton to survive Next.js dev hot reloads
declare global {
  // eslint-disable-next-line no-var
  var __ca_db: DatabaseSyncType | undefined;
}

/**
 * Lazy initializer. We MUST NOT open the DB at module-evaluation time —
 * Next.js `next build` spawns 15 parallel workers that all import route
 * modules to collect page metadata, and if each worker opens the same
 * SQLite file concurrently, we hit "database is locked" during the WAL
 * initialization handshake.
 *
 * With lazy init behind a Proxy, `import { db }` is zero-cost; the first
 * `db.prepare(...)` / `db.exec(...)` etc. call at runtime opens the
 * connection. Build-time workers never trigger that, so they stay closed.
 */
let _dbInstance: DatabaseSyncType | null = null;

function getRealDb(): DatabaseSyncType {
  if (_dbInstance) return _dbInstance;
  if (global.__ca_db) {
    _dbInstance = global.__ca_db;
    return _dbInstance;
  }
  const instance = new DatabaseSync(DB_PATH);
  instance.exec("PRAGMA journal_mode = WAL");
  instance.exec("PRAGMA foreign_keys = ON");
  initSchema(instance);
  runMigrations(instance);
  _dbInstance = instance;
  if (process.env.NODE_ENV !== "production") global.__ca_db = instance;
  return instance;
}

/**
 * Forward-compatibility migrations for existing databases. `CREATE TABLE IF
 * NOT EXISTS` doesn't add new columns to tables that already exist, so any
 * schema additions have to be applied explicitly here.
 */
function runMigrations(d: DatabaseSyncType) {
  // Add users.nickname on existing dbs. New dbs already have it from initSchema.
  const userCols = d.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userCols.some((c) => c.name === "nickname")) {
    d.exec("ALTER TABLE users ADD COLUMN nickname TEXT");
  }
}

/**
 * Exposed as if it were a real DatabaseSync — all property accesses are
 * delegated to the underlying connection (opened on first access).
 */
export const db = new Proxy({} as DatabaseSyncType, {
  get(_target, prop: string | symbol) {
    const real = getRealDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    // Bind methods to the real instance so `this` is correct
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

function initSchema(d: DatabaseSyncType) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      nickname TEXT,
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

    -- Generated illustration cache. Key = "{kind}::{normalizedTopic}[::{dimLabel}]".
    -- URL is the base64 data URL returned by the image model. Images are
    -- deterministic per (topic, dimension) so we persist them across refreshes
    -- and share across users — avoids regenerating on every page load.
    CREATE TABLE IF NOT EXISTS image_cache (
      key TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    -- Phase A domain-level search results, shared across users for a topic.
    -- Much cheaper than re-running 8 Bing/Baidu searches every time.
    CREATE TABLE IF NOT EXISTS domain_search_cache (
      topic TEXT PRIMARY KEY,
      results TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT,                 -- nullable: allow anonymous
      topic TEXT NOT NULL,
      status TEXT NOT NULL,         -- pending | searching | generating | done | error | cancelled
      progress_message TEXT,        -- latest human-readable status
      events TEXT,                  -- JSON array: [{type, message, ts, ...}]
      result_topic TEXT,            -- the topic key used for briefing_cache lookup (normalized)
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON generation_jobs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON generation_jobs(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_topic ON generation_jobs(topic);
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

// ---------- Image cache ----------

/** Build a canonical cache key for a hero/dimension image. */
export function imageCacheKey(
  kind: "hero" | "dimension",
  topic: string,
  dimensionLabel?: string
): string {
  const base = `${kind}::${normalizeTopic(topic)}`;
  return dimensionLabel ? `${base}::${dimensionLabel.trim()}` : base;
}

export function getCachedImage(key: string): string | null {
  const row = db
    .prepare("SELECT url, expires_at FROM image_cache WHERE key = ?")
    .get(key) as { url: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM image_cache WHERE key = ?").run(key);
    return null;
  }
  return row.url;
}

export function setCachedImage(
  key: string,
  url: string,
  ttlMs = 7 * 24 * 60 * 60 * 1000 // 7 days — images don't track trends like briefings do
) {
  db.prepare(
    "INSERT OR REPLACE INTO image_cache (key, url, expires_at) VALUES (?, ?, ?)"
  ).run(key, url, Date.now() + ttlMs);
}

/** Phase A domain search results — shared across users per topic. */
export function getCachedDomainSearch<T>(topic: string): T | null {
  const row = db
    .prepare("SELECT results, expires_at FROM domain_search_cache WHERE topic = ?")
    .get(normalizeTopic(topic)) as { results: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM domain_search_cache WHERE topic = ?").run(normalizeTopic(topic));
    return null;
  }
  try {
    return JSON.parse(row.results) as T;
  } catch {
    return null;
  }
}

export function setCachedDomainSearch<T>(
  topic: string,
  results: T,
  ttlMs = 24 * 60 * 60 * 1000 // 1 day; Phase A queries aren't time-sensitive within a day
) {
  db.prepare(
    "INSERT OR REPLACE INTO domain_search_cache (topic, results, expires_at) VALUES (?, ?, ?)"
  ).run(normalizeTopic(topic), JSON.stringify(results), Date.now() + ttlMs);
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
    .all(userId, limit) as unknown as HistoryItem[];
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
    .all(cutoff, limit) as unknown as TrendingItem[];
}

// ---------- Generation jobs ----------

export type JobStatus = "pending" | "searching" | "generating" | "done" | "error" | "cancelled";

export interface JobEvent {
  type: string;
  message: string;
  ts: number;
  expertsFound?: number;
  quotesFound?: number;
}

export interface GenerationJob {
  id: string;
  user_id: string | null;
  topic: string;
  status: JobStatus;
  progress_message: string | null;
  events: JobEvent[];
  result_topic: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

const ACTIVE_STATUSES: JobStatus[] = ["pending", "searching", "generating"];
const STUCK_TIMEOUT_MS = 5 * 60 * 1000; // mark as error if no updates for 5 min
const MAX_ACTIVE_PER_USER = 1;

/** Soft-expire jobs that haven't been updated in a while (server restart, crash, etc.) */
function expireStuckJobs(userId: string | null) {
  const cutoff = Date.now() - STUCK_TIMEOUT_MS;
  if (userId) {
    db.prepare(
      `UPDATE generation_jobs SET status = 'error', error = 'timeout (no progress updates)', updated_at = ?
       WHERE user_id = ? AND status IN ('pending','searching','generating') AND updated_at < ?`
    ).run(Date.now(), userId, cutoff);
  } else {
    db.prepare(
      `UPDATE generation_jobs SET status = 'error', error = 'timeout (no progress updates)', updated_at = ?
       WHERE user_id IS NULL AND status IN ('pending','searching','generating') AND updated_at < ?`
    ).run(Date.now(), cutoff);
  }
}

export function countActiveJobs(userId: string | null): number {
  expireStuckJobs(userId);
  const placeholders = ACTIVE_STATUSES.map(() => "?").join(",");
  const row = userId
    ? db
        .prepare(
          `SELECT COUNT(*) as cnt FROM generation_jobs WHERE user_id = ? AND status IN (${placeholders})`
        )
        .get(userId, ...ACTIVE_STATUSES)
    : db
        .prepare(
          `SELECT COUNT(*) as cnt FROM generation_jobs WHERE user_id IS NULL AND status IN (${placeholders})`
        )
        .get(...ACTIVE_STATUSES);
  return (row as { cnt: number }).cnt;
}

export function getActiveJobLimit(): number {
  return MAX_ACTIVE_PER_USER;
}

/** Look up an existing active/recent job for a (user, topic) pair — avoids duplicates. */
export function findReusableJob(userId: string | null, topic: string): GenerationJob | null {
  const t = normalizeTopic(topic);
  // Prefer an active job; otherwise a recent done job (within 10 min) can be reused
  const recentCutoff = Date.now() - 10 * 60 * 1000;
  const row = userId
    ? db
        .prepare(
          `SELECT * FROM generation_jobs
           WHERE user_id = ? AND topic = ? AND (status IN ('pending','searching','generating') OR (status = 'done' AND updated_at > ?))
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(userId, t, recentCutoff)
    : db
        .prepare(
          `SELECT * FROM generation_jobs
           WHERE user_id IS NULL AND topic = ? AND (status IN ('pending','searching','generating') OR (status = 'done' AND updated_at > ?))
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(t, recentCutoff);
  return row ? hydrateJob(row as RawJob) : null;
}

type RawJob = Omit<GenerationJob, "events"> & { events: string | null };

function hydrateJob(raw: RawJob): GenerationJob {
  let events: JobEvent[] = [];
  try {
    events = raw.events ? JSON.parse(raw.events) : [];
  } catch {
    events = [];
  }
  return { ...raw, events };
}

export function createJob(userId: string | null, topic: string): GenerationJob {
  const id = crypto.randomUUID();
  const now = Date.now();
  const t = normalizeTopic(topic);
  db.prepare(
    `INSERT INTO generation_jobs (id, user_id, topic, status, progress_message, events, result_topic, error, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, '[]', NULL, NULL, ?, ?)`
  ).run(id, userId, t, "任务已创建，等待执行...", now, now);
  return getJob(id)!;
}

export function getJob(id: string): GenerationJob | null {
  const row = db.prepare("SELECT * FROM generation_jobs WHERE id = ?").get(id) as RawJob | undefined;
  return row ? hydrateJob(row) : null;
}

export function listUserJobs(
  userId: string | null,
  options: { limit?: number; onlyActive?: boolean } = {}
): GenerationJob[] {
  expireStuckJobs(userId);
  const { limit = 20, onlyActive = false } = options;
  const statusFilter = onlyActive
    ? `AND status IN ('${ACTIVE_STATUSES.join("','")}')`
    : "";
  const rows = userId
    ? db
        .prepare(
          `SELECT * FROM generation_jobs WHERE user_id = ? ${statusFilter} ORDER BY created_at DESC LIMIT ?`
        )
        .all(userId, limit)
    : db
        .prepare(
          `SELECT * FROM generation_jobs WHERE user_id IS NULL ${statusFilter} ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit);
  return (rows as RawJob[]).map(hydrateJob);
}

export function updateJob(
  id: string,
  patch: Partial<Pick<GenerationJob, "status" | "progress_message" | "result_topic" | "error">>
) {
  const now = Date.now();
  const fields: string[] = ["updated_at = ?"];
  const values: (string | number | null)[] = [now];
  if (patch.status !== undefined) {
    fields.push("status = ?");
    values.push(patch.status);
  }
  if (patch.progress_message !== undefined) {
    fields.push("progress_message = ?");
    values.push(patch.progress_message);
  }
  if (patch.result_topic !== undefined) {
    fields.push("result_topic = ?");
    values.push(patch.result_topic);
  }
  if (patch.error !== undefined) {
    fields.push("error = ?");
    values.push(patch.error);
  }
  values.push(id);
  db.prepare(`UPDATE generation_jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function appendJobEvent(id: string, event: Omit<JobEvent, "ts">) {
  const job = getJob(id);
  if (!job) return;
  const events = [...job.events, { ...event, ts: Date.now() }];
  db.prepare("UPDATE generation_jobs SET events = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(events),
    Date.now(),
    id
  );
}

export function cancelJob(id: string) {
  updateJob(id, { status: "cancelled", error: "用户取消" });
}

// Node 22+ has crypto as a global, but some env might need import
import crypto from "crypto";

