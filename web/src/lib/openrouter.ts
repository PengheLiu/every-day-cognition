/**
 * LLM client — OpenAI-compatible API (OpenRouter / MT AIGC).
 * Includes automatic retry with exponential backoff for transient failures
 * (fetch failed, 5xx, 429 rate limit, timeout).
 */

const LLM_API_KEY = process.env.LLM_API_KEY!;
const LLM_BASE_URL = process.env.LLM_API_BASE_URL || "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = process.env.LLM_MODEL || "anthropic/claude-sonnet-4.5";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const REQUEST_TIMEOUT_MS = 120_000; // 2 min for long briefing generation

/** Whether an error / status code is worth retrying. */
function isTransient(err: unknown, status?: number): boolean {
  if (status && (status === 408 || status === 429 || status >= 500)) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("fetch failed") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("enotfound") ||
      msg.includes("timeout") ||
      msg.includes("abort") ||
      msg.includes("socket hang up")
    );
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Perform a fetch with retry. Only retries on transient errors. */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label = "LLM"
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok && isTransient(null, res.status) && attempt < MAX_RETRIES) {
          const body = await res.text().catch(() => "");
          console.warn(
            `[${label}] HTTP ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying: ${body.slice(0, 120)}`
          );
          await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
          continue;
        }
        return res;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES && isTransient(err)) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[${label}] fetch failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retry in ${backoff}ms:`,
          err instanceof Error ? err.message : err
        );
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error(`${label}: all retries exhausted`);
}

/**
 * Call LLM chat completion (non-streaming).
 * Returns the full text response.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string> {
  const {
    model = DEFAULT_MODEL,
    temperature = 0.7,
    maxTokens = 4096,
  } = options;

  const res = await fetchWithRetry(
    `${LLM_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
    },
    "chatCompletion"
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Call LLM chat completion with streaming.
 * Initial request is retried on transient failures; mid-stream disconnects
 * are propagated (we can't safely resume a stream).
 */
export async function chatCompletionStream(
  messages: ChatMessage[],
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<ReadableStream<string>> {
  const {
    model = DEFAULT_MODEL,
    temperature = 0.7,
    maxTokens = 8192,
  } = options;

  const res = await fetchWithRetry(
    `${LLM_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
    },
    "chatCompletionStream"
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<string>({
    async pull(controller) {
      while (true) {
        let readResult;
        try {
          readResult = await reader.read();
        } catch (err) {
          console.error("[chatCompletionStream] reader error:", err);
          controller.error(err);
          return;
        }
        const { done, value } = readResult;
        if (done) {
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6).trim();
          if (data === "[DONE]") {
            controller.close();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              controller.enqueue(delta);
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    },
  });
}
