import { getCurrentUser } from "@/lib/auth";
import { getUserHistory } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ items: [] });
  const items = getUserHistory(user.id, 50);
  return Response.json({ items });
}
