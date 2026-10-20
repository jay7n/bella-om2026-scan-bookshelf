import { resolveCover } from "@/lib/douban";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/search?title=书名的 URL 编码
 * 返回 { matched, cover, author, year, title }
 *
 * 命中就返回封面；没命中就返回 matched:false，前端走程序化卡片。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const title = (url.searchParams.get("title") || "").trim();
  if (!title) return Response.json({ matched: false, error: "缺少 title" }, { status: 400 });

  const result = await resolveCover(title.slice(0, 60));
  return Response.json(result, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
