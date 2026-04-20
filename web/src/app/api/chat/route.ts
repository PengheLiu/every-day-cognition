import { NextRequest } from "next/server";
import { chatCompletionStream } from "@/lib/openrouter";
import { buildChatSystemPrompt } from "@/lib/prompts";
import type { ChatMessage } from "@/lib/types";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { topic, briefingSummary, messages } = (await req.json()) as {
    topic: string;
    briefingSummary: string;
    messages: ChatMessage[];
  };

  if (!topic || !messages?.length) {
    return Response.json({ error: "topic and messages required" }, { status: 400 });
  }

  const systemPrompt = buildChatSystemPrompt(topic, briefingSummary);

  const llmMessages = [
    { role: "system" as const, content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  try {
    const llmStream = await chatCompletionStream(llmMessages, {
      temperature: 0.6,
      maxTokens: 2048,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = llmStream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: value })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
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
