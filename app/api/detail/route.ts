import { chatJSON, keyStatus, models } from "@/lib/deepseek";
import { fetchDoubanSubject } from "@/lib/douban";
import { detailPrompt } from "@/lib/prompt";
import type { AiDetail, DetailResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 45;
export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; value: DetailResponse }>();
const TTL = 12 * 60 * 60 * 1000;

/**
 * GET /api/detail?id=<豆瓣id>&title=&author=&year=
 *
 * 两条线并行：
 *   1. 豆瓣条目页 —— 评分、评分人数、官方简介、5 条短评
 *   2. 文本模型   —— 讲什么 / 为什么值得读 / 读之前要知道 / 适合谁
 * 任一失败都能降级，不会整个详情页打不开。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").trim();
  const title = (url.searchParams.get("title") || "").trim().slice(0, 60);
  const author = (url.searchParams.get("author") || "").trim().slice(0, 60);
  const year = (url.searchParams.get("year") || "").trim().slice(0, 12);

  if (!title) return Response.json({ error: "缺少 title" }, { status: 400 });

  const key = `${id}|${title}|${author}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Response.json(hit.value);

  const doubanPromise = id
    ? fetchDoubanSubject(id).catch(() => null)
    : Promise.resolve(null);

  const aiPromise = (async (): Promise<AiDetail | null> => {
    if (!keyStatus().ok) return null;
    try {
      const raw = await chatJSON<Record<string, unknown>>({
        model: models.text,
        messages: [
          { role: "system", content: "你是社区图书角的管理员，说话像邻居家的大人，不像说明书。" },
          { role: "user", content: detailPrompt(title, author, year) },
        ],
        temperature: 0.7,
        maxTokens: 700,
        signal: AbortSignal.timeout(20000),
      });
      return {
        what: str(raw.what, 120),
        why: str(raw.why, 90),
        before: str(raw.before, 70),
        bestFor: str(raw.bestFor, 40),
      };
    } catch (err) {
      console.error("[detail] AI 失败", title, err);
      return null;
    }
  })();

  const [douban, ai] = await Promise.all([doubanPromise, aiPromise]);

  const value: DetailResponse = { douban, ai };

  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }

  return Response.json(value, { headers: { "Cache-Control": "no-store" } });
}

function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}
