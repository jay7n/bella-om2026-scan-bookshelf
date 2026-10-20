/**
 * 豆瓣图书搜索。
 *
 * 两个坑（实测）：
 *  1. 搜索接口没有 access-control-allow-origin，浏览器不能直连 → 必须服务端转发。
 *  2. 封面图有严格防盗链：Referer 不是豆瓣域名返回 403，完全不带 Referer 返回 418
 *     → 必须由 /api/cover 带着 Referer 去抓。
 */

import { normalizeTitle } from "./prompt";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DOUBAN_REFERER = process.env.DOUBAN_REFERER?.trim() || "https://book.douban.com/";

export type DoubanHit = {
  id: string;
  title: string;
  author: string;
  year: string;
  pic: string;
};

export type CoverMatch = {
  matched: boolean;
  id?: string;
  title?: string;
  author?: string;
  year?: string;
  cover?: string;
};

/** 内存缓存：同一本书 6 小时内不重复打豆瓣 */
const searchCache = new Map<string, { at: number; value: CoverMatch }>();
const SEARCH_TTL = 6 * 60 * 60 * 1000;

export async function searchDouban(query: string): Promise<DoubanHit[]> {
  const url = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Referer: DOUBAN_REFERER,
      Accept: "application/json, text/javascript, */*; q=0.01",
    },
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const text = await res.text();
  if (!text.trim().startsWith("[")) return [];
  try {
    const arr = JSON.parse(text) as Array<Record<string, unknown>>;
    return arr
      .filter((x) => x && x.type === "b")
      .map((x) => ({
        id: String(x.id ?? ""),
        title: String(x.title ?? ""),
        author: String(x.author_name ?? ""),
        year: String(x.year ?? ""),
        pic: String(x.pic ?? ""),
      }))
      .filter((x) => x.id && x.title);
  } catch {
    return [];
  }
}

function isUsablePic(pic: string): boolean {
  if (!pic) return false;
  if (pic.includes("book-default-lpic")) return false; // 豆瓣的"暂无封面"占位图
  return /^https:\/\/[a-z0-9.-]*doubanio\.com\//i.test(pic);
}

/**
 * 从搜索结果里挑最可能是同一本的那一个。
 *
 * 宁可判「没匹配上」走程序化封面，也不要贴错封面——
 * 贴错比贴不上尴尬得多。
 */
export function pickBest(query: string, hits: DoubanHit[]): DoubanHit | null {
  const q = normalizeTitle(query);
  if (!q) return null;

  let best: { hit: DoubanHit; score: number } | null = null;

  for (const hit of hits) {
    if (!isUsablePic(hit.pic)) continue;
    const t = normalizeTitle(hit.title);
    if (!t) continue;

    let score = 0;
    if (t === q) {
      score = 100;
    } else if (t.includes(q) && t.length - q.length <= 4) {
      // 《飞向太空立体书》 vs 太空立体书
      score = 88;
    } else if (q.includes(t) && q.length - t.length <= 4) {
      score = 78;
    } else if (t.startsWith(q) || q.startsWith(t)) {
      score = 70;
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { hit, score };
    }
  }

  return best && best.score >= 70 ? best.hit : null;
}

export async function resolveCover(title: string): Promise<CoverMatch> {
  const key = normalizeTitle(title);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.value;

  let value: CoverMatch = { matched: false };
  try {
    const hits = await searchDouban(title);
    const best = pickBest(title, hits);
    if (best) {
      value = {
        matched: true,
        id: best.id,
        title: best.title,
        author: best.author,
        year: best.year,
        cover: `/api/cover?u=${encodeURIComponent(best.pic)}`,
      };
    }
  } catch (err) {
    console.error("[douban] 搜索失败", title, err);
    value = { matched: false };
  }

  searchCache.set(key, { at: Date.now(), value });
  if (searchCache.size > 500) {
    const firstKey = searchCache.keys().next().value;
    if (firstKey) searchCache.delete(firstKey);
  }
  return value;
}

/** 封面图代理用：只允许豆瓣图片域名，避免变成开放代理 */
export function isAllowedCoverUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host === "doubanio.com" || host.endsWith(".doubanio.com");
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 详情页：抓豆瓣条目页（评分 / 简介 / 短评）                            */
/* ------------------------------------------------------------------ */

export type DoubanDetail = {
  id: string;
  url: string;
  rating: string | null;
  votes: string | null;
  summary: string | null;
  publisher: string | null;
  comments: string[];
};

const detailCache = new Map<string, { at: number; value: DoubanDetail | null }>();
const DETAIL_TTL = 7 * 24 * 60 * 60 * 1000;

function textOf(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 抓豆瓣书籍条目页。
 * 未登录也能拿到评分、评分人数、简介和前 5 条短评（实测）。
 * 失败就返回 null —— 详情页会降级成「只有 AI 介绍」。
 */
export async function fetchDoubanSubject(id: string): Promise<DoubanDetail | null> {
  if (!/^\d{3,12}$/.test(id)) return null;

  const cached = detailCache.get(id);
  if (cached && Date.now() - cached.at < DETAIL_TTL) return cached.value;

  let value: DoubanDetail | null = null;
  try {
    const res = await fetch(`https://book.douban.com/subject/${id}/`, {
      headers: {
        "User-Agent": UA,
        Referer: DOUBAN_REFERER,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });

    if (res.ok) {
      const html = await res.text();
      const rating = html.match(/property="v:average">\s*([\d.]+)/)?.[1] ?? null;
      const votes = html.match(/property="v:votes">\s*(\d+)/)?.[1] ?? null;
      const summary = html.match(/<div class="intro">([\s\S]*?)<\/div>/)?.[1] ?? null;
      // 出版社外面包了一层 <a href="...">，所以要跳过标签再取文字
      const publisher =
        html.match(/出版社:<\/span>\s*(?:<a[^>]*>)?\s*([^<]+)/)?.[1] ?? null;

      const comments = [...html.matchAll(/<span class="short">([\s\S]*?)<\/span>/g)]
        .map((m) => textOf(m[1]))
        .filter((t) => t.length > 0)
        .slice(0, 5);

      value = {
        id,
        url: `https://book.douban.com/subject/${id}/`,
        // 豆瓣没有评分时会显示 0，这种情况当成没有
        rating: rating && Number(rating) > 0 ? rating : null,
        votes,
        summary: summary ? textOf(summary).slice(0, 500) : null,
        publisher: publisher ? publisher.trim() : null,
        comments,
      };
    } else {
      console.warn(`[douban] 条目页 ${id} 返回 ${res.status}`);
    }
  } catch (err) {
    console.error("[douban] 条目页抓取失败", id, err);
  }

  detailCache.set(id, { at: Date.now(), value });
  if (detailCache.size > 200) {
    const firstKey = detailCache.keys().next().value;
    if (firstKey) detailCache.delete(firstKey);
  }
  return value;
}

export { UA, DOUBAN_REFERER };
