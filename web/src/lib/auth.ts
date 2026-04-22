/**
 * Authentication helpers — nickname + phone login (no SMS / verification),
 * session via HTTP-only cookie. The phone is the unique account key; the
 * nickname is the display name shown in the top bar.
 */
import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "./db";

const SESSION_COOKIE = "ca_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface User {
  id: string;
  phone: string;
  nickname: string | null;
  createdAt: number;
}

/**
 * Find user by phone; if they exist, update their nickname to the one they
 * just submitted (so returning users can change their display name). If not,
 * create a new row with the provided nickname.
 */
export function findOrCreateUser(phone: string, nickname: string): User {
  const trimmed = nickname.trim();
  const now = Date.now();

  const existing = db
    .prepare(
      "SELECT id, phone, nickname, created_at as createdAt FROM users WHERE phone = ?"
    )
    .get(phone) as User | undefined;

  if (existing) {
    if (trimmed && trimmed !== existing.nickname) {
      db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(trimmed, existing.id);
      return { ...existing, nickname: trimmed };
    }
    return existing;
  }

  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO users (id, phone, nickname, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, phone, trimmed || null, now);
  return { id, phone, nickname: trimmed || null, createdAt: now };
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
      `SELECT u.id, u.phone, u.nickname, u.created_at as createdAt,
              s.expires_at as sessionExpires
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as (User & { sessionExpires: number }) | undefined;
  if (!row) return null;
  if (row.sessionExpires < Date.now()) {
    deleteSession(token);
    return null;
  }
  return {
    id: row.id,
    phone: row.phone,
    nickname: row.nickname,
    createdAt: row.createdAt,
  };
}

/** Read current user from the request cookie. */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserByToken(token);
}

/**
 * Decide whether to mark the session cookie `secure`.
 *
 * `secure: true` means the browser will only send the cookie over HTTPS.
 * If the app is deployed on plain HTTP (common in internal / container
 * environments), forcing `secure` silently breaks login — the browser
 * accepts Set-Cookie but never returns the cookie on subsequent requests.
 *
 * Resolution order:
 *   1. Explicit `SECURE_COOKIES` env var wins (true/false)
 *   2. Otherwise, inspect the current request's protocol. If the inbound
 *      request came via HTTPS (direct or via x-forwarded-proto), use secure.
 *   3. Default to NOT secure so HTTP deployments work out of the box.
 */
async function shouldUseSecureCookie(): Promise<boolean> {
  const override = process.env.SECURE_COOKIES?.toLowerCase();
  if (override === "true" || override === "1") return true;
  if (override === "false" || override === "0") return false;

  // Probe current request headers
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const forwardedProto = h.get("x-forwarded-proto");
    if (forwardedProto) return forwardedProto.split(",")[0].trim() === "https";
    // Next.js also exposes the URL via x-forwarded-host; fall through otherwise
  } catch {
    // ignore
  }

  // Default: NOT secure (works for plain HTTP). For HTTPS prod, set SECURE_COOKIES=true.
  return false;
}

/** Set session cookie on response. */
export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await shouldUseSecureCookie(),
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
