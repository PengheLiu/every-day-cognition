import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTopic = (body.topic || "unknown").replace(/[^\w\u4e00-\u9fa5.-]/g, "_");
  const filepath = path.join(os.tmpdir(), `cognitive-alignment-fail-${stamp}-${safeTopic}.txt`);
  const out = `Topic: ${body.topic}\nError: ${body.error}\n\n--- content ---\n${body.content}`;
  try {
    fs.writeFileSync(filepath, out, "utf-8");
    console.log(`[debug-log] wrote ${filepath} (${out.length} bytes)`);
  } catch (err) {
    console.error("[debug-log] failed:", err);
  }
  return Response.json({ ok: true, filepath });
}
