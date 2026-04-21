import { NextRequest } from "next/server";
import { chatCompletion, FAST_MODEL } from "@/lib/openrouter";
import { multiSearch, findScholarProfileUrl } from "@/lib/search";
import {
  buildExpertDetailQueries,
  buildExpertDetailPrompt,
} from "@/lib/prompts";
import { parseResilientJSON } from "@/lib/json-repair";
import { getCachedExpert, setCachedExpert } from "@/lib/db";
import type { ExpertDetail } from "@/lib/types";

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

  // Cache check (1 day)
  const cached = getCachedExpert(name, topic);
  if (cached) {
    return Response.json(cached);
  }

  try {
    // Run expert detail search and Scholar profile lookup in parallel
    const [searchResults, scholarProfileUrl] = await Promise.all([
      multiSearch(buildExpertDetailQueries(name, englishName, org, topic), { topK: 5 }),
      findScholarProfileUrl(name, englishName, org, englishOrg, topic).catch(() => null),
    ]);

    if (searchResults.length === 0) {
      return Response.json({
        name,
        englishName,
        currentTitle: `${title}${org && org !== "未知" ? ", " + org : ""}`,
        biography: "",
        currentStatus: "",
        companyInfo: "",
        notableWorks: [],
        recentUpdates: [],
        links: [],
        disambiguation: "未搜索到相关公开信息",
      } satisfies ExpertDetail);
    }

    const extractionPrompt = buildExpertDetailPrompt(
      name,
      title,
      org || "未知",
      topic,
      searchResults.map((r) => ({
        title: r.title,
        snippet: r.snippet,
        content: r.content?.slice(0, 1200) || "",
        url: r.url,
        publishTime: r.publishTime,
      }))
    );

    const resp = await chatCompletion(
      [{ role: "user", content: extractionPrompt }],
      { temperature: 0.3, maxTokens: 3000, model: FAST_MODEL }
    );

    let parsed: Partial<ExpertDetail> = {};
    try {
      parsed = parseResilientJSON(resp) as Partial<ExpertDetail>;
    } catch (err) {
      console.error("Expert detail parse error:", err);
      console.error("Raw resp (first 500):", resp.slice(0, 500));
    }

    const detail: ExpertDetail = {
      name: parsed.name || name,
      englishName: englishName,
      currentTitle:
        parsed.currentTitle ||
        `${title}${org && org !== "未知" ? ", " + org : ""}`,
      biography: parsed.biography || "",
      currentStatus: parsed.currentStatus || "",
      companyInfo: parsed.companyInfo || "",
      notableWorks: parsed.notableWorks || [],
      recentUpdates: parsed.recentUpdates || [],
      links: parsed.links || [],
      disambiguation: parsed.disambiguation || "",
      scholarProfileUrl: scholarProfileUrl || undefined,
    };

    // Only cache successful extractions (not disambiguation misses or empties)
    if (detail.biography || detail.currentStatus) {
      setCachedExpert(name, topic, detail);
    }

    return Response.json(detail);
  } catch (err) {
    console.error("Expert API error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
