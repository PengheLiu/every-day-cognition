import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  enqueueBriefingJob,
  listUserJobSummaries,
} from "@/lib/jobs";
import { getActiveJobLimit } from "@/lib/db";

/**
 * POST /api/jobs
 * Body: { topic: string }
 * Creates a new briefing-generation job (or returns an existing one for the
 * same topic, or signals that the briefing is already cached).
 *
 * Responses:
 *   200 { kind: "cached", topic } — briefing already in cache; client may jump
 *       straight to /briefing?topic=X
 *   200 { kind: "job", job, reused } — job created (or reused existing)
 *   429 { error: "LIMIT_EXCEEDED", message, limit } — user has >= 5 active jobs
 *   400 { error } — bad input
 */
export async function POST(req: NextRequest) {
  const { topic } = (await req.json()) as { topic?: string };
  if (!topic || typeof topic !== "string") {
    return Response.json({ error: "topic required" }, { status: 400 });
  }
  const user = await getCurrentUser();
  const userId = user?.id ?? null;

  try {
    const result = enqueueBriefingJob(userId, topic);
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("LIMIT_EXCEEDED:")) {
      return Response.json(
        {
          error: "LIMIT_EXCEEDED",
          message: msg.replace(/^LIMIT_EXCEEDED:/, ""),
          limit: getActiveJobLimit(),
        },
        { status: 429 }
      );
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/jobs?active=true|false&limit=N
 * Lists current user's jobs.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const userId = user?.id ?? null;
  const onlyActive = req.nextUrl.searchParams.get("active") === "true";
  const limitStr = req.nextUrl.searchParams.get("limit");
  const limit = limitStr ? Math.min(100, parseInt(limitStr, 10) || 20) : 20;

  const jobs = listUserJobSummaries(userId, { limit, onlyActive });
  return Response.json({ jobs, limit: getActiveJobLimit() });
}
