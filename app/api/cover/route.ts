import { DOUBAN_REFERER, UA, isAllowedCoverUrl } from "@/lib/douban";
import { readCoverFromDisk, writeCoverToDisk } from "@/lib/coverStore";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Entry = { at: number; body: Uint8Array; type: string };

/** 内存缓存：封面抓过一次就不再打豆瓣 */
const cache = new Map<string, Entry>();
const TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;

/**
 * GET /api/cover?u=<豆瓣图片完整地址>
 *
 * 豆瓣封面有防盗链：Referer 必须是豆瓣域名（否则 403），
 * 完全不带 Referer 会返回 418。浏览器自己发请求改不了 Referer，
 * 所以必须由服务端代抓。
 */
export async function GET(req: Request) {
  const limited = rateLimit(req, "cover", 400, 60000);
  if (limited) return limited;

  const url = new URL(req.url);
  const target = url.searchParams.get("u") || "";

  if (!isAllowedCoverUrl(target)) {
    return new Response("forbidden", { status: 403 });
  }

  const hit = cache.get(target);
  if (hit && Date.now() - hit.at < TTL) {
    return respond(hit.body, hit.type);
  }

  // 内存没有就看磁盘 —— 服务重启后这里能救回来
  const onDisk = await readCoverFromDisk(target);
  if (onDisk) {
    cache.set(target, { at: Date.now(), body: onDisk.body, type: onDisk.type });
    return respond(onDisk.body, onDisk.type);
  }

  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent": UA,
        Referer: DOUBAN_REFERER,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn(`[cover] 抓取失败 ${res.status} ${target}`);
      return new Response("upstream error", { status: 502 });
    }

    const type = res.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) {
      return new Response("not an image", { status: 502 });
    }

    const body = new Uint8Array(await res.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > 3 * 1024 * 1024) {
      return new Response("bad image", { status: 502 });
    }

    if (cache.size >= MAX_ENTRIES) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    cache.set(target, { at: Date.now(), body, type });
    void writeCoverToDisk(target, body, type);

    return respond(body, type);
  } catch (err) {
    console.error("[cover] 异常", err);
    return new Response("upstream error", { status: 502 });
  }
}

function respond(body: Uint8Array, type: string) {
  return new Response(body as unknown as BodyInit, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
