/**
 * Image generation via OpenRouter (Gemini 2.5 Flash Image).
 * Returns base64 data URL suitable for <img src>.
 */

const LLM_API_KEY = process.env.LLM_API_KEY!;
const LLM_BASE_URL = process.env.LLM_API_BASE_URL || "https://openrouter.ai/api/v1";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "google/gemini-2.5-flash-image";

/** Generate a single image with retry. Returns a data URL or null on failure. */
export async function generateImage(prompt: string): Promise<string | null> {
  const MAX_RETRIES = 2;
  const TIMEOUT_MS = 30000; // 30s per attempt

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LLM_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(
          `[image-gen] HTTP ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${body.slice(0, 100)}`
        );
        if (attempt < MAX_RETRIES && (res.status === 429 || res.status >= 500)) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return null;
      }

      const data = await res.json();
      const images = data.choices?.[0]?.message?.images;
      const url = images?.[0]?.image_url?.url;
      if (typeof url === "string") return url;

      console.warn(`[image-gen] No image in response (attempt ${attempt + 1})`);
      if (attempt < MAX_RETRIES) continue;
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[image-gen] fetch failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${msg}`
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}

/** Mapping of Chinese dimension labels to English for image prompts (prevents Chinese font rendering issues). */
const DIMENSION_EN_MAP: Record<string, string> = {
  "概念定义": "Concept",
  "原理机制": "Mechanism",
  "历史脉络": "History",
  "生态格局": "Ecosystem",
  "实践应用": "Application",
  "趋势展望": "Trends",
  "争议边界": "Controversy",
};

/**
 * Build a polished image prompt for a topic hero illustration.
 * NOTE: Gemini renders English well but Chinese as garbled glyphs —
 * so all text in the image MUST be English.
 */
export function buildHeroImagePrompt(topic: string): string {
  return [
    `Create a modern flat-style vector infographic illustration that visually explains the concept of "${topic}" (first translate this topic into accurate English in your head, then use that English translation in the image).`,
    `The illustration should include 3-5 clear visual elements with short English text labels (1-3 words per label) to help viewers understand the concept at a glance.`,
    `Use icons, shapes, arrows, and diagrams to show relationships between ideas.`,
    `Color palette: deep blue (#4A6CF7) and warm orange (#FF8C42) on a soft warm gray background.`,
    `Style: clean geometric shapes, editorial infographic, professional, refined, high-end.`,
    `STRICT LANGUAGE RULES — MUST FOLLOW:`,
    `- ALL text in the image MUST be in English only.`,
    `- ABSOLUTELY NO Chinese characters, NO Japanese, NO Korean, NO non-Latin scripts — they will render as garbled glyphs.`,
    `- Keep text labels short (1-3 English words), large enough to read, with clean sans-serif font.`,
    `- Double-check every glyph in the image is a valid English letter or Arabic numeral.`,
    `Wide landscape aspect ratio (16:9), suitable as a hero banner.`,
  ].join(" ");
}

/**
 * Build a smaller illustration prompt for a specific dimension.
 */
export function buildDimensionImagePrompt(topic: string, dimensionLabel: string, summary: string): string {
  const enLabel = DIMENSION_EN_MAP[dimensionLabel] || dimensionLabel;
  const briefSummary = summary.slice(0, 150);

  return [
    `Create a flat-style vector infographic illustration showing the "${enLabel}" aspect of "${topic}" (translate the topic to English first, then use that English translation).`,
    `Include 2-4 key visual elements with short English text labels (1-3 words each) to make the concept clear.`,
    `Context to illustrate (translate to English first): ${briefSummary}`,
    `Color palette: deep blue (#4A6CF7) and warm orange (#FF8C42) on a soft warm gray background.`,
    `Style: clean geometric shapes, editorial infographic style, simple and clear.`,
    `STRICT LANGUAGE RULES — MUST FOLLOW:`,
    `- ALL text in the image MUST be in English only.`,
    `- ABSOLUTELY NO Chinese characters, NO Japanese, NO Korean, NO non-Latin scripts — they render as garbled glyphs.`,
    `- Keep English labels short (1-3 words), large enough to read, with clean sans-serif font.`,
    `- Double-check every glyph in the image is a valid English letter or Arabic numeral.`,
    `Square aspect ratio (1:1).`,
  ].join(" ");
}
