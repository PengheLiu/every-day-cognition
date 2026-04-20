/**
 * Best-effort JSON repair for LLM-generated JSON that may be:
 * - wrapped in markdown fences
 * - prefixed with natural-language prose
 * - truncated (hit max_tokens)
 * - have unescaped inner double quotes inside string values
 *
 * Strategy: scan char-by-char tracking state; when a parse-breaking anomaly
 * appears (e.g. unterminated string, unescaped quote mid-string), truncate
 * to the last safe balance point and close open containers.
 */
export function parseResilientJSON(text: string): unknown {
  // Strip markdown code fences
  let cleaned = text
    .replace(/^[\s\S]*?```json\s*/i, (m) => (m.toLowerCase().includes("```json") ? "" : m))
    .replace(/```\s*$/g, "")
    .trim();

  // If still has leading prose, find first { or [
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  let start = -1;
  if (firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)) {
    start = firstBrace;
  } else if (firstBracket >= 0) {
    start = firstBracket;
  }
  if (start < 0) throw new Error("No JSON object found");
  cleaned = cleaned.slice(start);

  // Attempt 1: Direct parse (happy path)
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through
  }

  // Attempt 2: Repair truncation / open containers
  try {
    const repaired = repairToLastSafePoint(cleaned);
    return JSON.parse(repaired);
  } catch {
    // fall through
  }

  // Attempt 3: Last resort — extract recoverable top-level fields one by one.
  // For objects: walk "key":<value> pairs at depth 0.
  // For arrays: walk each top-level element independently.
  if (cleaned.trimStart().startsWith("[")) {
    const arr = extractTopLevelArrayItems(cleaned);
    if (arr.length > 0) return arr;
  } else {
    const extracted = extractTopLevelFields(cleaned);
    if (extracted) return extracted;
  }

  // Give up — rethrow original parse error
  return JSON.parse(cleaned);
}

/**
 * Extract individual array items from a potentially malformed JSON array.
 * Skips items that can't be parsed.
 */
function extractTopLevelArrayItems(s: string): unknown[] {
  const trimmed = s.trim();
  if (!trimmed.startsWith("[")) return [];
  const body = trimmed.slice(1); // drop opening [
  const items: unknown[] = [];

  let i = 0;
  while (i < body.length) {
    // Skip whitespace and commas
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length) break;
    if (body[i] === "]") break;

    // Parse one item
    const c = body[i];
    if (c === "{" || c === "[") {
      const end = findMatchingClose(body, i);
      if (end < 0) {
        // truncated — try to repair this fragment
        const slice = body.slice(i);
        try {
          const repaired = repairToLastSafePoint(slice);
          const parsed = JSON.parse(repaired);
          items.push(parsed);
        } catch {
          // skip
        }
        break;
      }
      const raw = body.slice(i, end + 1);
      try {
        items.push(JSON.parse(raw));
      } catch {
        // try inner repair
        try {
          const repaired = repairToLastSafePoint(raw);
          items.push(JSON.parse(repaired));
        } catch {
          // try sub-field extraction if it's an object
          if (c === "{") {
            const sub = extractTopLevelFields(raw);
            if (sub) items.push(sub);
          }
        }
      }
      i = end + 1;
    } else if (c === '"') {
      const end = findStringEnd(body, i);
      if (end < 0) break;
      try {
        items.push(JSON.parse(body.slice(i, end + 1)));
      } catch {
        // skip
      }
      i = end + 1;
    } else {
      // primitive
      const m = body.slice(i).match(/^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/);
      if (m) {
        try {
          items.push(JSON.parse(m[0]));
        } catch {
          // skip
        }
        i += m[0].length;
      } else {
        i++;
      }
    }
  }

  return items;
}

/**
 * When the whole object can't be parsed, try to extract individual top-level
 * string/array/object values by scanning for "key": <value> at depth 0.
 * Returns null if nothing could be extracted.
 */
function extractTopLevelFields(s: string): Record<string, unknown> | null {
  // Strip outer { }
  const trimmed = s.trim();
  if (!trimmed.startsWith("{")) return null;

  const body = trimmed.slice(1);
  const out: Record<string, unknown> = {};

  // Iterate, finding "key": at depth 0 of body
  let i = 0;
  while (i < body.length) {
    // Skip whitespace and commas
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length) break;
    if (body[i] === "}") break;

    // Expect a string key
    if (body[i] !== '"') {
      i++;
      continue;
    }
    const keyEnd = findStringEnd(body, i);
    if (keyEnd < 0) break;
    const key = body.slice(i + 1, keyEnd);
    i = keyEnd + 1;

    // Skip whitespace and colon
    while (i < body.length && /[\s:]/.test(body[i])) i++;
    if (i >= body.length) break;

    // Parse value
    const { value, nextIdx } = tryParseValue(body, i);
    if (nextIdx > i) {
      if (value !== undefined) out[key] = value;
      i = nextIdx;
    } else {
      // couldn't parse value — skip to next comma at depth 0
      i = skipToNextFieldBoundary(body, i);
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

function findStringEnd(s: string, start: number): number {
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    if (s[i] === '"') return i;
    i++;
  }
  return -1;
}

function tryParseValue(s: string, start: number): { value: unknown; nextIdx: number } {
  const c = s[start];
  if (c === '"') {
    const end = findStringEnd(s, start);
    if (end < 0) return { value: undefined, nextIdx: start };
    const raw = s.slice(start, end + 1);
    try {
      return { value: JSON.parse(raw), nextIdx: end + 1 };
    } catch {
      return { value: undefined, nextIdx: end + 1 };
    }
  }
  if (c === "{" || c === "[") {
    const end = findMatchingClose(s, start);
    if (end < 0) {
      // try repair on the slice
      const slice = s.slice(start);
      try {
        const repaired = repairToLastSafePoint(slice);
        return { value: JSON.parse(repaired), nextIdx: s.length };
      } catch {
        return { value: undefined, nextIdx: s.length };
      }
    }
    const raw = s.slice(start, end + 1);
    try {
      return { value: JSON.parse(raw), nextIdx: end + 1 };
    } catch {
      // try to repair this sub-value
      try {
        const repaired = repairToLastSafePoint(raw);
        return { value: JSON.parse(repaired), nextIdx: end + 1 };
      } catch {
        return { value: undefined, nextIdx: end + 1 };
      }
    }
  }
  // number / literal
  const m = s.slice(start).match(/^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/);
  if (m) {
    try {
      return { value: JSON.parse(m[0]), nextIdx: start + m[0].length };
    } catch {
      return { value: undefined, nextIdx: start + m[0].length };
    }
  }
  return { value: undefined, nextIdx: start };
}

function findMatchingClose(s: string, start: number): number {
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  const stack: string[] = [close];
  let i = start + 1;
  let inString = false;
  let escape = false;
  while (i < s.length) {
    const c = s[i];
    if (escape) {
      escape = false;
      i++;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") {
      if (stack[stack.length - 1] === c) {
        stack.pop();
        if (stack.length === 0) return i;
      } else {
        return -1;
      }
    }
    i++;
  }
  return -1;
}

function skipToNextFieldBoundary(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (depth === 0) return i;
      depth--;
    } else if (c === "," && depth === 0) {
      return i + 1;
    }
  }
  return s.length;
}

/**
 * Walk the string, tracking valid structural balance. When we hit a state we
 * cannot recover from cleanly, truncate to the last "safe" position where the
 * structure was valid, then close remaining brackets.
 */
function repairToLastSafePoint(s: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  // lastSafe = end index (exclusive) of the last position we know is parse-safe
  // (just after a closed value: string, number, true/false/null, or a closing
  //  bracket). We'll keep updating this as we successfully consume values.
  let lastSafe = 0;
  let lastSafeStack: string[] = [];

  let i = 0;
  while (i < s.length) {
    const c = s[i];

    if (escape) {
      escape = false;
      i++;
      continue;
    }

    if (inString) {
      if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
        // Peek: is the next non-whitespace char a valid continuation?
        // Valid: `,` `}` `]` `:` `<EOF>`
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        const next = j < s.length ? s[j] : "";
        if (next === "," || next === "}" || next === "]" || next === ":" || next === "") {
          // Good — update last-safe
          lastSafe = i + 1;
          lastSafeStack = [...stack];
        }
        // else: suspicious (unescaped inner quote?) — don't update lastSafe,
        // keep scanning; if parse fails at the end we'll fall back to lastSafe.
      }
      i++;
      continue;
    }

    if (c === '"') {
      inString = true;
    } else if (c === "{") {
      stack.push("}");
    } else if (c === "[") {
      stack.push("]");
    } else if (c === "}" || c === "]") {
      if (stack[stack.length - 1] === c) {
        stack.pop();
        lastSafe = i + 1;
        lastSafeStack = [...stack];
      } else {
        // Mismatched close — treat as error, rewind to lastSafe
        break;
      }
    } else if (c === ",") {
      lastSafe = i; // comma position (exclusive of comma) is safe after trim
      lastSafeStack = [...stack];
    } else if (c === ":") {
      // Colon alone isn't safe (expecting value after)
    } else if (/[0-9\-tfn.eE]/.test(c)) {
      // Number or literal char — look ahead to end of it
      const rest = s.slice(i);
      const numMatch = rest.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (numMatch) {
        const endPos = i + numMatch[0].length;
        lastSafe = endPos;
        lastSafeStack = [...stack];
        i = endPos;
        continue;
      }
      const litMatch = rest.match(/^(true|false|null)/);
      if (litMatch) {
        const endPos = i + litMatch[0].length;
        lastSafe = endPos;
        lastSafeStack = [...stack];
        i = endPos;
        continue;
      }
    }

    i++;
  }

  // Truncate to last safe point
  let result = s.slice(0, lastSafe);

  // Strip trailing comma / whitespace / colon / open-quote
  result = result.replace(/[\s,:]+$/g, "");

  // If result ends with `"somekey"` (a dangling key without value), drop it
  const danglingKeyMatch = result.match(/[,{]\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/);
  if (danglingKeyMatch) {
    const idx = result.lastIndexOf(danglingKeyMatch[0]);
    const firstChar = result[idx];
    if (firstChar === ",") {
      result = result.slice(0, idx);
    } else if (firstChar === "{") {
      result = result.slice(0, idx + 1);
    }
  }
  result = result.replace(/[\s,:]+$/g, "");

  // Close remaining open containers
  for (let k = lastSafeStack.length - 1; k >= 0; k--) {
    result += lastSafeStack[k];
  }

  return result;
}

/**
 * Last-resort repair: same as above, but additionally escape any lone
 * double quotes that appear inside string values where we detected a
 * suspicious continuation.
 */
function aggressiveRepair(s: string): string {
  // Simple heuristic: replace `":"..."` patterns where the inner quotes
  // clearly aren't string terminators. Too risky to do perfectly; instead
  // fall back to repairToLastSafePoint but with earlier cutoff if needed.
  return repairToLastSafePoint(s);
}
