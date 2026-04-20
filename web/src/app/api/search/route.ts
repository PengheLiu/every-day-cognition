import { NextRequest } from "next/server";
import { chatCompletion } from "@/lib/openrouter";
import { multiSearch, fridaySearch } from "@/lib/search";
import {
  buildDomainSearchQueries,
  buildExpertExtractionPrompt,
  buildSearchQueries,
  buildQuoteExtractionPrompt,
} from "@/lib/prompts";
import { parseResilientJSON } from "@/lib/json-repair";
import type { ExpertInfo, ExpertQuote, SearchProgressEvent } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { topic } = await req.json();

  if (!topic || typeof topic !== "string") {
    return Response.json({ error: "topic is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SearchProgressEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        // ----- Phase A: Ground expert list in real search results -----
        send({
          type: "identifying_experts",
          message: `正在搜索「${topic}」领域的真实资料...`,
        });

        const domainQueries = buildDomainSearchQueries(topic);
        const domainResults = await multiSearch(domainQueries, { topK: 5 });

        if (domainResults.length === 0) {
          send({ type: "done", message: "未能搜索到相关领域资料" });
          controller.close();
          return;
        }

        send({
          type: "identifying_experts",
          message: `从 ${domainResults.length} 条真实资料中提取候选专家...`,
        });

        const extractionPrompt = buildExpertExtractionPrompt(
          topic,
          domainResults.slice(0, 30).map((r) => ({
            title: r.title,
            snippet: r.snippet,
            content: r.content?.slice(0, 1200) || "",
            url: r.url,
            publishTime: r.publishTime,
          }))
        );

        const candidateJson = await chatCompletion(
          [{ role: "user", content: extractionPrompt }],
          { temperature: 0.2, maxTokens: 3000 }
        );

        let candidates: (ExpertInfo & { evidenceQuote?: string })[] = [];
        try {
          const parsed = parseResilientJSON(candidateJson);
          if (Array.isArray(parsed)) candidates = parsed as typeof candidates;
        } catch (err) {
          console.error("Failed to parse candidates:", err);
          console.error("Raw (first 300):", candidateJson.slice(0, 300));
        }

        if (candidates.length === 0) {
          send({
            type: "done",
            message: "未能从真实资料中提取到专家",
            result: { experts: [], quotes: [] },
          } as SearchProgressEvent & { result: unknown });
          controller.close();
          return;
        }

        send({
          type: "identifying_experts",
          message: `提取到 ${candidates.length} 位候选专家，正在验证身份...`,
        });

        // ----- Phase B: Verify each candidate independently -----
        // Use concurrency limit to avoid overloading Friday search API.
        const verifiedExperts: ExpertInfo[] = [];
        const PHASE_B_CONCURRENCY = 8;

        const verifyOne = async (cand: typeof candidates[number]) => {
          if (!cand.name || cand.name.length < 2 || cand.name.length > 30) return;

          // Single verification query: name + (org or topic) — reduces API load
          const q =
            cand.org && cand.org !== "未知"
              ? `${cand.name} ${cand.org}`
              : `${cand.name} ${topic}`;

          const merged = await fridaySearch(q, { topK: 3 });
          const relevantCount = merged.filter((r) => {
            const text = `${r.title} ${r.snippet} ${r.content}`.toLowerCase();
            const nameLower = cand.name.toLowerCase();
            const topicLower = topic.toLowerCase();
            const mentionsName = text.includes(nameLower) ||
              (cand.englishName && text.includes(cand.englishName.toLowerCase()));
            const mentionsContext = text.includes(topicLower) ||
              (cand.org && cand.org !== "未知" && text.includes(cand.org.toLowerCase()));
            return mentionsName && mentionsContext;
          }).length;

          if (relevantCount >= 1) {
            verifiedExperts.push({
              name: cand.name,
              englishName: cand.englishName || undefined,
              title: cand.title || "",
              org: cand.org || "",
              reason: cand.reason || "",
            });
          } else {
            console.log(`[verify] rejected ${cand.name} (${relevantCount} relevant results)`);
          }
        };

        const verifyQueue = [...candidates];
        const verifyWorkers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(PHASE_B_CONCURRENCY, verifyQueue.length); i++) {
          verifyWorkers.push(
            (async () => {
              while (verifyQueue.length > 0) {
                const cand = verifyQueue.shift();
                if (!cand) break;
                await verifyOne(cand);
              }
            })()
          );
        }
        await Promise.all(verifyWorkers);

        if (verifiedExperts.length === 0) {
          send({
            type: "done",
            message: "候选专家均未通过身份验证",
            result: { experts: [], quotes: [] },
          } as SearchProgressEvent & { result: unknown });
          controller.close();
          return;
        }

        send({
          type: "identifying_experts",
          message: `验证通过 ${verifiedExperts.length} 位真实专家`,
        });

        // Notify each verified expert discovered
        for (const expert of verifiedExperts) {
          send({
            type: "searching_expert",
            message: `已确认: ${expert.name}`,
            expert,
          });
        }

        // ----- Phase C: For each verified expert, extract their quotes -----
        // Use a concurrency limit to avoid hitting OpenRouter rate limits when
        // extracting quotes for 10+ experts in parallel.
        const allQuotes: (ExpertQuote & { dimension: string })[] = [];
        const CONCURRENCY = 8;

        const processExpert = async (expert: ExpertInfo) => {
          send({
            type: "searching_expert",
            message: `正在搜索 ${expert.name} 的观点...`,
            expert,
          });

          // Strategy 1: Filter already-fetched Phase A results by expert name
          // (avoids hammering Friday API again after Phase A+B)
          const nameLower = expert.name.toLowerCase();
          const engLower = expert.englishName?.toLowerCase() || "";
          const filteredFromDomain = domainResults.filter((r) => {
            const text = `${r.title} ${r.snippet} ${r.content}`.toLowerCase();
            return (
              text.includes(nameLower) ||
              (engLower && text.includes(engLower))
            );
          });

          // Strategy 2: Do a focused search for this expert if we have <3 from Phase A
          let searchResults = filteredFromDomain;
          if (filteredFromDomain.length < 3) {
            const queries = buildSearchQueries(topic, expert.name, expert.englishName);
            const extra = await multiSearch(queries, { topK: 5 });
            // Dedupe by URL
            const seen = new Set(filteredFromDomain.map((r) => r.url));
            for (const r of extra) {
              if (!seen.has(r.url)) {
                seen.add(r.url);
                filteredFromDomain.push(r);
              }
            }
            searchResults = filteredFromDomain;
          }
          console.log(
            `[phase-c] ${expert.name}: ${searchResults.length} results (${filteredFromDomain.length} from reuse)`
          );

          if (searchResults.length === 0) return;

          send({
            type: "extracting_quotes",
            message: `正在分析 ${expert.name} 的观点...`,
            expert,
          });

          let quotesJson = "";
          try {
            quotesJson = await chatCompletion(
              [
                {
                  role: "user",
                  content: buildQuoteExtractionPrompt(
                    topic,
                    expert.name,
                    `${expert.title}, ${expert.org}`,
                    searchResults.map((r) => ({
                      title: r.title,
                      snippet: r.snippet,
                      content: r.content?.slice(0, 1500) || "",
                      url: r.url,
                      publishTime: r.publishTime,
                    }))
                  ),
                },
              ],
              { temperature: 0.2, maxTokens: 2048 }
            );
          } catch (err) {
            console.error(`[quote-extract] LLM call failed for ${expert.name}:`, err);
            return;
          }

          try {
            const quotes = parseResilientJSON(quotesJson);
            if (!Array.isArray(quotes)) {
              console.log(`[quote-extract] ${expert.name}: not an array, raw=${quotesJson.slice(0, 150)}`);
              return;
            }
            for (const q of quotes as Record<string, string>[]) {
              if (!q.quote) continue;
              allQuotes.push({
                personName: expert.name,
                personTitle: `${expert.title}${expert.org ? ", " + expert.org : ""}`,
                quote: q.quote,
                sourceType: q.sourceType || "公开资料",
                sourceUrl: q.sourceUrl,
                sourceDate: q.sourceDate,
                aiInterpretation: q.aiInterpretation,
                dimension: q.dimension || "concept",
              });
            }
            send({
              type: "searching_expert",
              message: `找到 ${expert.name} 的 ${quotes.length} 条观点`,
              expert,
              quotesFound: quotes.length,
            });
          } catch (err) {
            console.error(`[quote-extract] parse failed for ${expert.name}:`, err);
          }
        };

        // Run with concurrency limit
        const queue = [...verifiedExperts];
        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
          workers.push(
            (async () => {
              while (queue.length > 0) {
                const expert = queue.shift();
                if (!expert) break;
                await processExpert(expert);
              }
            })()
          );
        }
        await Promise.all(workers);

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "done",
              message: "搜索完成",
              result: { experts: verifiedExperts, quotes: allQuotes },
            })}\n\n`
          )
        );
      } catch (err) {
        console.error("Search error:", err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "done", message: "搜索出错", error: String(err) })}\n\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
