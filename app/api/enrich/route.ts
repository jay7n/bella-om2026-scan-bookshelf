import { chatJSON, keyStatus, models } from "@/lib/deepseek";
import { enrichPrompt, profilePrompt } from "@/lib/prompt";
import type { EnrichResult } from "@/lib/types";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Entry = { at: number; value: EnrichResult };
const cache = new Map<string, Entry>();
const TTL = 12 * 60 * 60 * 1000;

/**
 * GET /api/enrich?title=&author=&year=
 * 一本书一次调用：这样第一张卡片的文案最先回来，不用等全部算完。
 */
export async function GET(req: Request) {
  const limited = rateLimit(req, "enrich", 80, 60000);
  if (limited) return limited;

  const status = keyStatus();
  if (!status.ok) return Response.json({ error: status.message }, { status: 503 });

  const url = new URL(req.url);
  const title = (url.searchParams.get("title") || "").trim().slice(0, 60);
  const author = (url.searchParams.get("author") || "").trim().slice(0, 60);
  const year = (url.searchParams.get("year") || "").trim().slice(0, 12);

  const list = (k: string) =>
    (url.searchParams.get(k) || "")
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 6);

  const profile = {
    grade: (url.searchParams.get("grade") || "").trim().slice(0, 8) || undefined,
    gender: (url.searchParams.get("gender") || "").trim().slice(0, 6) || undefined,
    traits: list("traits"),
    interests: list("interests"),
    note: (url.searchParams.get("note") || "").trim().slice(0, 40) || undefined,
  };
  const profileText = profilePrompt(profile);

  if (!title) return Response.json({ error: "缺少 title" }, { status: 400 });

  const key = `${title}|${author}|${year}|${profileText}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Response.json(hit.value);

  try {
    const raw = await chatJSON<Record<string, unknown>>({
      model: models.text,
      messages: [
        { role: "system", content: "你是一个懂小朋友的图书管理员，说话像邻居家的大人，不像说明书。" },
        { role: "user", content: enrichPrompt(title, author, year, profileText) },
      ],
      temperature: 0.75,
      maxTokens: 600,
      signal: AbortSignal.timeout(20000),
    });

    const value: EnrichResult = {
      intro: clean(raw.intro, 60) || "这本书还没有介绍，翻开看看就知道啦。",
      hook: clean(raw.hook, 44),
      vibe: strArray(raw.vibe, 3, 5),
      tags: strArray(raw.tags, 3, 8),
      grade: clean(raw.grade, 12),
      similar: clean(raw.similar, 30),
      fit: ["很合适", "可以试试", "不太合"].includes(String(raw.fit)) ? String(raw.fit) : "",
      reason: clean(raw.reason, 30),
    };

    cache.set(key, { at: Date.now(), value });
    if (cache.size > 800) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    return Response.json(value);
  } catch (err) {
    console.error("[enrich] 失败", title, err);
    return Response.json({ error: "生成介绍失败" }, { status: 502 });
  }
}

function clean(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

function strArray(v: unknown, maxCount: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/^#/, "").replace(/\s+/g, "").trim())
    .filter((t) => t.length > 0 && t.length <= maxLen)
    .slice(0, maxCount);
}
