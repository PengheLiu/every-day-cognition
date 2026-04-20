/**
 * Backfill a single missing dimension.
 * Used when the main briefing generation truncates before all 7 dimensions finish.
 */
import { NextRequest } from "next/server";
import { chatCompletion } from "@/lib/openrouter";
import { buildSingleDimensionPrompt } from "@/lib/prompts";
import { parseResilientJSON } from "@/lib/json-repair";
import type { DimensionContent, ExpertQuote } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { topic, dimensionKey, dimensionLabel, oneLiner, quotes } = (await req.json()) as {
    topic: string;
    dimensionKey: string;
    dimensionLabel: string;
    oneLiner: string;
    quotes: (ExpertQuote & { dimension: string })[];
  };

  if (!topic || !dimensionKey) {
    return Response.json({ error: "topic and dimensionKey required" }, { status: 400 });
  }

  const prompt = buildSingleDimensionPrompt(
    topic,
    dimensionKey,
    dimensionLabel,
    oneLiner || "",
    quotes || []
  );

  try {
    const resp = await chatCompletion([{ role: "user", content: prompt }], {
      temperature: 0.3,
      maxTokens: 4000,
    });

    const parsed = parseResilientJSON(resp) as Partial<DimensionContent>;
    const dimension: DimensionContent = {
      key: (parsed.key || dimensionKey) as DimensionContent["key"],
      summary: parsed.summary || "",
      detail: parsed.detail || "",
      expertQuotes: parsed.expertQuotes || [],
    };

    return Response.json({ dimension });
  } catch (err) {
    console.error("Dimension backfill error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
