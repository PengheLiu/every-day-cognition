import { cookies } from "next/headers";
import { deleteSession, SESSION_COOKIE, clearSessionCookie } from "@/lib/auth";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) deleteSession(token);
  await clearSessionCookie();
  return Response.json({ ok: true });
}
