/**
 * Authentication helpers — phone + code login, session via HTTP-only cookie.
 * In dev mode, any phone accepts the fixed code "123456".
 */
import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "./db";

const SESSION_COOKIE = "ca_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CODE_TTL_MS = 10 * 60 * 1000; // 10 min
const DEV_FIXED_CODE = "123456";

export interface User {
  id: string;
  phone: string;
  createdAt: number;
}

/** Generate a new verify code for a phone (dev: always "123456"). */
export function issueVerifyCode(phone: string): string {
  const code = DEV_FIXED_CODE;
  db.prepare(
    "INSERT OR REPLACE INTO verify_codes (phone, code, expires_at) VALUES (?, ?, ?)"
  ).run(phone, code, Date.now() + CODE_TTL_MS);
  return code;
}

/** Verify a code and return true if valid. Deletes the code on success. */
export function verifyCode(phone: string, code: string): boolean {
  const row = db
    .prepare("SELECT code, expires_at FROM verify_codes WHERE phone = ?")
    .get(phone) as { code: string; expires_at: number } | undefined;
  if (!row) return false;
  if (row.expires_at < Date.now()) return false;
  if (row.code !== code) return false;
  // Invalidate on use
  db.prepare("DELETE FROM verify_codes WHERE phone = ?").run(phone);
  return true;
}

/** Find user by phone or create a new one. */
export function findOrCreateUser(phone: string): User {
  const existing = db
    .prepare("SELECT id, phone, created_at as createdAt FROM users WHERE phone = ?")
    .get(phone) as User | undefined;
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare("INSERT INTO users (id, phone, created_at) VALUES (?, ?, ?)").run(id, phone, now);
  return { id, phone, createdAt: now };
}

/** Create a session and return the token. */
export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(token, userId, Date.now() + SESSION_TTL_MS);
  return token;
}

export function deleteSession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function getUserByToken(token: string): User | null {
  const row = db
    .prepare(
      `SELECT u.id, u.phone, u.created_at as createdAt, s.expires_at as sessionExpires
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as (User & { sessionExpires: number }) | undefined;
  if (!row) return null;
  if (row.sessionExpires < Date.now()) {
    deleteSession(token);
    return null;
  }
  return { id: row.id, phone: row.phone, createdAt: row.createdAt };
}

/** Read current user from the request cookie. */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserByToken(token);
}

/** Set session cookie on response. */
export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    path: "/",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** Basic phone validation (Chinese mobile) */
export function isValidChinesePhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

export { SESSION_COOKIE };
