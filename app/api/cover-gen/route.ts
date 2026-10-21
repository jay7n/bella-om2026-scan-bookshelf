import { generateCoverImage, hasImageKey, imageModel, resolveCoverSize } from "@/lib/arkImage";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 90;
export const dynamic = "force-dynamic";

/**
 * GET /api/cover-gen?title=书名&hint=一句话氛围
 *
 * 豆瓣没有封面的书，用 Seedream 现画一张。
 * 直接返回图片字节 —— 方舟给的是 24 小时过期的 URL，
 * 存 URL 第二天就全挂了，所以当场下载，前端再缩到 448px 存本地。
 */
export async function GET(req: Request) {
  const limited = rateLimit(req, "coverGen", 3, 60000);
  if (limited) return limited;

  if (!hasImageKey()) {
    return Response.json({ error: "缺少 ARK_API_KEY，请填到 .env.local" }, { status: 503 });
  }

  const url = new URL(req.url);
  const title = (url.searchParams.get("title") || "").trim().slice(0, 40);
  if (!title) return Response.json({ error: "缺少 title" }, { status: 400 });

  const list = (key: string) =>
    (url.searchParams.get(key) || "")
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 3);

  const ctx = {
    intro: (url.searchParams.get("intro") || "").trim().slice(0, 70),
    vibe: list("vibe"),
    tags: list("tags"),
    grade: (url.searchParams.get("grade") || "").trim().slice(0, 8),
  };

  try {
    const { bytes, type, model } = await generateCoverImage(title, ctx);
    const size = resolveCoverSize(model);
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=86400",
        "X-Image-Model": model,
        "X-Image-Size": `${size.width}x${size.height}`,
      },
    });
  } catch (err) {
    console.error("[cover-gen] 失败", title, err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message.slice(0, 200) }, { status: 502 });
  }
}
