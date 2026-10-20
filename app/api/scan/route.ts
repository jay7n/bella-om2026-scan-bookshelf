import { keyStatus, models, streamText } from "@/lib/deepseek";
import { TITLE_PROMPT, normalizeTitle, parseTitleLine } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_BOOKS = 30;

/** 给欢迎页用：告诉前端后端和 key 是否就绪 */
export async function GET() {
  const status = keyStatus();
  return Response.json({
    ok: status.ok,
    message: status.message ?? null,
    visionModel: models.vision,
    textModel: models.text,
  });
}

/**
 * POST /api/scan
 * body: 图片二进制（image/jpeg 等）
 * 返回: NDJSON 流，每行一个事件
 *   {"type":"title","t":"揭秘物理"}
 *   {"type":"done","count":12}
 *   {"type":"error","message":"..."}
 *
 * 边识别边吐书名 —— 前端收到第一条就能去查封面，
 * 不用等 20 本全部识别完。
 */
export async function POST(req: Request) {
  const status = keyStatus();
  if (!status.ok) {
    return Response.json({ error: status.message }, { status: 503 });
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(await req.arrayBuffer());
  } catch {
    return Response.json({ error: "读取上传内容失败" }, { status: 400 });
  }

  if (buf.length === 0) {
    return Response.json({ error: "没有收到图片" }, { status: 400 });
  }
  if (buf.length > MAX_BYTES) {
    return Response.json({ error: "图片太大了（上限 8MB）" }, { status: 413 });
  }

  const rawType = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const mime = rawType.startsWith("image/") ? rawType : "image/jpeg";

  const encoder = new TextEncoder();
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const push = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          closed = true;
        }
      };

      const seen = new Set<string>();
      const emit = (raw: string) => {
        const title = raw.replace(/^[《「『]/, "").replace(/[》」』]$/, "").trim();
        if (!title || title.length > 40) return;
        const key = normalizeTitle(title);
        if (!key || seen.has(key)) return;
        seen.add(key);
        push({ type: "title", t: title });
      };

      try {
        let full = "";
        let carry = "";

        for await (const delta of streamText({
          model: models.vision,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: TITLE_PROMPT },
                // detail:"high" 很关键：书脊上都是小字，用 low 会被缩到 512px，字就糊了
                { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
              ],
            },
          ],
          temperature: 0,
          maxTokens: 2200,
          signal: req.signal,
        })) {
          full += delta;
          carry += delta;

          let idx: number;
          while ((idx = carry.indexOf("\n")) >= 0) {
            const line = carry.slice(0, idx);
            carry = carry.slice(idx + 1);
            const t = parseTitleLine(line);
            if (t) emit(t);
            if (seen.size >= MAX_BOOKS) break;
          }
          if (seen.size >= MAX_BOOKS) break;
        }

        if (carry.trim()) {
          const t = parseTitleLine(carry);
          if (t) emit(t);
        }

        // 兜底：万一模型没按 JSON Lines 输出（比如吐了一个数组或带解释），
        // 从全文里把所有 "t":"..." 扫一遍，保证不丢书。
        if (seen.size === 0) {
          const re = /"(?:t|title|name|书名)"\s*:\s*"([^"]{1,40})"/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(full)) !== null && seen.size < MAX_BOOKS) {
            emit(m[1]);
          }
        }

        push({ type: "done", count: seen.size });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[scan] 失败:", message);
        push({ type: "error", message: friendly(message) });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* 已经关了 */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function friendly(message: string): string {
  if (/401|403|invalid.*key|Unauthorized/i.test(message)) {
    return "API Key 不对或已失效，请检查 .env.local 里的 DEEPSEEK_API_KEY";
  }
  if (/429|rate limit|quota/i.test(message)) return "调用太频繁或余额不足，请稍后再试";
  if (/timeout|ETIMEDOUT|aborted/i.test(message)) return "识别超时了，请再拍一张（光线好一点、正对书架）";
  return message.slice(0, 300);
}
