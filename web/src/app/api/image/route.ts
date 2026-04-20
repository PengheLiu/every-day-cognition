import { NextRequest } from "next/server";
import { generateImage, buildHeroImagePrompt, buildDimensionImagePrompt } from "@/lib/image-gen";

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

  return Response.json({ imageUrl });
}
