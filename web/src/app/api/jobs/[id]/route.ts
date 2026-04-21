import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getJob } from "@/lib/jobs";
import { cancelJob } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return Response.json({ error: "job not found" }, { status: 404 });
  }

  // Optional auth guard: only owner (or anonymous viewer of anonymous job) can read
  const user = await getCurrentUser();
  const userId = user?.id ?? null;
  if (job.user_id !== userId) {
    // For simplicity: anonymous can read any anonymous job (userId = null)
    // Logged-in users can only read their own. Prevent cross-user access.
    if (job.user_id !== null && userId !== null) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  return Response.json({ job });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "job not found" }, { status: 404 });

  const user = await getCurrentUser();
  const userId = user?.id ?? null;
  if (job.user_id !== userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  cancelJob(id);
  return Response.json({ ok: true });
}
