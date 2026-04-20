/**
 * Briefing bundle cache endpoint.
 * GET  ?topic=X  → { bundle } or { bundle: null } (cache miss)
 * POST { topic, bundle } → saves the bundle to cache for 1 day
 *
 * The bundle is the complete {briefing, experts, quotes, heroImageUrl?, dimensionImages?}
 * object so that clients can skip the full search+generation flow when cached.
 */
import { NextRequest } from "next/server";
import { getCachedBriefing, setCachedBriefing, recordSearch } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const topic = req.nextUrl.searchParams.get("topic");
  if (!topic) return Response.json({ error: "topic required" }, { status: 400 });

  const cached = getCachedBriefing(topic);
  return Response.json({ bundle: cached ?? null });
}

export async function POST(req: NextRequest) {
  const { topic, bundle } = await req.json();
  if (!topic || !bundle) {
    return Response.json({ error: "topic and bundle required" }, { status: 400 });
  }

  setCachedBriefing(topic, bundle);

  // Also record this as a search event for history + trending stats
  const user = await getCurrentUser();
  recordSearch(user?.id ?? null, topic);

  return Response.json({ ok: true });
}
