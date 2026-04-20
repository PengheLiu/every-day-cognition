import { getTrendingTopics } from "@/lib/db";

export async function GET() {
  const items = getTrendingTopics(10);
  return Response.json({ items });
}
