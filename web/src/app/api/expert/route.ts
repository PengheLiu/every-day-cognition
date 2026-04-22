import { NextRequest } from "next/server";
import { fetchExpertDetail } from "@/lib/expert-detail";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { name, englishName, title, org, englishOrg, topic } = (await req.json()) as {
    name: string;
    englishName?: string;
    title: string;
    org: string;
    englishOrg?: string;
    topic: string;
  };

  if (!name || !topic) {
    return Response.json({ error: "name and topic required" }, { status: 400 });
  }

  try {
    const detail = await fetchExpertDetail({
      name,
      englishName,
      title,
      org,
      englishOrg,
      topic,
    });
    return Response.json(detail);
  } catch (err) {
    console.error("Expert API error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
