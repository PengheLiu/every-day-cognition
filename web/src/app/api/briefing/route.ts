import { NextRequest } from "next/server";
import { chatCompletionStream } from "@/lib/openrouter";
import { buildBriefingPrompt } from "@/lib/prompts";
import type { ExpertInfo, ExpertQuote } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { topic, experts, quotes } = (await req.json()) as {
    topic: string;
    experts: ExpertInfo[];
    quotes: (ExpertQuote & { dimension: string })[];
  };

  if (!topic) {
    return Response.json({ error: "topic is required" }, { status: 400 });
  }

  // Group quotes by expert
  const expertQuoteMap = new Map<string, typeof quotes>();
  for (const q of quotes) {
    const existing = expertQuoteMap.get(q.personName) || [];
    existing.push(q);
    expertQuoteMap.set(q.personName, existing);
  }

  const expertsWithQuotes = experts.map((expert) => ({
    expert: { name: expert.name, title: expert.title, org: expert.org },
    quotes: (expertQuoteMap.get(expert.name) || []).map((q) => ({
      quote: q.quote,
      sourceType: q.sourceType,
      sourceUrl: q.sourceUrl,
      sourceDate: q.sourceDate,
      dimension: q.dimension,
      aiInterpretation: q.aiInterpretation,
    })),
  }));

  const prompt = buildBriefingPrompt(topic, expertsWithQuotes);

  try {
    const llmStream = await chatCompletionStream(
      [{ role: "user", content: prompt }],
      { temperature: 0.4, maxTokens: 64000 }
    );

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = llmStream.getReader();
        let totalBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.length;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: value })}\n\n`));
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true, bytes: totalBytes })}\n\n`)
          );
        } catch (err) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
