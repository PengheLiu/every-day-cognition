import { NextRequest } from "next/server";
import { generateImage, buildHeroImagePrompt, buildDimensionImagePrompt } from "@/lib/image-gen";
import { getCachedImage, setCachedImage, imageCacheKey } from "@/lib/db";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { kind, topic, dimensionLabel, summary } = body as {
    kind: "hero" | "dimension";
    topic: string;
    dimensionLabel?: string;
    summary?: string;
  };

  if (!topic) {
    return Response.json({ error: "topic required" }, { status: 400 });
  }

  const key = imageCacheKey(
    kind === "dimension" ? "dimension" : "hero",
    topic,
    kind === "dimension" ? dimensionLabel : undefined
  );

  // Serve persisted illustration if we have one — avoids regenerating on
  // every page refresh. Images are deterministic per (topic, dimension).
  const cached = getCachedImage(key);
  if (cached) {
    return Response.json({ imageUrl: cached, cached: true });
  }

  let prompt: string;
  if (kind === "dimension" && dimensionLabel && summary) {
    prompt = buildDimensionImagePrompt(topic, dimensionLabel, summary);
  } else {
    prompt = buildHeroImagePrompt(topic);
  }

  const imageUrl = await generateImage(prompt);

  if (!imageUrl) {
    return Response.json({ error: "image generation failed" }, { status: 500 });
  }

  try {
    setCachedImage(key, imageUrl);
  } catch (err) {
    console.warn("[image] failed to cache image:", err);
  }

  return Response.json({ imageUrl });
}
